/**
 * Review email module — sends casual, varied review notifications via Resend.
 */

import { Resend } from 'resend';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(__dirname, '..', 'templates', 'review-email.html'), 'utf-8');

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

function buildEmailHtml({ title, body, previewUrl, prUrl, siteName }) {
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
    .replace(/\{\{prUrl\}\}/g, prUrl)
    .replace('{{siteName}}', siteName);
}

/**
 * Send a review email for a generated blog post.
 *
 * @param {object} site - Site config from sites.json
 * @param {object} post - Generated post data (title, description, body, tags)
 * @param {string} prUrl - GitHub PR URL
 * @param {string} previewUrl - Vercel preview deployment URL (or PR URL as fallback)
 */
export async function sendReviewEmail(site, post, prUrl, previewUrl) {
  if (!process.env.RESEND_API_KEY) {
    log(site, 'RESEND_API_KEY not set, skipping review email');
    return null;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const siteName = new URL(site.siteUrl).hostname;

  const subjectFn = pick(SUBJECT_TEMPLATES);
  const subject = subjectFn(siteName, post.title);

  const html = buildEmailHtml({
    title: post.title,
    body: post.body,
    previewUrl: previewUrl || prUrl,
    prUrl,
    siteName,
  });

  try {
    const result = await resend.emails.send({
      from: 'Blog Publisher <blog@send.websitelab.biz>',
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
