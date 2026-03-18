# Blog Publisher — Build Prompt

## What This Is

A standalone automated blog publisher for **Website Lab**.
Runs as a **GitHub Action** on a weekly schedule, researches current topics
using **Gemini 2.5 Flash with Google Search grounding**, writes evidence-based
articles, and submits them as **pull requests** to multiple client Astro websites
for **human review before publishing**. An email notification is sent to a
designated reviewer with a preview link and approve/deny/edit options.
Vercel auto-deploys each site when the PR is merged.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  GitHub Action (scheduled weekly)                         │
│                                                          │
│  1. Read sites.json config                               │
│  2. For each site (× --count N posts):                   │
│     a. Query existing posts via GitHub API (dedup)       │
│     b. Gemini + Google Search → research current topics  │
│     c. Gemini Flash (JSON mode) → write article          │
│        - Evidence-based with outbound source links       │
│        - Internal links + CTAs + References section      │
│     d. Pexels API → fetch, score, deduplicate hero image │
│     e. GitHub API → create PR to site's repo             │
│  3. Send review email via Resend (to + cc)               │
│     → Preview link (Vercel preview deployment)           │
│     → Approve / Deny / Edit+Feedback options             │
│  4. Reviewer approves → PR merged → Vercel deploys       │
└──────────────────────────────────────────────────────────┘
```

**No Vercel project needed for this tool.** It runs entirely as a GitHub Action.
Zero cron slots consumed. Free within GitHub Actions minutes.

---

## Tech Stack

| Layer              | Tool                                       |
|--------------------|--------------------------------------------|
| Orchestration      | GitHub Actions (scheduled)                 |
| Research           | Gemini 2.5 Flash + Google Search grounding |
| Writing            | Gemini 2.5 Flash API (JSON mode)           |
| Images             | Pexels API (free tier)                     |
| Image processing   | Sharp (WebP conversion + compression)      |
| Publishing         | GitHub REST API (Octokit)                  |
| Review emails      | Resend API                                 |
| Target sites       | Astro content collections                  |
| Hosting            | Vercel (auto-deploy on push/merge)         |

---

## CLI Flags

```bash
node scripts/publish.js                    # Standard run (1 post per site)
node scripts/publish.js --dry-run          # Generate but don't create PRs/emails
node scripts/publish.js --count 6          # Batch: 6 posts per site
node scripts/publish.js --site example.com # Only process matching sites
node scripts/publish.js --count 6 --site example.com --dry-run  # Combined
```

| Flag          | Purpose                                              |
|---------------|------------------------------------------------------|
| `--dry-run`   | Generate content but skip PRs and emails             |
| `--count N`   | Generate N posts per site (default: 1)               |
| `--site URL`  | Only process sites whose siteUrl contains this string |

In batch mode (`--count > 1`), the existing-PR check is skipped and titles
accumulate across iterations for dedup.

---

## Two-Phase Content Generation

### Phase 1: Research (Google Search Grounding)

Gemini searches the web for current topics relevant to the site's industry:
- Recent peer-reviewed studies and meta-analyses
- New guidelines from professional organizations
- Trending topics the target audience is searching for
- Seasonal or timely concerns

Returns a research brief with source URLs extracted from grounding metadata.

### Phase 2: Write (JSON Mode)

A second Gemini call writes the article based on the research brief. The prompt
enforces:

- **Outbound links (3-5)**: Every cited claim links to its source (journals, .gov, professional orgs)
- **Internal links (2-3)**: Links to site service/contact pages from `internalLinks` config
- **CTAs (2)**: Mid-article + closing call to action with booking/contact links
- **TL;DR**: 2-3 sentence summary near the top for AI snippet extraction
- **References section**: Numbered source list at the bottom
- **Business name accuracy**: Uses exact name from config, never abbreviated
- **SEO/AIO**: Keyword in first 100 words, FAQ-style headings, short paragraphs

### Business Name Discovery

The business name is read from `site.author` (or `site.businessName` if set).
It is injected into the prompt with strict instructions to use the exact spelling
every time. This prevents Gemini from inventing abbreviations or variations.

---

## Human-in-the-Loop Review Workflow

Every generated post goes through human review before publishing. No content is
auto-published (unless 24hr passes with no action).

### Flow

1. **Research** — Gemini searches the web for current topics
2. **Generate** — Gemini writes the post based on real research
3. **Image** — Pexels provides the hero image (scored, deduplicated)
4. **PR** — A pull request is created on the target site's repo
5. **Preview** — Vercel generates a preview deployment for the PR
6. **Email** — A review email is sent via Resend to the designated reviewer
7. **Action** — Reviewer decides:
   - **Approve** → merges PR → Vercel deploys → post is live
   - **Deny** → PR is closed, post is discarded
   - **Edit** → reviewer comments with feedback, post can be regenerated

### Review Email

- Casual, conversational tone (not corporate)
- Varied subject lines and openings (randomized from pool)
- Inline preview of first ~80 words
- Links to: full Vercel preview, approve, reject, leave feedback
- Auto-publish notice: merges after 24hr if no action taken
- Supports `to` + `cc` routing per site

---

## Site Config (`sites.json`)

```json
[
  {
    "repo": "websitelab/mispineandjoint.com",
    "contentPath": "src/content/articles",
    "imagePath": "public/images/articles",
    "industry": "multi-specialty healthcare: chiropractic, physical therapy, massage therapy",
    "tone": "professional, caring, knowledgeable but approachable",
    "audience": "patients in New Baltimore MI seeking non-surgical pain relief",
    "siteUrl": "https://mispineandjoint.com",
    "author": "Michigan Spine and Joint Center",
    "reviewEmail": "drdeboadegbenro@gmail.com",
    "ccEmail": "business@mispineandjoint.com",
    "internalLinks": [
      { "path": "/chiropractic", "label": "our chiropractic care" },
      { "path": "/physical-therapy", "label": "physical therapy services" },
      { "path": "/massage-therapy", "label": "massage therapy" }
    ]
  }
]
```

| Field            | Purpose                                              |
|------------------|------------------------------------------------------|
| `repo`           | GitHub org/repo for the target Astro site             |
| `contentPath`    | Where article markdown lives in the target repo       |
| `imagePath`      | Where article images live in the target repo          |
| `industry`       | Industry context fed to Gemini research + write       |
| `tone`           | Writing voice fed to Gemini prompt                    |
| `audience`       | Target reader fed to Gemini prompt                    |
| `siteUrl`        | Used for internal linking and SEO context              |
| `author`         | Business name — used exactly as-is in articles        |
| `businessName`   | (Optional) Override business name if different from author |
| `reviewEmail`    | Email address that receives review notifications (to) |
| `ccEmail`        | (Optional) CC address for review notifications        |
| `internalLinks`  | Pages on the site to link to from articles (SEO)      |

---

## Astro Content Collection Alignment

All target sites use Astro content collections. The generated posts must match
each site's content collection schema exactly:

```typescript
// src/content.config.ts (target site schema — for reference)
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string(),
    image: z.object({
      url: z.string(),
      alt: z.string(),
    }),
    tags: z.array(z.string()),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
