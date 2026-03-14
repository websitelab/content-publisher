import { Octokit } from 'octokit';
import { verifyReviewToken, htmlResponse } from './utils.js';

export default async function handler(req) {
  const url = new URL(req.url, `https://${req.headers.get('host')}`);
  const token = url.searchParams.get('token');
  const parsed = verifyReviewToken(token);

  if (!parsed) {
    return htmlResponse('Invalid Link', 'This review link is invalid or has expired.', false);
  }

  const [owner, repo] = parsed.repo.split('/');
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  try {
    // Check PR state first
    const { data: pr } = await octokit.rest.pulls.get({
      owner, repo, pull_number: parsed.pr,
    });

    if (pr.state !== 'open') {
      return htmlResponse('Already Handled', `This post has already been ${pr.merged ? 'published' : 'removed'}. No action needed.`);
    }

    // Merge the PR
    await octokit.rest.pulls.merge({
      owner, repo, pull_number: parsed.pr,
      merge_method: 'squash',
    });

    return htmlResponse('Post Approved!', 'The blog post has been approved and will be live on the site shortly. You can close this tab.');
  } catch (err) {
    return htmlResponse('Something Went Wrong', `Could not approve the post. Please reach out to David. (${err.message})`, false);
  }
}

export const config = { runtime: 'edge' };
