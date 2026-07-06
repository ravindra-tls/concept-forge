'use strict';

/**
 * Zero-dependency Anthropic Messages API client using Node's built-in fetch.
 * Supports prompt caching (cache_control on system blocks) and forced structured
 * output via tool_use. No secret is ever logged.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Model IDs (from the environment's model catalogue). Swap centrally here.
const MODELS = {
  generator: 'claude-haiku-4-5-20251001', // fast, cheap — high-volume candidate generation
  judge: 'claude-sonnet-4-6',             // stronger — scores & gates quality
  champion: 'claude-opus-4-8',            // strongest — final polish & export prompt
};

class ApiKeyMissingError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set. Add it to concept-forge/.env, set it in your environment, or point ANTHROPIC_ENV_FILE at a file that has it.');
    this.name = 'ApiKeyMissingError';
    this.code = 'NO_API_KEY';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Messages API.
 * @param {object} opts
 * @param {string} opts.model
 * @param {Array|string} [opts.system]  - array of blocks (for cache_control) or a string
 * @param {Array} opts.messages
 * @param {Array} [opts.tools]
 * @param {object} [opts.toolChoice]
 * @param {number} [opts.maxTokens=2048]
 * @param {number} [opts.temperature]
 * @returns {Promise<object>} parsed response JSON
 */
async function callClaude({ model, system, messages, tools, toolChoice, maxTokens = 2048, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) throw new ApiKeyMissingError();

  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (temperature !== undefined) body.temperature = temperature;

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  };

  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (networkErr) {
      lastErr = new Error(`Network error calling Anthropic API: ${networkErr.message}`);
      if (attempt < maxAttempts) { await sleep(400 * attempt); continue; }
      throw lastErr;
    }

    if (res.ok) return res.json();

    const status = res.status;
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    // Retry on rate limit / transient server errors.
    if ((status === 429 || status >= 500) && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * attempt);
      continue;
    }
    const err = new Error(`Anthropic API error ${status}: ${truncate(detail, 500)}`);
    err.status = status;
    throw err;
  }
  throw lastErr || new Error('Anthropic API call failed');
}

/** Pull the input object from a forced tool_use response. */
function extractToolInput(response, toolName) {
  const blocks = (response && response.content) || [];
  const block = blocks.find((b) => b.type === 'tool_use' && (!toolName || b.name === toolName));
  if (!block) {
    const textBlock = blocks.find((b) => b.type === 'text');
    throw new Error(`Model did not return the expected tool output${textBlock ? `: ${truncate(textBlock.text, 300)}` : '.'}`);
  }
  return block.input;
}

/** Concatenated plain text from a response (for non-tool calls). */
function extractText(response) {
  return ((response && response.content) || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

module.exports = { callClaude, extractToolInput, extractText, MODELS, ApiKeyMissingError };