```

The image URL in frontmatter is derived from `imagePath` by stripping everything
up to and including `public/`. So `public/images/articles` → `/images/articles`.
This handles subdirectory roots like `website/public/images/articles` correctly.

---

## Content Quality Standards

These rules apply to ALL generated text.

### Absolute Prohibitions

- **No em dashes.** Use commas, periods or semicolons instead.
- **No Oxford commas.** In lists of three or more, no comma before "and" or "or".
- **No AI-style language.** Banned: "game-changer", "in today's fast-paced world", "dive into", "navigating the landscape", "harness the power", "leverage", "elevate", "seamlessly", "robust", "cutting-edge", "streamline", "revolutionize", "comprehensive", "delve", "groundbreaking", "holistic approach", "unlock", "empower"

### Writing Style

- Short, direct sentences. Favor periods over semicolons.
- Match the site's tone exactly.
- Use contractions naturally.
- No filler introductions. Get to the point in the first sentence.
- Active voice.

### Evidence & Linking

- Every major claim must cite a source with an outbound link
- 3-5 outbound links to authoritative sources per article
- 2-3 internal links to site pages per article
- References section at the bottom with numbered source list
- Never fabricate statistics, study names, or citations

### SEO & AIO Best Practices

- **Title** under 70 characters, front-load the primary keyword
- **Meta description** under 160 characters with benefit or CTA
- **First 100 words** must contain the primary keyword
- **TL;DR** summary near the top (2-3 sentences) for AI extraction
- **H2/H3 headings** with secondary keywords, FAQ-style where appropriate
- **Short paragraphs** (2-3 sentences) for readability and AI snippets
- **Tags** should match terms people actually search for
- **Slug** short, keyword-rich, lowercase, hyphenated
- **Image alt text** descriptive with a relevant keyword
- **Word count** 800-1200 words

### CTAs

- Mid-article CTA after a compelling point (natural, not salesy)
- Closing CTA encouraging the reader to book, call, or visit
- Tied to the article's evidence, not generic marketing language

---

## Image Handling

### Selection & Scoring

1. Search Pexels with the AI-generated `imageSearchQuery` (15 results)
2. Filter out photos already used in the current run (dedup via photo ID set)
3. Score remaining photos by relevance:
   - Clinical/treatment keywords in alt text (+2 each)
   - Landscape aspect ratio 1.4-2.0 (+3)
   - Source width ≥ 2000px (+1)
   - Generic portrait/selfie keywords (-3 each)
4. Pick the highest-scored unused photo
5. If all results are used, paginate to next page (up to 3 pages)

### Processing

- Resize to 1280px wide (maintain aspect ratio)
- Convert to WebP, quality 80 (target <200KB)
- Include in the PR commit alongside the markdown

### Fallback Cascade

1. Original search query (15 results, 3 pages)
2. First 3 words of the query
3. Industry-specific fallback (e.g., "chiropractic spine adjustment treatment")

Industry fallbacks are configured per-industry, not a generic "business office".

---

## GitHub API — PR-Based Publishing

Uses the **Git Trees + Blobs API** (via Octokit) to create a single atomic
commit containing both the markdown post and the image, then opens a PR.

### Steps per Post

1. Get the default branch SHA
2. Create a blob for the markdown file (utf-8)
3. Create a blob for the image file (base64)
4. Create a tree with both blobs
5. Create a commit pointing to the new tree
6. Create a new branch: `blog/auto/{slug}`
7. Create a PR from that branch to the default branch
8. Add labels: `blog-publisher`, `auto-generated`

---

## GitHub Action Workflow

```yaml
# .github/workflows/publish.yml
name: Weekly Blog Publisher

