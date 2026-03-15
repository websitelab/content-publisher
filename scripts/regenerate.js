#!/usr/bin/env node

/**
 * Regenerate a blog post based on reviewer feedback.
 *
 * Reads the existing post from the PR branch, sends it to Gemini
 * along with the feedback, and commits the revised version.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Octokit } from 'octokit';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.7,
  },
});

const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

const PR_REPO = process.env.PR_REPO;
const PR_NUMBER = parseInt(process.env.PR_NUMBER, 10);
const FEEDBACK = process.env.FEEDBACK;

function stripReviewerPrefix(feedback) {
  return feedback.replace(/^\*\*Reviewer feedback:\*\*\s*/i, '').trim();
}

async function getPRDetails() {
  const [owner, repo] = PR_REPO.split('/');
  const { data: pr } = await octokit.rest.pulls.get({
    owner, repo, pull_number: PR_NUMBER,
  });
  return { owner, repo, pr };
}

async function getPostFromBranch(owner, repo, branch, contentPath) {
  const { data: files } = await octokit.rest.repos.getContent({
    owner, repo, path: contentPath, ref: branch,
  });

  const mdFile = (Array.isArray(files) ? files : [files])
    .find(f => f.name.endsWith('.md'));

  if (!mdFile) return null;

  const { data: content } = await octokit.rest.repos.getContent({
    owner, repo, path: mdFile.path, ref: branch,
    mediaType: { format: 'raw' },
  });

  return { path: mdFile.path, content: String(content), sha: mdFile.sha };
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2].trim() };
}

async function revisePost(originalPost, feedback, site) {
  const cleanFeedback = stripReviewerPrefix(feedback);

  const prompt = `You are revising an existing blog post based on reviewer feedback.

ORIGINAL POST (markdown):
${originalPost}

REVIEWER FEEDBACK:
${cleanFeedback}

Revise the post to address the feedback. Keep the same topic and general structure unless the feedback asks for a change. Maintain all internal links from the original.

CRITICAL WRITING RULES:
- NEVER use em dashes. Use commas, periods or semicolons instead.
- NEVER use the Oxford comma. In a list of three or more items, do NOT put a comma before "and" or "or".
- NEVER use AI-style language: "game-changer", "in today's fast-paced world", "it's important to note", "dive into", "navigating the landscape", "harness the power", "at the end of the day", "leverage", "elevate", "seamlessly", "robust", "cutting-edge", "streamline", "revolutionize", "comprehensive", "delve"
- Write in short, punchy sentences. Avoid compound sentences strung together with dashes.

Return as JSON:
{
  "title": "string",
  "description": "string (under 160 chars)",
  "tags": ["string"],
  "body": "string (markdown formatted, with internal links preserved)",
  "imageAlt": "string (descriptive alt text for hero image)"
}`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

function rebuildMarkdown(revised, originalFrontmatter, slug) {
  // Parse original frontmatter to preserve author, pubDate, image url
  const lines = originalFrontmatter.split('\n');
  const preserved = {};
  let inImage = false;

  for (const line of lines) {
    if (line.startsWith('pubDate:')) preserved.pubDate = line.split(': ')[1];
    if (line.startsWith('author:')) preserved.author = line.match(/"(.+)"/)?.[1] || line.split(': ')[1];
    if (line.startsWith('image:')) inImage = true;
    if (inImage && line.startsWith('  url:')) preserved.imageUrl = line.match(/"(.+)"/)?.[1] || line.split(': ')[1]?.trim();
    if (inImage && line.startsWith('  alt:')) inImage = false;
    if (line.startsWith('draft:')) preserved.draft = line.split(': ')[1];
  }

  // Auto-truncate
  let title = revised.title;
  let description = revised.description;
  if (title.length > 70) title = title.slice(0, 67) + '...';
  if (description.length > 160) description = description.slice(0, 157) + '...';

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `pubDate: ${preserved.pubDate}`,
    `author: "${preserved.author}"`,
    'image:',
    `  url: "${preserved.imageUrl}"`,
    `  alt: "${revised.imageAlt.replace(/"/g, '\\"')}"`,
    `tags: [${revised.tags.map(t => `"${t}"`).join(', ')}]`,
    `draft: ${preserved.draft || 'false'}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${revised.body}\n`;
}

async function commitRevision(owner, repo, branch, filePath, newContent, commitSha) {
  // Get current commit tree
  const { data: commit } = await octokit.rest.git.getCommit({
    owner, repo, commit_sha: commitSha,
  });

  // Create new blob
  const { data: blob } = await octokit.rest.git.createBlob({
    owner, repo, content: newContent, encoding: 'utf-8',
  });

  // Create new tree
  const { data: tree } = await octokit.rest.git.createTree({
    owner, repo,
    base_tree: commit.tree.sha,
    tree: [{ path: filePath, mode: '100644', type: 'blob', sha: blob.sha }],
  });

  // Create new commit
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner, repo,
    message: `Revise blog post based on reviewer feedback`,
    tree: tree.sha,
    parents: [commitSha],
  });

  // Update branch ref
  await octokit.rest.git.updateRef({
    owner, repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return newCommit.sha;
}

async function main() {
  console.log(`Regenerating post for PR #${PR_NUMBER} on ${PR_REPO}`);
  console.log(`Feedback: ${FEEDBACK.slice(0, 100)}...`);

  const { owner, repo, pr } = await getPRDetails();
  const branch = pr.head.ref;
  const commitSha = pr.head.sha;

  // Find site config for this repo
  const sitesPath = join(__dirname, '..', 'sites.json');
  const sites = JSON.parse(readFileSync(sitesPath, 'utf-8'));
  const site = sites.find(s => s.repo === PR_REPO);

  if (!site) {
    console.error(`No site config found for ${PR_REPO}`);
    process.exit(1);
  }

  // Get current post from branch
  const post = await getPostFromBranch(owner, repo, branch, site.contentPath);
  if (!post) {
    console.error('Could not find blog post markdown on PR branch');
    process.exit(1);
  }

  console.log(`Found post: ${post.path}`);

  const parsed = parseFrontmatter(post.content);
  if (!parsed) {
    console.error('Could not parse frontmatter');
    process.exit(1);
  }

  // Get slug from file path
  const slug = post.path.split('/').pop().replace('.md', '');

  // Revise with Gemini
  console.log('Sending to Gemini for revision...');
  const revised = await revisePost(post.content, FEEDBACK, site);
  console.log(`Revised title: "${revised.title}"`);

  // Rebuild markdown preserving original metadata
  const newMarkdown = rebuildMarkdown(revised, parsed.frontmatter, slug);

  // Commit to PR branch
  console.log('Committing revision...');
  const newSha = await commitRevision(owner, repo, branch, post.path, newMarkdown, commitSha);
  console.log(`Committed: ${newSha}`);

  // Comment on PR confirming revision
  await octokit.rest.issues.createComment({
    owner, repo,
    issue_number: PR_NUMBER,
    body: `**Revised post committed** based on feedback. The preview will update shortly.\n\nChanges made:\n- Title: "${revised.title}"\n- Description: "${revised.description}"`,
  });

  console.log('Done — revision committed and PR commented');
}

main().catch(err => {
  console.error('Regeneration failed:', err);
  process.exit(1);
});
