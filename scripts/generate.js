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

  const prompt = `You are a medical content researcher for a ${site.industry} practice.
Their audience is ${site.audience}.

Search for CURRENT hot topics, recent research, and trending discussions in musculoskeletal health, sports medicine, chiropractic care, physical therapy, and pain management.

Look for:
- Recent peer-reviewed studies or meta-analyses (2024-2026)
- New clinical guidelines from medical organizations (ACA, APTA, WHO, etc.)
- Trending health topics patients are searching for right now
- Seasonal or timely health concerns
- Common patient misconceptions being discussed in the media

Already published (avoid these topics):
${titlesBlock}

Return a detailed research brief with:
1. THREE topic ideas ranked by relevance and timeliness
2. For each topic: the key findings, source URLs, and why it matters to patients
3. Specific statistics, study names, or guideline references that can be cited

Focus on topics that would genuinely help patients make better decisions about their care.`;

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
 * Phase 2: Write the article using the research brief.
 * Produces evidence-based content with outbound links.
 */
function buildWritePrompt(site, research, existingTitles) {
  const titlesBlock = existingTitles.length
    ? existingTitles.join('\n')
    : 'None yet';

  return `You are a healthcare content writer for a ${site.industry} practice.
The website is ${site.siteUrl}.
The audience is ${site.audience}.
Write in a ${site.tone} tone.

RESEARCH BRIEF (from current medical literature and news):
${research.brief}

SOURCE URLS FOUND DURING RESEARCH:
${research.sources.map(s => `- ${s.title}: ${s.url}`).join('\n') || 'No specific URLs found; use well-known medical organization URLs instead.'}

Write an 800-1200 word article based on this research. Choose the most compelling topic from the brief.

EVIDENCE-BASED WRITING REQUIREMENTS:
- Ground every major claim in the research above. Reference specific studies, guidelines, or organizations by name.
- Include 2-4 outbound links to authoritative sources (medical journals, .gov sites, professional organizations like ACA, APTA, NIH, Mayo Clinic, etc.). Format as markdown links woven naturally into the text.
- When citing a study, name the journal, year, and key finding. Do NOT fabricate citations.
- If the research brief contains statistics, use them with attribution.
- Explain what the evidence means for the patient in practical terms.

INTERNAL LINKS:
- Include 2-3 internal links naturally woven in: ${formatInternalLinks(site)}

SEO & FORMAT:
- Compelling title under 70 characters, front-load the primary keyword
- Meta description under 160 characters with benefit or call to action
- 3-5 relevant tags (lowercase)
- H2/H3 headings with secondary keywords
- Descriptive alt text for a hero image related to the topic

IMAGE SEARCH QUERY:
- Provide a specific Pexels search query for a clinical, professional healthcare image
- Use terms like: spine treatment, physical therapy session, chiropractic adjustment, rehabilitation exercise, patient stretching, sports medicine, spine model
- AVOID generic lifestyle/portrait queries. The image should look CLINICAL or TREATMENT-related.
- Be specific: "chiropractor adjusting patient spine" is better than "people posture"

CRITICAL WRITING RULES:
- NEVER use em dashes. Use commas, periods or semicolons instead.
- NEVER use the Oxford comma. In a list of three or more items, do NOT put a comma before "and" or "or".
- NEVER use AI-style language: "game-changer", "in today's fast-paced world", "it's important to note", "dive into", "navigating the landscape", "harness the power", "at the end of the day", "leverage", "elevate", "seamlessly", "robust", "cutting-edge", "streamline", "revolutionize", "comprehensive", "delve", "groundbreaking", "holistic approach"
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
  "body": "string (markdown formatted, 800-1200 words, with outbound and internal links)",
  "imageAlt": "string (descriptive alt text for hero image)",
  "imageSearchQuery": "string (specific Pexels search query for clinical/treatment healthcare image)"
}`;
}

async function callGemini(site, research, existingTitles) {
  const prompt = buildWritePrompt(site, research, existingTitles);
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
    research = { brief: 'No research available. Write about a practical, evidence-based topic relevant to the practice.', sources: [] };
  }

  // Phase 2: Write the article
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const post = await callGemini(site, research, existingTitles);

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
