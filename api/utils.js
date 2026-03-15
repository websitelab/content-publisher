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

function brandedPage(title, message, success = true) {
  const iconColor = success ? '#16a34a' : '#dc2626';
  const icon = success
    ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Website Lab</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; background: #24485F; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .logo { margin-bottom: 32px; }
  .logo img { height: 44px; }
  .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
  .icon { margin-bottom: 20px; }
  h1 { font-size: 22px; color: #111; margin-bottom: 12px; }
  p { color: #555; line-height: 1.6; font-size: 15px; }
  .footer { margin-top: 32px; font-size: 12px; color: rgba(255,255,255,0.5); }
  .footer a { color: #CB9E57; text-decoration: none; }
</style></head>
<body>
  <div class="logo"><img src="https://www.websitelab.biz/images/logo-white.webp" alt="Website Lab" height="44"></div>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
  <div class="footer">A service by <a href="https://www.websitelab.biz">Website Lab</a></div>
</body></html>`;
}

export function htmlResponse(title, message, success = true) {
  return brandedPage(title, message, success);
}
