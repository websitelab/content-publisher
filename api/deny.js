import { Octokit } from 'octokit';
import { verifyReviewToken, htmlResponse } from './utils.js';

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

    await octokit.rest.pulls.update({
      owner, repo, pull_number: parsed.pr,
      state: 'closed',
    });

    return res.send(htmlResponse('Post Removed', 'The blog post has been rejected and will not be published. You can close this tab.'));
  } catch (err) {
    return res.status(500).send(htmlResponse('Something Went Wrong', `Could not remove the post. Please reach out to David. (${err.message})`, false));
  }
}
