# Blog Publisher — Build Prompt

## What This Is

A standalone automated blog publisher for **Website Lab**.
Runs as a **GitHub Action** on a monthly schedule, generates SEO-optimized blog posts
using **Gemini 2.5 Flash**, and submits them as **pull requests** to multiple client
Astro websites for **human review before publishing**. An email notification is sent
to a designated reviewer with a preview link and approve/deny/edit options.
Vercel auto-deploys each site when the PR is merged.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  GitHub Action (scheduled monthly)                       │
│                                                          │
│  1. Read sites.json config                               │
│  2. For each site:                                       │
│     a. Query existing posts via GitHub API (dedup)       │
│     b. Gemini Flash → research + write post (JSON mode)  │
│     c. Pexels API → fetch + compress hero image          │
│     d. Build .md with Astro content collection schema    │
│     e. GitHub API → create PR to site's repo             │
│  3. Send review email via Resend                         │
│     → Preview link (Vercel preview deployment)           │
│     → Approve / Deny / Edit+Feedback options             │
│  4. Reviewer approves → PR merged → Vercel deploys       │
└──────────────────────────────────────────────────────────┘
```

**No Vercel project needed for this tool.** It runs entirely as a GitHub Action.
Zero cron slots consumed. Free within GitHub Actions minutes.

---

## Tech Stack

| Layer              | Tool                                  |
|--------------------|---------------------------------------|
| Orchestration      | GitHub Actions (scheduled)            |
| AI                 | Gemini 2.5 Flash API (JSON mode)      |
| Images             | Pexels API (free tier)                |
| Image processing   | Sharp (WebP conversion + compression) |
| Publishing         | GitHub REST API (Octokit)             |
| Review emails      | Resend API                            |
| Target sites       | Astro content collections             |
| Hosting            | Vercel (auto-deploy on push/merge)    |

---

## Human-in-the-Loop Review Workflow

Every generated post goes through human review before publishing. No content is
auto-published.

### Flow

1. **Generate** — Gemini writes the post, Pexels provides the hero image
2. **PR** — A pull request is created on the target site's repo containing:
   - The blog post markdown file (`src/content/blog/{slug}.md`)
   - The hero image (`public/images/blog/{slug}.webp`)
   - PR title = blog post title, PR body = meta description + preview info
3. **Preview** — Vercel automatically generates a preview deployment for the PR
4. **Email** — A review email is sent via Resend to the designated reviewer:
   - Rendered preview of the post (title, description, first ~200 words)
   - Link to the full Vercel preview deployment
   - Link to approve (merge the PR via GitHub)
   - Link to deny (close the PR via GitHub)
   - Link to edit / leave feedback (comment on the PR)
5. **Action** — Reviewer decides:
   - **Approve** → merges PR → Vercel deploys → post is live
   - **Deny** → PR is closed, post is discarded
   - **Edit** → reviewer comments with feedback, post can be regenerated

### Review Email Requirements

The review email must feel like a message from a person, not a system notification.

**Rules:**
- Casual, conversational tone. Not corporate. Not robotic.
- NEVER use em dashes or Oxford commas (same rules as blog posts)
- Vary the subject line and opening every time. No two emails should read the same.
- Keep it short. The email is a heads-up, not a report.
- Use a pool of subject line templates and opening lines, selected randomly.

**Subject line examples** (rotate, never repeat the same pattern):
- `New post for {siteName}: "{title}"`
- `Blog draft ready: {title}`
- `Take a look: new {siteName} blog post`
- `Fresh content for {siteName}`

**Email body must include:**
- Post title and a 1-2 sentence summary (not the full description)
- First ~150 words of the post body as an inline preview
- Link to the full Vercel preview deployment
- Link to approve (merge the PR on GitHub)
- Link to reject (close the PR)
- Link to leave feedback (comment on the PR)

**Example tone:**
```
Hey,

New blog post ready for blastingjack.com:

"When to Use Wet Blasting Instead of Dry"

Quick look at when wet abrasive blasting makes more sense, especially
on surfaces where dust control matters. Here's how it starts:

[preview text...]

Check the full preview here: [link]

