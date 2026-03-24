import { GoogleGenerativeAI } from '@google/generative-ai';
import { validatePost, log } from './utils.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Research model uses Google Search grounding for real-time topic discovery
const researchModel = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  tools: [{ googleSearch: {} }],
});

// Writing model uses JSON mode for structured output
const writeModel = genAI.getGenerativeModel({
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

/**
 * Phase 1: Research current topics using Google Search grounding.
 * Returns a research brief with real sources and URLs.
 */
async function researchTopics(site, existingTitles) {
  const titlesBlock = existingTitles.length
    ? existingTitles.map(t => `- ${t}`).join('\n')
    : 'None yet';

  const prompt = `You are a content researcher for a ${site.industry} business.
Their audience is ${site.audience}.
Their website is ${site.siteUrl}.

Search for CURRENT hot topics, recent research, and trending discussions relevant to ${site.industry}.

Look for:
- Recent peer-reviewed studies or meta-analyses (2024-2026)
- New guidelines from professional organizations or government bodies
- Trending topics the target audience is searching for right now
- Seasonal or timely concerns
- Common misconceptions being discussed in the media
${site.topicConstraints ? `\nTOPIC CONSTRAINTS (MUST follow):\n${site.topicConstraints}` : ''}

Already published (avoid these topics):
${titlesBlock}

Return a detailed research brief with:
1. THREE topic ideas ranked by relevance and timeliness
2. For each topic: the key findings, source URLs, and why it matters to the audience
3. Specific statistics, study names, or guideline references that can be cited

Focus on topics that would genuinely help the target audience make better decisions.`;

  const result = await researchModel.generateContent(prompt);
  const text = result.response.text();

  // Extract grounding metadata (source URLs from Google Search)
  const groundingMeta = result.response.candidates?.[0]?.groundingMetadata;
  const groundingChunks = groundingMeta?.groundingChunks || [];
  const sourceUrls = groundingChunks
    .filter(c => c.web?.uri)
    .map(c => ({ title: c.web.title || '', url: c.web.uri }));

  return { brief: text, sources: sourceUrls };
}

/**
 * Phase 1.5: Discover the business name from site context.
 * Queries the site's homepage to extract the correct business name.
 */
async function discoverBusinessName(site) {
  // If site.businessName is set in config, use it
  if (site.businessName) return site.businessName;

  // Otherwise derive from site.author or siteUrl context
  // The author field in sites.json is the most reliable source
  return site.author;
}

/**
 * Phase 2: Write the article using the research brief.
 * Produces evidence-based content with outbound links, CTAs, and references.
 */
function buildWritePrompt(site, research, existingTitles, businessName) {
  const titlesBlock = existingTitles.length
    ? existingTitles.join('\n')
    : 'None yet';

  return `You are a professional content writer for a ${site.industry} business.
The business name is: "${businessName}" (use this EXACT name whenever referencing the business. NEVER abbreviate, shorten, or modify it.)
The website is ${site.siteUrl}.
The audience is ${site.audience}.
Write in a ${site.tone} tone.

RESEARCH BRIEF (from current literature and news):
${research.brief}

SOURCE URLS FOUND DURING RESEARCH:
${research.sources.map(s => `- ${s.title}: ${s.url}`).join('\n') || 'No specific URLs found; use well-known authoritative organization URLs instead.'}

Write an 800-1200 word article based on this research. Choose the most compelling topic from the brief.
${site.topicConstraints ? `\nTOPIC CONSTRAINTS (MUST follow):\n${site.topicConstraints}\nIf the research brief only contains restricted topics, ignore it and write about a practical everyday topic instead.` : ''}

OUTBOUND LINKS (MANDATORY):
- Every claim backed by research MUST include an outbound markdown link to the source.
- Include 3-5 outbound links total to authoritative sources (journals, .gov sites, professional organizations, etc.).
- Format: [descriptive anchor text](https://source-url.com)
- Link directly to the study, guideline, or article referenced. Do NOT use generic "click here" anchors.
- If you reference a statistic, the sentence MUST contain a link to where it came from.

INTERNAL LINKS (MANDATORY):
- Include 2-3 internal links naturally woven into the body text: ${formatInternalLinks(site)}
- Also link to the articles listing page (${site.siteUrl}/articles) at least once if it fits naturally.
- Internal links should use the full URL format: ${site.siteUrl}/page-path

CALLS TO ACTION (MANDATORY):
- Include at least TWO clear CTAs within the article:
  1. A mid-article CTA after making a compelling point (e.g., "If you're experiencing [symptom], [business name] can help. [Link to contact/booking page].")
  2. A strong closing CTA at the end of the article encouraging the reader to take the next step (book, call, visit, etc.)
- CTAs should feel natural, not salesy. Tie them to the article's evidence.

SEO & AIO BEST PRACTICES (MANDATORY):
- Title: under 70 characters, front-load the primary keyword
- Meta description: under 160 characters with a clear benefit or call to action
- H2/H3 headings: include secondary keywords naturally
- First 100 words: include the primary keyword
- TL;DR or key takeaway: include a brief summary near the top (2-3 sentences) that AI assistants can extract
- FAQ-style subheadings where appropriate (e.g., "What does the research say about...?")
- Use short paragraphs (2-3 sentences max) for readability and AI snippet extraction
- 3-5 relevant tags (lowercase, terms people actually search for)

REFERENCES SECTION (MANDATORY):
- End the article with a "### References" section
- List each source cited in the article as a numbered markdown link
- Format: 1. [Source Title or Description](https://url)
- Only include sources that were actually referenced in the body text

BUSINESS NAME RULES:
- The business name is "${businessName}". Use this EXACT spelling and formatting every time.
- NEVER abbreviate it, use acronyms, or modify it in any way.
- When recommending the reader seek care, name "${businessName}" specifically.

IMAGE SEARCH QUERY:
- Provide a specific Pexels search query for a professional, relevant image
- For healthcare: use terms like spine treatment, physical therapy session, chiropractic adjustment, rehabilitation exercise
- For other industries: use terms specific to the business type
- AVOID generic lifestyle/portrait queries. The image should be relevant to the article topic.
- Be specific: "chiropractor adjusting patient spine" is better than "people posture"
${site.imageExclude?.length ? `- NEVER use search terms related to: ${site.imageExclude.join(', ')}. Keep imagery grounded in real clinical and wellness settings.` : ''}

CRITICAL WRITING RULES:
- NEVER use em dashes. Use commas, periods or semicolons instead.
- NEVER use the Oxford comma. In a list of three or more items, do NOT put a comma before "and" or "or".
- NEVER use AI-style language: "game-changer", "in today's fast-paced world", "it's important to note", "dive into", "navigating the landscape", "harness the power", "at the end of the day", "leverage", "elevate", "seamlessly", "robust", "cutting-edge", "streamline", "revolutionize", "comprehensive", "delve", "groundbreaking", "holistic approach", "unlock", "empower"
- Do NOT fabricate statistics, company names or case studies
- Write in short, punchy sentences. Favor periods over semicolons.
- Match the ${site.tone} exactly.

The following topics have already been published. Pick something NEW:
${titlesBlock}

Return as JSON:
{
  "title": "string",
  "description": "string (under 160 chars)",
  "tags": ["string"],
  "body": "string (markdown formatted, 800-1200 words, with outbound links, internal links, CTAs, and References section)",
  "imageAlt": "string (descriptive alt text for hero image)",
  "imageSearchQuery": "string (specific Pexels search query for relevant professional image)"
}`;
}

async function callGemini(site, research, existingTitles, businessName) {
  const prompt = buildWritePrompt(site, research, existingTitles, businessName);
  const result = await writeModel.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text);
}

export async function generatePost(site, existingTitles) {
  // Phase 1: Research
  let research;
  try {
    log(site, 'Researching current topics...');
    research = await researchTopics(site, existingTitles);
    log(site, `Research complete: ${research.sources.length} source URLs found`);
  } catch (err) {
    log(site, `Research failed: ${err.message}. Falling back to standard generation.`);
    research = { brief: 'No research available. Write about a practical, evidence-based topic relevant to the business.', sources: [] };
  }

  // Phase 1.5: Get correct business name
  const businessName = await discoverBusinessName(site);

  // Phase 2: Write the article
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const post = await callGemini(site, research, existingTitles, businessName);

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
