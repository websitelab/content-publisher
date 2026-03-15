import { Octokit } from 'octokit';
import { verifyReviewToken, htmlResponse } from './utils.js';

export default async function handler(req, res) {
  const token = req.query.token;
  const parsed = verifyReviewToken(token);

  if (!parsed) {
    return res.status(400).send(htmlResponse('Invalid Link', 'This review link is invalid or has expired.', false));
  }

  if (req.method === 'GET') {
    return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Request Changes — Website Lab</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; background: #24485F; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .logo { margin-bottom: 32px; }
  .logo img { height: 44px; }
  .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 520px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
  h1 { font-size: 22px; color: #111; margin-bottom: 8px; }
  p { color: #555; font-size: 14px; margin-bottom: 20px; }
  textarea { width: 100%; min-height: 120px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-family: inherit; font-size: 15px; resize: vertical; }
  button { margin-top: 16px; padding: 12px 24px; background: #CB9E57; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 600; }
  button:hover { background: #b8893e; }
  .footer { margin-top: 32px; font-size: 12px; color: rgba(255,255,255,0.5); }
  .footer a { color: #CB9E57; text-decoration: none; }
</style></head>
<body>
  <div class="logo"><img src="https://www.websitelab.biz/images/logo-white.webp" alt="Website Lab" height="44"></div>
  <div class="card">
    <h1>Request Changes</h1>
    <p>What changes would you like to see? We'll revise the post and send you an updated version.</p>
    <form method="POST" action="/api/feedback?token=${encodeURIComponent(token)}">
      <textarea name="feedback" placeholder="e.g. Change the title, add more detail about pricing, make the tone more casual..." required></textarea>
      <button type="submit">Send Feedback</button>
    </form>
  </div>
  <div class="footer">A service by <a href="https://www.websitelab.biz">Website Lab</a></div>
</body></html>`);
  }

  // POST = submit feedback as PR comment + trigger regeneration
  try {
    const feedback = req.body?.feedback;

    if (!feedback || !feedback.trim()) {
      return res.status(400).send(htmlResponse('No Feedback', 'Please go back and enter your feedback.', false));
    }

    const [owner, repo] = parsed.repo.split('/');
    const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

    // Post feedback as PR comment
    await octokit.rest.issues.createComment({
      owner, repo,
      issue_number: parsed.pr,
      body: `**Reviewer feedback:**\n\n${feedback.trim()}`,
    });

    // Trigger regeneration workflow on blog-publisher repo
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: 'websitelab',
        repo: 'blog-publisher',
        workflow_id: 'regenerate.yml',
        ref: 'main',
        inputs: {
          pr_repo: parsed.repo,
          pr_number: String(parsed.pr),
          feedback: feedback.trim(),
        },
      });
    } catch (err) {
      // Don't fail the response if workflow trigger fails — feedback was still posted
      console.error('Failed to trigger regeneration workflow:', err.message);
    }

    return res.send(htmlResponse('Feedback Sent!', "Your feedback has been received. We'll revise the post and send you an updated version. You can close this tab."));
  } catch (err) {
    return res.status(500).send(htmlResponse('Something Went Wrong', `Could not send feedback. Please reach out to David directly. (${err.message})`, false));
  }
}
