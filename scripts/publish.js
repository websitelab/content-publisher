#!/usr/bin/env node

/**
 * Blog Publisher — Main Orchestrator
 *
 * Reads sites.json, generates blog posts via Gemini, fetches hero images
 * from Pexels, creates PRs on target repos, and sends review emails.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePost } from './generate.js';
import { fetchHeroImage } from './images.js';
import { getExistingTitles, checkExistingPR, createBlogPR } from './github.js';
import { sendReviewEmail } from './email.js';
import { slugify, buildMarkdown, log, sleep } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_BETWEEN_SITES = 3000;

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

async function processSite(site) {
  log(site, '--- Starting ---');

  // Check for existing open PR
  if (!DRY_RUN) {
    try {
      const hasOpenPR = await checkExistingPR(site.repo);
      if (hasOpenPR) {
        log(site, 'Open PR with blog-publisher label already exists, skipping');
        return { site, status: 'skipped', reason: 'existing PR' };
      }
    } catch (err) {
      log(site, `Error checking existing PRs: ${err.message}`);
    }
  }

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

  // Generate content
  const post = await generatePost(site, existingTitles);
  if (!post) {
    log(site, 'Content generation failed, skipping');
    return { site, status: 'failed', reason: 'generation failed' };
  }

  const slug = slugify(post.title);
  log(site, `Slug: ${slug}`);

  // Fetch hero image
  const image = await fetchHeroImage(post.imageSearchQuery);
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
    return { site, status: 'dry-run', post, slug };
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
    log(site, 'PR creation failed, skipping email');
    return { site, status: 'failed', reason: 'PR creation failed' };
  }

  log(site, `PR created: ${pr.html_url}`);

  // Send review email
  const previewUrl = pr.html_url;
  await sendReviewEmail(site, post, pr.html_url, previewUrl);

  log(site, '--- Complete ---');
  return { site, status: 'published', pr: pr.html_url, slug };
}

async function main() {
  console.log(`Blog Publisher ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log('='.repeat(50));

  checkEnvVars();
  const sites = loadSites();
  console.log(`Processing ${sites.length} site(s)\n`);

  const results = [];

  for (let i = 0; i < sites.length; i++) {
    const result = await processSite(sites[i]);
    results.push(result);

    // Delay between sites to avoid rate limits
    if (i < sites.length - 1) {
      log('publisher', `Waiting ${DELAY_BETWEEN_SITES / 1000}s before next site...`);
      await sleep(DELAY_BETWEEN_SITES);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary:');
  for (const r of results) {
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

  const failed = results.filter(r => r.status === 'failed');
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
