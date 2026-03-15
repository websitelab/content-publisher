import { createHmac } from 'node:crypto';

const REVIEW_SECRET = process.env.REVIEW_SECRET?.trim();

export function createReviewToken(repo, prNumber) {
  const payload = `${repo}:${prNumber}`;
  const sig = createHmac('sha256', REVIEW_SECRET).update(payload).digest('hex');
  const data = Buffer.from(JSON.stringify({ repo, pr: prNumber })).toString('base64url');
  return `${data}.${sig}`;
}

export function verifyReviewToken(token) {
  if (!token || !REVIEW_SECRET) return null;

  const [data, sig] = token.split('.');
  if (!data || !sig) return null;

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString());
    const expected = createHmac('sha256', REVIEW_SECRET)
      .update(`${parsed.repo}:${parsed.pr}`)
      .digest('hex');

    if (sig !== expected) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function htmlResponse(title, message, success = true) {
  const color = success ? '#16a34a' : '#dc2626';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9f9f9; }
  .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 480px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  h1 { font-size: 24px; color: ${color}; margin-bottom: 12px; }
  p { color: #555; line-height: 1.6; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
