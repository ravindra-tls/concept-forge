'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader — no dependency. Parses KEY=VALUE lines, ignores comments
 * and blanks, strips surrounding quotes. Does NOT overwrite variables already set
 * in the real environment.
 */
function parseEnvFile(filePath) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Loads env in priority order:
 *   1. Real process.env (never overwritten)
 *   2. <project>/.env
 *   3. The file named by ANTHROPIC_ENV_FILE (an existing .env.local, etc.)
 * Only fills keys that are not already present.
 */
function loadEnv(projectRoot) {
  const projectEnv = parseEnvFile(path.join(projectRoot, '.env'));
  for (const [k, v] of Object.entries(projectEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  const external = process.env.ANTHROPIC_ENV_FILE;
  if (external) {
    const externalEnv = parseEnvFile(external);
    for (const [k, v] of Object.entries(externalEnv)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

function hasApiKey() {
  return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

function hasFalKey() {
  return typeof process.env.FAL_KEY === 'string' && process.env.FAL_KEY.trim().length > 0;
}

module.exports = { loadEnv, hasApiKey, hasFalKey, parseEnvFile };
