#!/usr/bin/env node

/**
 * Auto-publish blog posts that have been pending review for 24+ hours.
 * Merges any open PR with the 'content-publisher' label older than 24 hours.
 */

import { Octokit } from 'octokit';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postToFacebook } from './facebook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const octokit = new Octokit({ auth: process.env.GITHUB_PAT });
const HOURS = 24;

async function main() {
  const sitesPath = join(__dirname, '..', 'sites.json');
  const sites = JSON.parse(readFileSync(sitesPath, 'utf-8'));

  const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  console.log(`Auto-publishing PRs older than ${cutoff.toISOString()}`);

  for (const site of sites) {
    const [owner, repo] = site.repo.split('/');

    let prs;
    try {
      const { data } = await octokit.rest.pulls.list({
        owner, repo, state: 'open',
      });
      prs = data;
    } catch (err) {
      console.warn(`[${site.siteUrl}] Skipping — failed to fetch PRs: ${err.message}`);
      continue;
    }

    const blogPRs = prs.filter(pr =>
      pr.labels.some(l => l.name === 'content-publisher')
    );

    for (const pr of blogPRs) {
      const createdAt = new Date(pr.created_at);

      if (createdAt < cutoff) {
        console.log(`[${site.siteUrl}] Auto-publishing PR #${pr.number}: "${pr.title}" (created ${createdAt.toISOString()})`);

        try {
          await octokit.rest.pulls.merge({
            owner, repo,
            pull_number: pr.number,
            merge_method: 'squash',
          });

          await octokit.rest.issues.createComment({
            owner, repo,
            issue_number: pr.number,
            body: '**Auto-published** — no action was taken within 24 hours, so this post has been published automatically.',
          });

          console.log(`  Merged successfully`);

          // Facebook posting — isolated so it never breaks the merge flow
          try {
            await postToFacebook(site, pr.title, pr.body);
          } catch (fbErr) {
            console.error(`  Facebook posting failed: ${fbErr.message}`);
          }
        } catch (err) {
          console.error(`  Failed to merge: ${err.message}`);
        }
      } else {
        const hoursLeft = ((cutoff.getTime() - createdAt.getTime()) / (1000 * 60 * 60) + HOURS).toFixed(1);
        console.log(`[${site.siteUrl}] PR #${pr.number} still within 24hr window (${hoursLeft}h remaining)`);
      }
    }
  }
}

main().catch(err => {
  console.error('Auto-publish failed:', err);
  process.exit(1);
});