Looks good? Approve it: [link]
Not quite right? Leave a note: [link]
Kill it: [link]
```

### Site Config for Review

Each site in `sites.json` specifies a `reviewEmail` — the person who reviews
posts for that site. Could be the business owner, a marketing contact, or a
shared inbox.

---

## Site Config (`sites.json`)

```json
[
  {
    "repo": "websitelab/blastingjack",
    "contentPath": "src/content/blog",
    "imagePath": "public/images/blog",
    "industry": "sandblasting and surface preparation",
    "tone": "blue collar, straightforward",
    "audience": "property managers, contractors, industrial facility managers",
    "siteUrl": "https://blastingjack.com",
    "author": "Blasting Jack",
    "reviewEmail": "review@websitelab.dev",
    "internalLinks": [
      { "path": "/services", "label": "our services" },
      { "path": "/about", "label": "about us" },
      { "path": "/contact", "label": "get a free quote" }
    ]
  },
  {
    "repo": "websitelab/pro-handyman.services",
    "contentPath": "src/content/blog",
    "imagePath": "public/images/blog",
    "industry": "handyman and home repair",
    "tone": "friendly, helpful, local",
    "audience": "homeowners in Fairfield County CT",
    "siteUrl": "https://pro-handyman.services",
    "author": "Pro Handyman",
    "reviewEmail": "review@websitelab.dev",
    "internalLinks": [
      { "path": "/services", "label": "our services" },
      { "path": "/about", "label": "about us" },
      { "path": "/contact", "label": "contact us" }
    ]
  }
]
```

Each entry defines a target site. The publisher loops through all entries on each run.

| Field            | Purpose                                              |
|------------------|------------------------------------------------------|
| `repo`           | GitHub org/repo for the target Astro site             |
| `contentPath`    | Where blog markdown lives in the target repo          |
| `imagePath`      | Where blog images live in the target repo             |
| `industry`       | Industry context fed to Gemini prompt                 |
| `tone`           | Writing voice fed to Gemini prompt                    |
| `audience`       | Target reader fed to Gemini prompt                    |
| `siteUrl`        | Used for internal linking and SEO context              |
| `author`         | Author name for frontmatter                           |
| `reviewEmail`    | Email address that receives review notifications       |
| `internalLinks`  | Pages on the site to link to from blog posts (SEO)    |

---

## Astro Content Collection Alignment

All target sites use Astro content collections. The generated posts must match
each site's content collection schema exactly. The standard blog schema across
Website Lab sites uses Zod validation:

```typescript
// src/content.config.ts (target site schema — for reference)
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
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

export const collections = { blog };
```

**The publisher must produce frontmatter that passes this schema validation.**
If a field is missing or the wrong type, the Astro build will fail. This is a
hard requirement — not optional.

---

## Content Quality Standards

These rules apply to ALL generated text: blog posts, email subjects, email bodies.

### Absolute Prohibitions

- **No em dashes.** Use commas, periods or semicolons instead.
- **No Oxford commas.** In lists of three or more, no comma before "and" or "or".
- **No AI-style language.** The output must read like a human wrote it, not a language model. Banned phrases include (but are not limited to): "game-changer", "in today's fast-paced world", "it's important to note", "dive into", "navigating the landscape", "harness the power", "at the end of the day", "leverage", "elevate", "seamlessly", "robust", "cutting-edge", "streamline", "revolutionize", "comprehensive", "delve", "unlock", "empower"

### Writing Style

- Short, direct sentences. Favor periods over semicolons.
- Match the site's tone exactly. A blue-collar tone means writing like a tradesperson.
- Use contractions naturally (it's, don't, you'll).
- Avoid filler introductions. Get to the point in the first sentence.
- Use active voice. "We strip the coating" not "The coating is stripped."

### SEO Best Practices

- **Title tag** under 70 characters, front-load the primary keyword
- **Meta description** under 160 characters, include a call to action or benefit
- **H2/H3 headings** in the body should contain secondary keywords naturally
- **Internal links** to 2-3 pages on the same site (from `internalLinks` in config)
- **Tags** should match terms people actually search for in the industry
- **Slug** should be short, keyword-rich, lowercase, hyphenated
- **Image alt text** should describe the image AND include a relevant keyword
- **First paragraph** should contain the primary keyword within the first 100 words
- **Word count** 800-1200 words. Not shorter, not longer.

---

## Blog Post Output Format

Each post is a `.md` file. The slug is derived from the title (lowercase,
hyphenated, no special characters).

```markdown
---
title: "Why Soda Blasting Is Replacing Sandblasting for Delicate Surfaces"
description: "A look at when soda blasting makes more sense than traditional sandblasting for restoration and cleaning jobs."
pubDate: 2026-03-14
author: "Blasting Jack"
image:
  url: "/images/blog/soda-blasting-delicate-surfaces.webp"
  alt: "Soda blasting a brick facade during restoration"
