'use strict';

/**
 * Zero-dependency fal.ai client using Node's built-in fetch — generates the actual
 * image via Google's Nano Banana Pro (Gemini 3 Pro Image), so the export step no
 * longer requires copy-pasting the prompt into an external tool.
 *
 * Uses fal's queue API directly (submit -> poll status -> fetch result) rather than
 * the @fal-ai/client npm package, to keep this project at zero runtime dependencies.
 * https://fal.ai/models/fal-ai/nano-banana-pro/api
 */

const QUEUE_BASE = 'https://queue.fal.run';
const MODEL_T2I = 'fal-ai/nano-banana-pro';       // text-to-image
const MODEL_EDIT = 'fal-ai/nano-banana-pro/edit'; // image-to-image (reference images)

// fal's aspect_ratio enum. Anything not in this set falls back to 'auto'.
const VALID_ASPECT = new Set(['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']);

class FalKeyMissingError extends Error {
  constructor() {
    super('FAL_KEY is not set. Add it to concept-forge/.env, set it in your environment, or point ANTHROPIC_ENV_FILE (or a similar external env file) at a file that has it.');
    this.name = 'FalKeyMissingError';
    this.code = 'NO_FAL_KEY';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeaders() {
  const key = process.env.FAL_KEY;
  if (!key || !key.trim()) throw new FalKeyMissingError();
  return { 'content-type': 'application/json', authorization: `Key ${key}` };
}

function truncate(s, n) { return !s ? '' : (s.length > n ? s.slice(0, n) + '…' : s); }

async function submit(modelId, input) {
  const res = await fetch(`${QUEUE_BASE}/${modelId}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`fal.ai submit error ${res.status}: ${truncate(detail, 400)}`);
    err.status = res.status;
    throw err;
  }
  return res.json(); // { request_id, status_url, response_url, cancel_url }
}

async function pollUntilDone(statusUrl, { timeoutMs = 120000, intervalMs = 1500 } = {}) {
  const headers = authHeaders();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(statusUrl, { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`fal.ai status error ${res.status}: ${truncate(detail, 400)}`);
    }
    const data = await res.json();
    if (data.status === 'COMPLETED') return data;
    if (data.status === 'FAILED' || data.error) throw new Error(`fal.ai generation failed: ${data.error || 'unknown error'}`);
    await sleep(intervalMs);
  }
  throw new Error('fal.ai generation timed out waiting for a result.');
}

async function fetchResult(responseUrl) {
  const res = await fetch(responseUrl, { headers: authHeaders() });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`fal.ai result error ${res.status}: ${truncate(detail, 400)}`);
  }
  return res.json(); // { images: [{url, width, height, content_type, ...}], description }
}

/**
 * Generate an image via Nano Banana Pro. Uses the /edit endpoint (image-to-image)
 * when reference images are supplied, so the real product photo conditions the
 * composition instead of the model hallucinating the product.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string[]} [opts.imageUrls] - public reference image URLs (product photos)
 * @param {string} [opts.aspectRatio] - e.g. "4:5", "9:16", "1:1", "16:9"
 * @param {'1K'|'2K'|'4K'} [opts.resolution]
 * @param {'png'|'jpeg'|'webp'} [opts.outputFormat]
 * @returns {Promise<{images: Array<{url:string,width:number,height:number}>, description: string, modelId: string}>}
 */
async function generateImage({ prompt, imageUrls = [], aspectRatio, resolution = '2K', outputFormat = 'png' }) {
  if (!prompt || !prompt.trim()) throw new Error('prompt is required');
  const modelId = imageUrls && imageUrls.length ? MODEL_EDIT : MODEL_T2I;

  const input = {
    prompt,
    num_images: 1,
    resolution,
    output_format: outputFormat,
    aspect_ratio: VALID_ASPECT.has(aspectRatio) ? aspectRatio : 'auto',
  };
  if (imageUrls && imageUrls.length) input.image_urls = imageUrls;

  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const submitted = await submit(modelId, input);
      const done = await pollUntilDone(submitted.status_url);
      const result = await fetchResult(submitted.response_url || done.response_url);
      return { images: result.images || [], description: result.description || '', modelId };
    } catch (networkErr) {
      lastErr = networkErr;
      // Retry only on the submit's transient statuses; auth/validation errors (4xx) are not retried.
      if (networkErr.status && networkErr.status < 500 && networkErr.status !== 429) throw networkErr;
      if (attempt < maxAttempts) { await sleep(500 * attempt); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('fal.ai image generation failed');
}

module.exports = { generateImage, FalKeyMissingError, MODEL_T2I, MODEL_EDIT };
