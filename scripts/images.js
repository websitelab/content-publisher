import sharp from 'sharp';
import { log } from './utils.js';

const PEXELS_BASE = 'https://api.pexels.com/v1/search';
const TARGET_WIDTH = 1280;
const WEBP_QUALITY = 80;

// Track used photo IDs across the entire run to prevent duplicates
const usedPhotoIds = new Set();

// Industry-specific fallbacks
const INDUSTRY_FALLBACKS = {
  default: 'healthcare professional clinic',
  chiropractic: 'chiropractic spine adjustment treatment',
  'physical therapy': 'physical therapy rehabilitation exercise',
  'massage therapy': 'therapeutic massage treatment',
  healthcare: 'medical clinic patient care',
  'sports medicine': 'sports medicine rehabilitation athlete',
};

function getFallbackQuery(industry) {
  const lower = (industry || '').toLowerCase();
  for (const [key, query] of Object.entries(INDUSTRY_FALLBACKS)) {
    if (lower.includes(key)) return query;
  }
  return INDUSTRY_FALLBACKS.default;
}

async function searchPexels(query, perPage = 15, page = 1) {
  const url = new URL(PEXELS_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('size', 'large');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));

  const res = await fetch(url, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
  });

  if (!res.ok) {
    log('images', `Pexels API error ${res.status} for "${query}"`);
    return [];
  }

  const data = await res.json();
  return data.photos || [];
}

/**
 * Score photos to prefer clinical/treatment imagery over lifestyle portraits.
 * Higher score = better match.
 */
function scorePhoto(photo) {
  let score = 0;
  const alt = (photo.alt || '').toLowerCase();

  // Prefer images with medical/clinical keywords in the alt text
  const clinicalTerms = ['therapy', 'treatment', 'medical', 'clinic', 'spine', 'exercise',
    'rehabilitation', 'stretch', 'doctor', 'patient', 'anatomy', 'health',
    'wellness', 'massage', 'adjustment', 'recovery', 'fitness', 'training'];
  for (const term of clinicalTerms) {
    if (alt.includes(term)) score += 2;
  }

  // Prefer wider aspect ratios (more editorial/hero-friendly)
  const ratio = photo.width / photo.height;
  if (ratio >= 1.4 && ratio <= 2.0) score += 3;

  // Prefer larger source images
  if (photo.width >= 2000) score += 1;

  // Slight penalty for very generic photos
  const genericTerms = ['portrait', 'selfie', 'headshot', 'couple', 'dating'];
  for (const term of genericTerms) {
    if (alt.includes(term)) score -= 3;
  }

  return score;
}

async function downloadAndProcess(imageUrl) {
  const res = await fetch(imageUrl);

  if (!res.ok) {
    log('images', `Failed to download image: ${res.status}`);
    return null;
  }

  const arrayBuffer = await res.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const buffer = await sharp(inputBuffer)
    .resize(TARGET_WIDTH)
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  const { width, height } = await sharp(buffer).metadata();

  return { buffer, width, height, size: buffer.length };
}

export async function fetchHeroImage(searchQuery, industry) {
  const fallbackQuery = getFallbackQuery(industry);
  const queries = [
    searchQuery,
    searchQuery.split(/\s+/).slice(0, 3).join(' '),
    fallbackQuery,
  ];

  for (const query of queries) {
    // Try multiple pages to find unused images
    for (let page = 1; page <= 3; page++) {
      try {
        const photos = await searchPexels(query, 15, page);
        if (photos.length === 0) break; // no more results for this query

        // Filter out already-used photos, then score and sort
        const available = photos.filter(p => !usedPhotoIds.has(p.id));
        if (available.length === 0) {
          log('images', `All ${photos.length} results for "${query}" page ${page} already used, trying next page...`);
          continue;
        }

        const scored = available
          .map(p => ({ photo: p, score: scorePhoto(p) }))
          .sort((a, b) => b.score - a.score);

        const best = scored[0].photo;
        const imageUrl = best.src.large2x;

        log('images', `Found ${available.length} unused images for "${query}" (page ${page}), picked ID ${best.id} (score: ${scored[0].score})`);

        const result = await downloadAndProcess(imageUrl);
        if (result) {
          // Mark this photo as used
          usedPhotoIds.add(best.id);
          return result;
        }
      } catch (err) {
        log('images', `Error fetching image for "${query}" page ${page}: ${err.message}`);
      }
    }
  }

  log('images', 'All image queries exhausted, returning null');
  return null;
}