tags: ["sandblasting", "soda blasting", "surface prep"]
draft: false
---

Post body here. 800-1200 words. SEO-optimized.
Conversational tone matching the site's voice.
Include practical advice, not generic filler.
```

### Frontmatter Rules

- `title` — compelling, SEO-friendly, under 70 characters
- `description` — meta description, under 160 characters
- `pubDate` — ISO date (YYYY-MM-DD), set to the generation date
- `author` — pulled from `sites.json`, not generated by AI
- `image.url` — relative path: `/images/blog/{slug}.webp`
- `image.alt` — descriptive alt text generated by Gemini
- `tags` — 3-5 relevant tags, lowercase
- `draft` — always `false` (review happens at the PR level, not via draft flag)

---

## Duplicate Prevention (No history.json)

**Do not use a local `history.json` file.** It won't persist between GitHub
Action runs (each run gets a fresh checkout).

Instead, **query the target repo via GitHub API** to get existing blog posts:

1. Use Octokit to list files in `{contentPath}/` on the target repo
2. Fetch the frontmatter of each existing post (title + tags)
3. Pass the list of existing titles to Gemini in the prompt:
   _"Do NOT write about any of these existing topics: [list]"_

This is authoritative — the truth lives in the target repos, not in a local file.

---

## Gemini Flash Prompt Strategy

Use **JSON response mode** (`responseMimeType: "application/json"`) to guarantee
valid JSON output. Do not rely on asking the model to "return JSON" in free text.

### Prompt Template

```
You are a blog writer for a {industry} business.
The website is {siteUrl}.
The audience is {audience}.
Write in a {tone} tone.

Write an 800-1200 word blog post about a topic relevant to {industry}.

Requirements:
- Practical, specific, and actionable. No generic filler.
- Write like someone who actually works in this industry
- Include real-world examples and scenarios
- SEO-optimized with natural keyword usage in headings and body text
- Include 2-3 internal links naturally woven into the body text using these site pages: {internalLinks}
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
- Match the {tone} exactly. If it says "blue collar" then write like a tradesperson, not a marketing copywriter.

The following topics have already been published. Pick something NEW:
{existingTitles}

Return as JSON:
{
  "title": "string",
  "description": "string (under 160 chars)",
  "tags": ["string"],
  "body": "string (markdown formatted, 800-1200 words, with internal links)",
  "imageAlt": "string (descriptive alt text for hero image)",
  "imageSearchQuery": "string (Pexels search query for a relevant landscape photo)"
}
```

### Gemini API Configuration

```javascript
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.7,  // creative but controlled
  },
});
```

### Error Handling

- Wrap Gemini calls in try/catch
- Retry once on failure (with 3-second delay)
- Validate JSON response has all required fields before proceeding
- If a field is missing, log a warning and skip that site

---

## Image Handling

1. Search Pexels API with `imageSearchQuery` from Gemini response
2. Download the first landscape-orientation result (minimum 1280px wide)
3. Process with Sharp:
   - Resize to 1280px wide (maintain aspect ratio)
   - Convert to WebP format
   - Compress to quality 80 (target <200KB)
4. Include the processed image in the PR commit
5. Reference in frontmatter as `/images/blog/{slug}.webp`

### Pexels Fallback

If Pexels returns no results:
1. Retry with a broader search query (first 2 words of `imageSearchQuery`)
2. If still no results, use a generic industry-related query (e.g., "construction work")
3. If all fails, skip the image and log a warning (post still gets created)

---

## GitHub API — PR-Based Publishing

Use the **Git Trees + Blobs API** (via Octokit) to create a single commit
containing both the markdown post and the image, then open a pull request.

### Steps per Site

```
1. Get the default branch SHA
2. Create a blob for the markdown file (utf-8)
3. Create a blob for the image file (base64)
4. Create a tree with both blobs
5. Create a commit pointing to the new tree
6. Create a new branch: blog/auto/{slug}
7. Create a pull request from that branch to the default branch
8. Add labels: ["blog-publisher", "auto-generated"]
```

### Why PRs Instead of Direct Commits

- Human review before anything goes live
- Vercel generates a preview deployment for every PR automatically
- Reviewers can leave comments, suggest edits, or close
- Full audit trail of what was generated and when
- No risk of broken content reaching production

---

## Review Email (Resend)

After creating the PR, send a review notification via the **Resend API**.

```javascript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Blog Publisher <blog@websitelab.dev>',
  to: site.reviewEmail,
  subject: `[Website Lab] New blog post for review — ${site.siteUrl}`,
  html: reviewEmailHtml({
    title: post.title,
    description: post.description,
    tags: post.tags,
    preview: post.body.slice(0, 500) + '...',
    previewUrl: vercelPreviewUrl,
    prUrl: pr.html_url,
  }),
});
```

The email contains:
- Post title, description, and tags
- First ~200 words as an inline preview
- Link to full Vercel preview deployment
- Direct links to approve (merge), deny (close), or comment on the PR

---

## GitHub Action Workflow

```yaml
# .github/workflows/publish.yml
name: Monthly Blog Publisher

