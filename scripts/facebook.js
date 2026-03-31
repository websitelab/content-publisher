/**
 * Facebook Page auto-poster.
 * Posts a link + message to a Facebook Page via the Graph API
 * when a blog post is published (PR merged).
 */

import { Resend } from 'resend';
import { slugify, log } from './utils.js';

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const ALERT_EMAIL = 'hello@websitelab.biz';

async function sendFailureAlert(site, postTitle, error) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Content Publisher <notifications@websitelab.biz>',
      to: ALERT_EMAIL,
      subject: `Facebook post failed: ${site.siteUrl}`,
      html: `<p>A blog post was published but the Facebook post failed.</p>
<p><strong>Site:</strong> ${site.siteUrl}</p>
<p><strong>Post:</strong> ${postTitle}</p>
<p><strong>Error:</strong> ${error}</p>
<p>The blog post is live — only the Facebook share failed. You may want to post it manually.</p>`,
      tracking: { click: false },
    });
  } catch (emailErr) {
    log(site, `Facebook: could not send failure alert email — ${emailErr.message}`);
  }
}

function extractDescriptionFromPR(prBody) {
  const match = prBody?.match(/<!-- blog-description:(.+?) -->/);
  return match ? match[1] : '';
}

/**
 * Post to a Facebook Page. Fails silently — never throws.
 * @param {object} site - Site config from sites.json (must have site.facebook)
 * @param {string} postTitle - The blog post title (also the PR title)
 * @param {string} prBody - The PR body containing the embedded description
 */
export async function postToFacebook(site, postTitle, prBody) {
  if (!site.facebook) return;

  const { pageId, tokenEnvVar, articlePath } = site.facebook;
  const accessToken = process.env[tokenEnvVar];

  if (!accessToken) {
    log(site, `Facebook: skipping — ${tokenEnvVar} not set`);
    return;
  }

  const slug = slugify(postTitle);
  const articleUrl = `${site.siteUrl}${articlePath}/${slug}`;
  const description = extractDescriptionFromPR(prBody);

  const message = description
    ? `${postTitle}\n\n${description}`
    : postTitle;

  try {
    const res = await fetch(`${GRAPH_API}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        link: articleUrl,
        access_token: accessToken,
      }),
    });

    const data = await res.json();

    if (data.id) {
      log(site, `Facebook: posted successfully (ID: ${data.id})`);
    } else {
      const errorMsg = JSON.stringify(data.error || data);
      log(site, `Facebook: API error — ${errorMsg}`);
      await sendFailureAlert(site, postTitle, errorMsg);
    }
  } catch (err) {
    log(site, `Facebook: failed — ${err.message}`);
    await sendFailureAlert(site, postTitle, err.message);
  }
}
