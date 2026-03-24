/**
 * Shared utilities for the content publisher.
 */

/**
 * Convert a title to a URL-friendly slug.
 * Lowercase, hyphenated, no special characters.
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Get today's date as YYYY-MM-DD.
 */
export function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Build frontmatter string from post data and site config.
 */
export function buildMarkdown(post, site, slug) {
  const imageUrlPrefix = '/' + site.imagePath.split('public/').pop();
  const frontmatter = [
    '---',
    `title: "${post.title.replace(/"/g, '\\"')}"`,
    `description: "${post.description.replace(/"/g, '\\"')}"`,
    `pubDate: ${todayISO()}`,
    `author: "${site.author}"`,
    'image:',
    `  url: "${imageUrlPrefix}/${slug}.webp"`,
    `  alt: "${post.imageAlt.replace(/"/g, '\\"')}"`,
    `tags: [${post.tags.map(t => `"${t}"`).join(', ')}]`,
    'draft: false',
    '---',
  ].join('\n');

  const disclaimer = site.disclaimer
    ? `\n\n---\n\n*${site.disclaimer}*\n`
    : '';

  return `${frontmatter}\n\n${post.body}${disclaimer}\n`;
}

/**
 * Validate that a Gemini response has all required fields.
 * Auto-fills recoverable fields (imageAlt, imageSearchQuery) instead of failing.
 * Returns an array of missing field names, or empty if valid.
 */
export function validatePost(post, site = null) {
  const missing = [];

  // Hard requirements — can't proceed without these
  if (!post.title) missing.push('title');
  if (!post.description) missing.push('description');
  if (!post.body) missing.push('body');
  if (!post.tags) missing.push('tags');
  if (post.tags && !Array.isArray(post.tags)) missing.push('tags (not an array)');

  // Soft requirements — auto-fill with sensible defaults
  if (!post.imageAlt && post.title) {
    post.imageAlt = `Article image for: ${post.title}`;
  }
  if (!post.imageSearchQuery) {
    post.imageSearchQuery = site?.industry
      ? site.industry.split(':')[0].trim()
      : (post.title || 'professional office').toLowerCase();
  }

  // Auto-truncate instead of failing
  if (post.title && post.title.length > 70) {
    post.title = post.title.slice(0, 67) + '...';
  }
  if (post.description && post.description.length > 160) {
    post.description = post.description.slice(0, 157) + '...';
  }

  return missing;
}

/**
 * Log with a prefix.
 */
export function log(site, message) {
  const name = site?.siteUrl || site || 'publisher';
  console.log(`[${name}] ${message}`);
}

/**
 * Sleep for ms milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
