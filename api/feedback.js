import { Octokit } from 'octokit';
import { verifyReviewToken, htmlResponse } from './utils.js';

export default async function handler(req) {
  const url = new URL(req.url, `https://${req.headers.get('host')}`);
  const token = url.searchParams.get('token');
  const parsed = verifyReviewToken(token);

  if (!parsed) {
    return htmlResponse('Invalid Link', 'This review link is invalid or has expired.', false);
  }

  // GET = show feedback form, POST = submit feedback
  if (req.method === 'GET') {
    return new Response(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leave Feedback</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9f9f9; }
  .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  h1 { font-size: 22px; color: #111; margin-bottom: 8px; }
  p { color: #555; font-size: 14px; margin-bottom: 20px; }
  textarea { width: 100%; min-height: 120px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-family: inherit; font-size: 15px; resize: vertical; box-sizing: border-box; }
  button { margin-top: 16px; padding: 12px 24px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; }
  button:hover { background: #1d4ed8; }
</style></head>
<body><div class="card">
  <h1>Leave Feedback</h1>
  <p>What changes would you like to see? We'll revise the post based on your notes.</p>
  <form method="POST" action="/api/feedback?token=${encodeURIComponent(token)}">
    <textarea name="feedback" placeholder="e.g. Change the title, add more detail about pricing, make the tone more casual..." required></textarea>
    <button type="submit">Send Feedback</button>
  </form>
</div></body></html>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // POST = submit feedback as PR comment
  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const feedback = params.get('feedback');

    if (!feedback || !feedback.trim()) {
      return htmlResponse('No Feedback', 'Please go back and enter your feedback.', false);
    }

    const [owner, repo] = parsed.repo.split('/');
    const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

    await octokit.rest.issues.createComment({
      owner, repo,
      issue_number: parsed.pr,
      body: `**Reviewer feedback:**\n\n${feedback.trim()}`,
    });

    return htmlResponse('Feedback Sent!', 'Your feedback has been received. We\'ll revise the post and send you an updated version. You can close this tab.');
  } catch (err) {
    return htmlResponse('Something Went Wrong', `Could not send feedback. Please reach out to David directly. (${err.message})`, false);
  }
}

export const config = { runtime: 'edge' };
