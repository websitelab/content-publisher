import sharp from 'sharp';
import { log } from './utils.js';

const PEXELS_BASE = 'https://api.pexels.com/v1/search';
const FALLBACK_QUERY = 'business office';
const TARGET_WIDTH = 1280;
const WEBP_QUALITY = 80;

async function searchPexels(query) {
  const url = new URL(PEXELS_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('size', 'large');
  url.searchParams.set('per_page', '1');

  const res = await fetch(url, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
  });

  if (!res.ok) {
    log('images', `Pexels API error ${res.status} for "${query}"`);
    return null;
  }

  const data = await res.json();
  const photo = data.photos?.[0];

  if (!photo) {
    log('images', `No Pexels results for "${query}"`);
    return null;
  }

  return photo.src.large2x;
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

export async function fetchHeroImage(searchQuery) {
  const queries = [
    searchQuery,
    searchQuery.split(/\s+/).slice(0, 2).join(' '),
    FALLBACK_QUERY,
  ];

  for (const query of queries) {
    try {
      const imageUrl = await searchPexels(query);
      if (!imageUrl) continue;

      log('images', `Found image for "${query}", processing...`);
      const result = await downloadAndProcess(imageUrl);
      if (result) return result;
    } catch (err) {
      log('images', `Error fetching image for "${query}": ${err.message}`);
    }
  }

  log('images', 'All image queries exhausted, returning null');
  return null;
}