on:
  schedule:
    - cron: '0 14 * * 2'   # Every Tuesday at 10am EDT (2pm UTC)
  workflow_dispatch:         # manual trigger for testing

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: node scripts/publish.js
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_PAT: ${{ secrets.ORG_GITHUB_PAT }}
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          REVIEW_SECRET: ${{ secrets.REVIEW_SECRET }}
          REVIEW_API_URL: https://blog-publisher-iota.vercel.app
```

---

## Secrets Required

Set on the blog-publisher repo: `gh secret set <NAME> --repo websitelab/blog-publisher`

| Secret            | Purpose                                        |
|-------------------|------------------------------------------------|
| `GEMINI_API_KEY`  | Gemini 2.5 Flash API key                       |
| `ORG_GITHUB_PAT`  | PAT with Contents:write + PRs on target repos  |
| `PEXELS_API_KEY`  | Pexels image API key (free tier)               |
| `RESEND_API_KEY`  | Resend email API key                           |
| `REVIEW_SECRET`   | HMAC secret for review action tokens           |

The PAT needs these permissions on the target repos:
- `Contents: Read and Write` (to create branches and commits)
- `Pull requests: Read and Write` (to create and manage PRs)
- `Metadata: Read` (required for all fine-grained PATs)

---

## Project Structure

```
blog-publisher/
├── .github/
│   └── workflows/
│       ├── publish.yml          # Weekly blog publisher (Tues 10am EDT)
│       ├── regenerate.yml       # Revise post from reviewer feedback
│       └── auto-publish.yml     # Auto-merge PRs after 24 hours
├── api/
│   ├── approve.js               # Vercel serverless — merge PR
│   ├── deny.js                  # Vercel serverless — close PR
│   ├── feedback.js              # Vercel serverless — feedback form + trigger regen
│   └── utils.js                 # HMAC token verification, branded HTML responses
├── scripts/
│   ├── publish.js               # Main orchestrator (--count, --site, --dry-run)
│   ├── generate.js              # Two-phase: research (grounded) + write (JSON)
│   ├── regenerate.js            # Revise existing post from feedback
│   ├── auto-publish.js          # Merge stale PRs (24hr+)
│   ├── images.js                # Pexels fetch, score, deduplicate + Sharp
│   ├── github.js                # Octokit: PR creation, dedup, preview URL
│   ├── email.js                 # Resend review email (to + cc, branded)
│   └── utils.js                 # Slugify, buildMarkdown, validation, logging
├── templates/
│   └── review-email.html        # Email template — Website Lab branded
├── vercel.json                  # Vercel config for review API
├── sites.json                   # Site config (multi-site)
├── package.json
├── .gitignore
└── prompt.md                    # This file
```

---

## Key Design Decisions

- **Two-phase generation** — research grounding + writing ensures evidence-based content with real sources
- **GitHub Action over Vercel cron** — 6hr execution limit vs 800s, no cron slots used, free
- **Gemini Flash** — cheap, fast, supports Google Search grounding and JSON mode
- **Image dedup** — tracks used Pexels photo IDs in-memory across batch runs
- **Image scoring** — prefers clinical/treatment imagery, penalizes generic portraits
- **Industry-specific fallbacks** — better default images than generic stock photos
- **PRs over direct commits** — enables human review, Vercel preview deployments, audit trail
- **Review API on Vercel** — clients approve/deny/feedback via HMAC-signed URLs, no GitHub account needed
- **Auto-publish after 24hr** — PRs merge automatically if no action taken
- **Feedback triggers regeneration** — Gemini revises post based on feedback
- **CC support** — review emails route to reviewer (to) + backup inbox (cc)
- **Business name enforcement** — exact name from config, never abbreviated by AI
- **Batch mode** — `--count N` generates multiple posts with accumulated dedup
- **Image URL derivation** — strips `public/` prefix from `imagePath`, handles subdirectory roots
- **Generic framing** — prompts work for any industry, not just healthcare

---

## Edge Cases

- **Duplicate topics** — query existing posts + accumulate titles in batch mode
- **Duplicate images** — track used photo IDs, paginate through results
- **Gemini rate limits** — 5-second delay between posts, retry once on 429/503
- **Gemini bad JSON** — validate all required fields, skip post on persistent failure
- **Research failure** — falls back to standard generation without grounding
- **Pexels no results** — cascade: specific query → shorter query → industry fallback
- **Subdirectory repos** — `imagePath` like `website/public/images/articles` handled correctly
- **PR already exists** — checked in single-post mode, skipped in batch mode
- **Email failure** — logged but doesn't fail the run

---

## Cost Estimate

For 3 sites × 4 articles/month (weekly schedule) = 12 articles/month:

| Service    | Usage                | Monthly Cost |
|------------|----------------------|-------------|
| Gemini API | 24 calls (research + write) | ~$1-2 |
| Pexels     | Free tier            | $0          |
| Resend     | Free tier (100/day)  | $0          |
| GitHub Actions | ~15 min/month   | $0          |
| **Total**  |                      | **~$1-3**   |
