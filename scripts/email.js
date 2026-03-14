/**
 * Review email module — sends casual, varied review notifications via Resend.
 */

import { Resend } from 'resend';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(__dirname, '..', 'templates', 'review-email.html'), 'utf-8');

const REVIEW_API_BASE = process.env.REVIEW_API_URL || 'https://blog-publisher-websitelab.vercel.app';

const SUBJECT_TEMPLATES = [
  (s, t) => `New post for ${s}: "${t}"`,
  (s, t) => `Blog draft ready: ${t}`,
  (s, t) => `Take a look: new ${s} blog post`,
  (s, t) => `Fresh content for ${s}`,
  (s, t) => `${s} blog post needs your eyes`,
  (s, t) => `Quick review? New post for ${s}`,
  (s, t) => `New ${s} article: "${t}"`,
];

const GREETINGS = [
  'Hey,',
  'Hi there,',
  'Hey there,',
  'Hi,',
  'Morning,',
  'Quick one for you,',
];

const SUMMARIES = [
  (s, t) => `New blog post ready for ${s}:`,
  (s, t) => `Just generated a new post for ${s}:`,
  (s, t) => `Got a fresh blog post for ${s}. Take a look:`,
  (s, t) => `Here's a new post for ${s}:`,
  (s, t) => `Blog post just came through for ${s}:`,
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function truncateToWords(text, wordCount) {
  const words = text.split(/\s+/);
  if (words.length <= wordCount) return text;
  return words.slice(0, wordCount).join(' ') + '...';
}

function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/>\s+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

function createReviewToken(repo, prNumber) {
  const secret = process.env.REVIEW_SECRET;
  if (!secret) return null;
  const payload = `${repo}:${prNumber}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  const data = Buffer.from(JSON.stringify({ repo, pr: prNumber })).toString('base64url');
  return `${data}.${sig}`;
}

function buildEmailHtml({ title, body, previewUrl, approveUrl, denyUrl, feedbackUrl, siteName }) {
  const greeting = pick(GREETINGS);
  const summary = pick(SUMMARIES)(siteName, title);
  const plainPreview = stripMarkdown(body);
  const preview = truncateToWords(plainPreview, 80);

  return template
    .replace('{{greeting}}', greeting)
    .replace('{{summary}}', summary)
    .replace('{{title}}', title)
    .replace('{{preview}}', preview)
    .replace('{{previewUrl}}', previewUrl)
    .replace('{{approveUrl}}', approveUrl)
    .replace('{{denyUrl}}', denyUrl)
    .replace('{{feedbackUrl}}', feedbackUrl)
    .replace('{{siteName}}', siteName);
}

/**
 * Send a review email for a generated blog post.
 */
export async function sendReviewEmail(site, post, prUrl, previewUrl, slug) {
  if (!process.env.RESEND_API_KEY) {
    log(site, 'RESEND_API_KEY not set, skipping review email');
    return null;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const siteName = new URL(site.siteUrl).hostname;

  const subjectFn = pick(SUBJECT_TEMPLATES);
  const subject = subjectFn(siteName, post.title);

  // Build the direct blog post preview link
  let blogPreviewUrl = prUrl;
  if (previewUrl && slug) {
    const base = previewUrl.replace(/\/$/, '');
    blogPreviewUrl = `${base}/blog/${slug}.html`;
  }

  // Build review action URLs
  const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
  const token = createReviewToken(site.repo, prNumber);
  const base = REVIEW_API_BASE.replace(/\/$/, '');

  const approveUrl = token
    ? `${base}/api/approve?token=${token}`
    : `${prUrl}/merge`;
  const denyUrl = token
    ? `${base}/api/deny?token=${token}`
    : `${prUrl}/close`;
  const feedbackUrl = token
    ? `${base}/api/feedback?token=${token}`
    : `${prUrl}#issuecomment-new`;

  const html = buildEmailHtml({
    title: post.title,
    body: post.body,
    previewUrl: blogPreviewUrl,
    approveUrl,
    denyUrl,
    feedbackUrl,
    siteName,
  });

  try {
    const result = await resend.emails.send({
      from: 'David Peyton <david@send.websitelab.biz>',
      to: site.reviewEmail,
      subject,
      html,
    });

    log(site, `Review email sent to ${site.reviewEmail}`);
    return result;
  } catch (err) {
    log(site, `Failed to send review email: ${err.message}`);
    return null;
  }
}
