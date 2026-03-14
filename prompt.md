# Blog Publisher — Build Prompt

## What This Is

A standalone automated blog publisher for **Website Lab**.
Runs as a **GitHub Action** on a monthly schedule, generates SEO-optimized blog posts
using **Gemini Flash**, and publishes them to multiple client Astro websites via the
GitHub API. Vercel auto-deploys each site on push.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  GitHub Action (scheduled monthly)              │
│                                                 │
│  1. Read sites.json config                      │
│  2. For each site:                              │
│     a. Pick topic (rotate from topic list)      │
│     b. Gemini Flash → research + write post     │
│     c. Pexels API → fetch hero image            │
│     d. Build .md with Astro frontmatter         │
│     e. GitHub API → commit to site's repo       │
│  3. Vercel auto-deploys on push                 │
└─────────────────────────────────────────────────┘
```

**No Vercel project needed.** This runs entirely as a GitHub Action.
Zero cron slots consumed. Free within GitHub Actions minutes.

---

## Tech Stack

| Layer          | Tool                          |
|----------------|-------------------------------|
| Orchestration  | GitHub Actions (scheduled)    |
| AI             | Gemini 2.5 Flash API          |
| Images         | Pexels API (free tier)        |
| Publishing     | GitHub REST API (Octokit)     |
| Target sites   | Astro content collections     |
| Hosting        | Vercel (auto-deploy on push)  |

---

## Site Config (`sites.json`)

```json
[
  {
    "repo": "websitelab/blastingjack",
    "contentPath": "src/content/blog",
    "industry": "sandblasting and surface preparation",
    "tone": "blue collar, straightforward",
    "audience": "property managers, contractors, industrial facility managers",
    "siteUrl": "https://blastingjack.com"
  },
  {
    "repo": "websitelab/pro-handyman.services",
    "contentPath": "src/content/blog",
    "industry": "handyman and home repair",
    "tone": "friendly, helpful, local",
    "audience": "homeowners in Fairfield County CT",
    "siteUrl": "https://pro-handyman.services"
  }
]
```

Each entry defines a target site. The publisher loops through all entries on each run.

---

## Blog Post Output Format

Each post is a single `.md` file committed to `{contentPath}/{slug}.md` in the target repo.

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

---

## Gemini Flash Prompt Strategy

For each site, send a prompt like:

> You are a blog writer for a {industry} business.
> The audience is {audience}.
> Write in a {tone} tone.
>
> Write an 800-1200 word blog post about a topic relevant to {industry}.
> The post should be practical, specific, and SEO-optimized.
> Include a compelling title, meta description (under 160 chars), and 3-5 tags.
>
> Do NOT use generic filler. Write like someone who works in this industry.
>
> Return the result as JSON:
> ```json
> {
>   "title": "...",
>   "description": "...",
>   "tags": ["...", "..."],
>   "body": "...",
>   "imageSearchQuery": "..."
> }
> ```

Use `imageSearchQuery` to fetch a relevant hero image from Pexels.

---

## Image Handling

1. Search Pexels API with the `imageSearchQuery` from Gemini
2. Download the image (landscape, 1280px wide)
3. Convert to WebP, compress (use `sharp` or similar)
4. Commit the image to `public/images/blog/{slug}.webp` in the target repo
5. Reference it in frontmatter as `/images/blog/{slug}.webp`

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
      - run: npm ci
      - run: node scripts/publish.js
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_PAT: ${{ secrets.ORG_GITHUB_PAT }}
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
```

---

## Secrets Required (org-level)

| Secret            | Purpose                                      |
|-------------------|----------------------------------------------|
| `GEMINI_API_KEY`  | Gemini 2.5 Flash API key                     |
| `ORG_GITHUB_PAT`  | Fine-grained PAT with Contents:write on org  |
| `PEXELS_API_KEY`  | Pexels image API key (free tier)             |

Set once at org level: `gh secret set <NAME> --org websitelab --visibility all`

---

## Project Structure

```
blog-publisher/
├── .github/
│   └── workflows/
│       └── publish.yml        # Scheduled GitHub Action
├── scripts/
│   └── publish.js             # Main publisher script (~150 lines)
├── sites.json                 # Site config (repos, topics, tone)
├── package.json
├── .gitignore
└── prompt.md                  # This file
```

---

## Key Design Decisions

- **GitHub Action over Vercel cron** — 6hr execution limit vs 800s, no cron slots used, free
- **Gemini Flash over Claude API** — cheaper for bulk content generation, fast enough for blog posts
- **Pexels over AI-generated images** — real photos, free, no attribution required for API usage
- **JSON config over Notion/database** — version controlled, no external dependency, dead simple
- **One commit per site** — each site gets its own commit to its own repo, Vercel deploys independently
- **No Vercel project for this tool** — it's purely a GitHub Action, no hosting needed

---

## Edge Cases to Handle

- **Duplicate topics** — track previously published titles in a `history.json` and pass them to Gemini to avoid repeats
- **Gemini rate limits** — add a small delay between sites (2-3 seconds)
- **Pexels no results** — fallback to a generic industry image or skip the image
- **Repo doesn't have blog content collection** — skip and log a warning
- **Image too large** — compress to <200KB WebP before committing

---

## Future Enhancements (not for v1)

- Weekly frequency option per site
- Topic calendar (pre-planned topics per month)
- SEO keyword targeting from Google Search Console data
- Notify via Slack/email when posts are published
- A/B test different tones per site
