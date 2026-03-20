import { Octokit } from 'octokit';
import { verifyReviewToken, htmlResponse } from './utils.js';
import { postToFacebook } from '../scripts/facebook.js';
import sites from '../sites.json' with { type: 'json' };

export default async function handler(req, res) {
  const token = req.query.token;
  const parsed = verifyReviewToken(token);

  if (!parsed) {
    return res.status(400).send(htmlResponse('Invalid Link', 'This review link is invalid or has expired.', false));
  }

  const [owner, repo] = parsed.repo.split('/');
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  try {
    const { data: pr } = await octokit.rest.pulls.get({
      owner, repo, pull_number: parsed.pr,
    });

    if (pr.state !== 'open') {
      return res.send(htmlResponse('Already Handled', `This post has already been ${pr.merged ? 'published' : 'removed'}. No action needed.`));
    }

    await octokit.rest.pulls.merge({
      owner, repo, pull_number: parsed.pr,
      merge_method: 'squash',
    });

    // Facebook posting — isolated so it never breaks the approval response
    try {
      const site = sites.find(s => s.repo === parsed.repo);
      if (site) {
        await postToFacebook(site, pr.title, pr.body);
      }
    } catch (fbErr) {
      console.error('Facebook posting failed:', fbErr.message);
    }

    return res.send(htmlResponse('Post Approved!', 'The blog post has been approved and will be live on the site shortly. You can close this tab.'));
  } catch (err) {
    return res.status(500).send(htmlResponse('Something Went Wrong', `Could not approve the post. Please reach out to David. (${err.message})`, false));
  }
}
