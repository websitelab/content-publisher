import { Octokit } from 'octokit';
import { log } from './utils.js';

const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

function parseOwnerRepo(repo) {
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
}

function extractTitle(frontmatter) {
  const match = frontmatter.match(/^title:\s*"(.+?)"\s*$/m);
  return match ? match[1] : null;
}

export async function getExistingTitles(repo, contentPath) {
  const { owner, repo: repoName } = parseOwnerRepo(repo);

  let files;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path: contentPath,
    });
    files = Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }

  const mdFiles = files.filter(f => f.name.endsWith('.md'));
  if (mdFiles.length === 0) return [];

  const titles = [];
  for (const file of mdFiles) {
    try {
      const { data: raw } = await octokit.rest.repos.getContent({
        owner,
        repo: repoName,
        path: file.path,
        mediaType: { format: 'raw' },
      });

      const title = extractTitle(String(raw));
      if (title) titles.push(title);
    } catch {
      // skip files that can't be read
    }
  }

  return titles;
}

export async function checkExistingPR(repo) {
  const { owner, repo: repoName } = parseOwnerRepo(repo);

  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo: repoName,
    state: 'open',
  });

  return prs.some(pr =>
    pr.labels.some(label => label.name === 'blog-publisher')
  );
}

export async function getVercelPreviewUrl(repo, commitSha, maxAttempts = 10) {
  const { owner, repo: repoName } = parseOwnerRepo(repo);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Use deployments API — environment_url gives the actual preview domain
      const { data: deployments } = await octokit.rest.repos.listDeployments({
        owner,
        repo: repoName,
        sha: commitSha,
      });

      for (const dep of deployments) {
        const { data: depStatuses } = await octokit.rest.repos.listDeploymentStatuses({
          owner,
          repo: repoName,
          deployment_id: dep.id,
        });
        const success = depStatuses.find(s => s.state === 'success' && s.environment_url);
        if (success) return success.environment_url;
      }
    } catch {
      // ignore and retry
    }

    await new Promise(r => setTimeout(r, 10000));
  }

  return null;
}

export async function createBlogPR(repo, slug, markdownContent, imageBuffer, site) {
  const { owner, repo: repoName } = parseOwnerRepo(repo);

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repoName });
    const defaultBranch = repoData.default_branch;

    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
    });
    const latestCommitSha = refData.object.sha;

    const { data: commitData } = await octokit.rest.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    const { data: mdBlob } = await octokit.rest.git.createBlob({
      owner,
      repo: repoName,
      content: markdownContent,
      encoding: 'utf-8',
    });

    const treeItems = [
      {
        path: `${site.contentPath}/${slug}.md`,
        mode: '100644',
        type: 'blob',
        sha: mdBlob.sha,
      },
    ];

    if (imageBuffer) {
      const { data: imgBlob } = await octokit.rest.git.createBlob({
        owner,
        repo: repoName,
        content: imageBuffer.toString('base64'),
        encoding: 'base64',
      });

      treeItems.push({
        path: `${site.imagePath}/${slug}.webp`,
        mode: '100644',
        type: 'blob',
        sha: imgBlob.sha,
      });
    }

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo: repoName,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo: repoName,
      message: `Add blog post: ${slug}`,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    let branchName = `blog/auto/${slug}`;
    try {
      await octokit.rest.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      });
    } catch (err) {
      if (err.status === 422) {
        branchName = `blog/auto/${slug}-${Date.now()}`;
        await octokit.rest.git.createRef({
          owner,
          repo: repoName,
          ref: `refs/heads/${branchName}`,
          sha: newCommit.sha,
        });
      } else {
        throw err;
      }
    }

    const title = extractTitle(markdownContent) || slug;

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo: repoName,
      title,
      body: 'Auto-generated blog post by Blog Publisher\n\n---\n*Review and merge to publish.*',
      head: branchName,
      base: defaultBranch,
    });

    try {
      await octokit.rest.issues.addLabels({
        owner,
        repo: repoName,
        issue_number: pr.number,
        labels: ['blog-publisher', 'auto-generated'],
      });
    } catch {
      log(site, 'Could not add labels — they may not exist in the repo');
    }

    // Return PR with branch name for preview URL lookup
    pr._branchName = branchName;
    return pr;
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      const scope = err.response?.headers?.['x-oauth-scopes'] || 'unknown';
      log(site, `GitHub permission error (${err.status}): token scopes [${scope}] — ensure repo and PR write access`);
    } else {
      log(site, `GitHub API error: ${err.message}`);
    }
    return null;
  }
}
