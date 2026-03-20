/**
 * Review email module — plain-text style HTML emails via Resend.
 * Designed to look like a personal email from David, not an automated system.
 */

import { Resend } from 'resend';
import { createHmac } from 'node:crypto';
import { log } from './utils.js';

const REVIEW_API_BASE = process.env.REVIEW_API_URL || 'https://blog-publisher-websitelab.vercel.app';

/** Map hostnames to short labels for subject lines. */
const SITE_LABELS = {
  'mispineandjoint.com': 'MSJC',
  'spineandsportsmi.com': 'CSSC',
  'www.websitelab.biz': 'Website Lab',
};

function getSiteLabel(siteUrl) {
  const hostname = new URL(siteUrl).hostname;
  return SITE_LABELS[hostname] || hostname;
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

function buildEmailHtml({ title, body, previewUrl, approveUrl, denyUrl, feedbackUrl, siteLabel, greeting, isRevision }) {
  const plainPreview = stripMarkdown(body);
  const preview = truncateToWords(plainPreview, 80);

  const intro = isRevision
    ? `Revised the blog post for ${siteLabel} based on your feedback. Here's the updated version:`
    : `New blog post is up for ${siteLabel}. Here's a quick look:`;

  return `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #222; line-height: 1.5;">
<p>${greeting}</p>

<p>${intro}</p>

<p><strong>${title}</strong></p>

<p style="color: #555;">${preview}</p>

<p><a href="${previewUrl}" style="color: #1a73e8;">Read the full post</a></p>

<p style="color: #888; font-size: 13px;">This will go live automatically in 24 hours unless you take action below.</p>

<p>
<a href="${approveUrl}" style="color: #16a34a; font-weight: bold; text-decoration: none;">Approve</a> &nbsp;&nbsp;
<a href="${feedbackUrl}" style="color: #1a73e8; text-decoration: none;">Request changes</a> &nbsp;&nbsp;
<a href="${denyUrl}" style="color: #999; text-decoration: none;">Remove</a>
</p>

<p style="margin-top: 24px;">David Peyton<br>
<span style="color: #888; font-size: 13px;">Website Lab &middot; (586) 209-4725<br>
<a href="https://www.websitelab.biz" style="color: #888; text-decoration: none;">websitelab.biz</a></span></p>
</div>`;
}

/**
 * Send a review email for a generated blog post.
 * @param {object} options
 * @param {boolean} options.isRevision - If true, use revision subject format
 */
export async function sendReviewEmail(site, post, prUrl, previewUrl, slug, { isRevision = false } = {}) {
  if (!process.env.RESEND_API_KEY) {
    log(site, 'RESEND_API_KEY not set, skipping review email');
    return null;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const siteLabel = getSiteLabel(site.siteUrl);

  const subject = isRevision
    ? `Revised ${siteLabel} Blog: ${post.title}`
    : `New ${siteLabel} Blog: ${post.title}`;

  // Build the direct blog post preview link
  let blogPreviewUrl = prUrl;
  if (previewUrl && slug) {
    const base = previewUrl.replace(/\/$/, '');
    const section = site.contentPath.split('/').pop();
    blogPreviewUrl = `${base}/${section}/${slug}`;
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
    siteLabel,
    greeting: site.reviewGreeting || 'Hey,',
    isRevision,
  });

  try {
    const emailPayload = {
      from: 'David Peyton <david@send.websitelab.biz>',
      to: site.reviewEmail,
      subject,
      html,
    };

    if (site.ccEmail) {
      emailPayload.cc = Array.isArray(site.ccEmail) ? site.ccEmail : [site.ccEmail];
    }

    const result = await resend.emails.send(emailPayload);

    log(site, `Review email sent to ${site.reviewEmail}${site.ccEmail ? ` (cc: ${site.ccEmail})` : ''}`);
    return result;
  } catch (err) {
    log(site, `Failed to send review email: ${err.message}`);
    return null;
  }
}
