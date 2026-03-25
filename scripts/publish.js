#!/usr/bin/env node

/**
 * Content Publisher — Main Orchestrator
 *
 * Reads sites.json, generates blog posts via Gemini, fetches hero images
 * from Pexels, creates PRs on target repos, and sends review emails.
 *
 * Flags:
 *   --dry-run    Generate content but don't create PRs or send emails
 *   --count N    Generate N posts per site (default: 1)
 *   --site URL   Only process sites matching this siteUrl
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePost } from './generate.js';
import { fetchHeroImage } from './images.js';
import { getExistingTitles, checkExistingPR, createBlogPR, getVercelPreviewUrl } from './github.js';
import { sendReviewEmail } from './email.js';
import { slugify, buildMarkdown, log, sleep } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_BETWEEN_POSTS = 5000;

function parseCount() {
  const idx = process.argv.indexOf('--count');
  if (idx === -1 || idx + 1 >= process.argv.length) return 1;
  const n = parseInt(process.argv[idx + 1], 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

function parseSiteFilter() {
  const idx = process.argv.indexOf('--site');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function loadSites() {
  const sitesPath = join(__dirname, '..', 'sites.json');
  const raw = readFileSync(sitesPath, 'utf-8');
  const sites = JSON.parse(raw);

  if (!Array.isArray(sites) || sites.length === 0) {
    console.error('sites.json is empty or invalid');
    process.exit(1);
  }

  return sites;
}

function checkEnvVars() {
  const required = ['GEMINI_API_KEY', 'PEXELS_API_KEY'];
  if (!DRY_RUN) required.push('GITHUB_PAT');

  const missing = required.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function generateOnePost(site, existingTitles) {
  // Generate content
  const post = await generatePost(site, existingTitles);
  if (!post) {
    log(site, 'Content generation failed');
    return null;
  }

  const slug = slugify(post.title);
  log(site, `Slug: ${slug}`);

  // Fetch hero image (pass industry for better fallback queries)
  const image = await fetchHeroImage(post.imageSearchQuery, site.industry);
  if (image) {
    log(site, `Image: ${image.width}x${image.height}, ${(image.size / 1024).toFixed(0)}KB`);
  } else {
    log(site, 'No image found, post will be created without one');
  }

  // Build markdown
  const markdown = buildMarkdown(post, site, slug);

  if (DRY_RUN) {
    log(site, '=== DRY RUN ===');
    log(site, `Would commit to: ${site.repo}`);
    log(site, `  Post: ${site.contentPath}/${slug}.md`);
    if (image) {
      log(site, `  Image: ${site.imagePath}/${slug}.webp`);
    }
    log(site, `  Title: ${post.title}`);
    log(site, `  Description: ${post.description}`);
    log(site, `  Tags: ${post.tags.join(', ')}`);
    log(site, `  Word count: ~${post.body.split(/\s+/).length}`);
    log(site, '===============');
    return { status: 'dry-run', post, slug };
  }

  // Create PR
  const pr = await createBlogPR(
    site.repo,
    slug,
    markdown,
    image?.buffer || null,
    site,
  );

  if (!pr) {
    log(site, 'PR creation failed');
    return { status: 'failed', reason: 'PR creation failed' };
  }

  log(site, `PR created: ${pr.html_url}`);

  // Wait for Vercel preview deployment
  log(site, 'Waiting for Vercel preview deployment...');
  const previewUrl = await getVercelPreviewUrl(site.repo, pr.head.sha);
  if (previewUrl) {
    log(site, `Vercel preview: ${previewUrl}`);
  } else {
    log(site, 'Vercel preview not ready, using PR URL as fallback');
  }

  // Send review email
  await sendReviewEmail(site, post, pr.html_url, previewUrl, slug);

  return { status: 'published', pr: pr.html_url, slug, title: post.title };
}

async function processSite(site, count) {
  log(site, `--- Starting (${count} post${count > 1 ? 's' : ''}) ---`);

  // Get existing titles for dedup
  let existingTitles = [];
  if (!DRY_RUN) {
    try {
      existingTitles = await getExistingTitles(site.repo, site.contentPath);
      log(site, `Found ${existingTitles.length} existing posts`);
    } catch (err) {
      log(site, `Error fetching existing titles: ${err.message}`);
    }
  }

  // For single post mode (weekly schedule), check for existing PR
  if (count === 1 && !DRY_RUN) {
    try {
      const hasOpenPR = await checkExistingPR(site.repo);
      if (hasOpenPR) {
        log(site, 'Open PR with content-publisher label already exists, skipping');
        return [{ site, status: 'skipped', reason: 'existing PR' }];
      }
    } catch (err) {
      log(site, `Error checking existing PRs: ${err.message}`);
    }
  }

  const results = [];

  for (let i = 0; i < count; i++) {
    if (count > 1) log(site, `\n  Post ${i + 1}/${count}:`);

    const result = await generateOnePost(site, existingTitles);

    if (result) {
      results.push({ site, ...result });

      // Add the new title to dedup list for subsequent posts
      if (result.title || result.post?.title) {
        existingTitles.push(result.title || result.post.title);
      }
    } else {
      results.push({ site, status: 'failed', reason: 'generation failed' });
    }

    // Delay between posts to avoid rate limits
    if (i < count - 1) {
      log(site, `Waiting ${DELAY_BETWEEN_POSTS / 1000}s before next post...`);
      await sleep(DELAY_BETWEEN_POSTS);
    }
  }

  log(site, '--- Complete ---');
  return results;
}

async function main() {
  const count = parseCount();
  const siteFilter = parseSiteFilter();

  console.log(`Content Publisher ${DRY_RUN ? '(DRY RUN) ' : ''}${count > 1 ? `(${count} posts per site) ` : ''}`);
  console.log('='.repeat(50));

  checkEnvVars();
  let sites = loadSites();

  if (siteFilter) {
    sites = sites.filter(s => s.siteUrl.includes(siteFilter));
    if (sites.length === 0) {
      console.error(`No sites match filter: ${siteFilter}`);
      process.exit(1);
    }
  }

  console.log(`Processing ${sites.length} site(s)\n`);

  const siteResults = await Promise.all(sites.map(site => processSite(site, count)));
  const allResults = siteResults.flat();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary:');
  for (const r of allResults) {
    const name = r.site.siteUrl || r.site.repo;
    if (r.status === 'published') {
      console.log(`  ${name}: PR created -> ${r.pr}`);
    } else if (r.status === 'dry-run') {
      console.log(`  ${name}: would publish "${r.post.title}"`);
    } else if (r.status === 'skipped') {
      console.log(`  ${name}: skipped (${r.reason})`);
    } else {
      console.log(`  ${name}: failed (${r.reason})`);
    }
  }

  const failed = allResults.filter(r => r.status === 'failed');
  const succeeded = allResults.filter(r => r.status === 'published' || r.status === 'dry-run' || r.status === 'skipped');

  if (failed.length > 0) {
    console.log(`\nWARNING: ${failed.length} site(s) had failures (see above)`);
  }

  // Only exit with error if ALL sites failed (partial success is still success)
  if (failed.length > 0 && succeeded.length === 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