on:
  schedule:
    - cron: '0 8 1 * *'   # 1st of each month, 8am UTC
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
```

---

## Secrets Required (org-level)

| Secret            | Purpose                                       |
|-------------------|-----------------------------------------------|
| `GEMINI_API_KEY`  | Gemini 2.5 Flash API key                      |
| `ORG_GITHUB_PAT`  | Fine-grained PAT with Contents:write + PRs on org |
| `PEXELS_API_KEY`  | Pexels image API key (free tier)              |
| `RESEND_API_KEY`  | Resend email API key                          |

Set once at org level: `gh secret set <NAME> --org websitelab --visibility all`

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
│       └── publish.yml          # Scheduled GitHub Action
├── scripts/
│   ├── publish.js               # Main orchestrator
│   ├── generate.js              # Gemini content generation
│   ├── images.js                # Pexels fetch + Sharp processing
│   ├── github.js                # Octokit: PR creation, dedup queries
│   ├── email.js                 # Resend review email
│   └── utils.js                 # Slugify, validation, logging
├── templates/
│   └── review-email.html        # Email template (inline HTML)
├── sites.json                   # Site config
├── package.json
├── .gitignore
└── prompt.md                    # This file
```

---

## Key Design Decisions

- **GitHub Action over Vercel cron** — 6hr execution limit vs 800s, no cron slots used, free
- **Gemini Flash over Claude API** — cheaper for bulk content generation, fast enough for blog posts
- **JSON response mode** — guarantees valid JSON from Gemini, no fragile regex parsing
- **Pexels over AI-generated images** — real photos, free, no attribution required for API usage
- **PRs over direct commits** — enables human review, Vercel preview deployments, audit trail
- **Resend for review emails** — already in the Website Lab stack, simple API, good deliverability
- **Query repos for dedup** — authoritative source of truth, no stale local files
- **Git Trees API** — single atomic commit with both markdown + image (not two separate commits)
- **Astro schema alignment** — frontmatter must pass Zod validation or the target build breaks
- **JSON config over database** — version controlled, no external dependency, dead simple
- **Modular scripts** — separate files for generation, images, GitHub, email (testable, maintainable)

---

## Edge Cases to Handle

- **Duplicate topics** — query existing posts in target repo, pass titles to Gemini prompt
- **Gemini rate limits** — 3-second delay between sites, retry once on 429
- **Gemini bad JSON** — validate all required fields, skip site on persistent failure
- **Pexels no results** — cascade: broader query → generic industry query → skip image
- **Image too large** — Sharp compresses to quality 80 WebP, target <200KB
- **Repo missing content collection** — check for `contentPath` existence via API, skip + log warning
- **PR already exists for site** — check for open PRs with `blog-publisher` label, skip if one exists
- **Resend email failure** — log warning but don't fail the run (PR still exists for review)
- **PAT permissions error** — log clear error message identifying which permission is missing

---

## Dry Run Mode

`node scripts/publish.js --dry-run`

In dry run mode:
- Gemini generates the content (validates the prompt works)
- Pexels fetches and processes the image (validates the pipeline)
- Logs what *would* be committed and where
- Does NOT create branches, commits, PRs, or send emails
- Useful for testing before the first real run

---

## Future Enhancements (not for v1)

- Weekly frequency option per site
- Topic calendar (pre-planned topics per month)
- SEO keyword targeting from Google Search Console data
- Regenerate post from PR feedback (reviewer comments → Gemini revision → force-push to PR branch)
- A/B test different tones per site
- Dashboard showing all pending/published posts across sites
