import { GoogleGenerativeAI } from '@google/generative-ai';
import { validatePost, log } from './utils.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.7,
  },
});

function formatInternalLinks(site) {
  if (!site.internalLinks?.length) return 'None provided';
  return site.internalLinks
    .map(link => `[${link.label}](${site.siteUrl}${link.path})`)
    .join(', ');
}

function buildPrompt(site, existingTitles) {
  const titlesBlock = existingTitles.length
    ? existingTitles.join('\n')
    : 'None yet';

  return `You are a blog writer for a ${site.industry} business.
The website is ${site.siteUrl}.
The audience is ${site.audience}.
Write in a ${site.tone} tone.

Write an 800-1200 word blog post about a topic relevant to ${site.industry}.

Requirements:
- Practical, specific, and actionable. No generic filler.
- Write like someone who actually works in this industry
- Include real-world examples and scenarios
- SEO-optimized with natural keyword usage in headings and body text
- Include 2-3 internal links naturally woven into the body text using these site pages: ${formatInternalLinks(site)}
- Include a compelling title (under 70 characters)
- Include a meta description (under 160 characters)
- Include 3-5 relevant tags (lowercase)
- Include a descriptive alt text for a hero image related to the topic
- Include a search query for finding a relevant stock photo

CRITICAL WRITING RULES:
- NEVER use em dashes. Use commas, periods or semicolons instead.
- NEVER use the Oxford comma. In a list of three or more items, do NOT put a comma before "and" or "or".
- NEVER use AI-style language: "game-changer", "in today's fast-paced world", "it's important to note", "dive into", "navigating the landscape", "harness the power", "at the end of the day", "leverage", "elevate", "seamlessly", "robust", "cutting-edge", "streamline", "revolutionize", "comprehensive", "delve"
- Do NOT fabricate statistics, company names or case studies
- Write in short, punchy sentences. Avoid compound sentences strung together with dashes.
- Match the ${site.tone} exactly. If it says "blue collar" then write like a tradesperson, not a marketing copywriter.

The following topics have already been published. Pick something NEW:
${titlesBlock}

Return as JSON:
{
  "title": "string",
  "description": "string (under 160 chars)",
  "tags": ["string"],
  "body": "string (markdown formatted, 800-1200 words, with internal links)",
  "imageAlt": "string (descriptive alt text for hero image)",
  "imageSearchQuery": "string (Pexels search query for a relevant landscape photo)"
}`;
}

async function callGemini(site, existingTitles) {
  const prompt = buildPrompt(site, existingTitles);
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text);
}

export async function generatePost(site, existingTitles) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const post = await callGemini(site, existingTitles);

      const errors = validatePost(post);
      if (errors.length > 0) {
        log(site, `Validation failed: ${errors.join(', ')}`);
        if (attempt === 0) {
          log(site, 'Retrying in 3 seconds...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        return null;
      }

      log(site, `Generated: "${post.title}"`);
      return post;
    } catch (err) {
      log(site, `Generation error: ${err.message}`);
      if (attempt === 0) {
        log(site, 'Retrying in 3 seconds...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        return null;
      }
    }
  }

  return null;
}
