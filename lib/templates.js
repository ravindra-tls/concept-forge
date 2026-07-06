'use strict';

/**
 * Ad-template library. These are proven, real-ad-derived layout formulas
 * (each a prompt with [PLACEHOLDER] tokens) snapshotted from TAE Ad Studio's
 * prompt_templates table into knowledge/ad-templates.json. Concept Forge fills
 * the tokens with a concept's copy + brand grounding so the final image follows
 * a battle-tested composition instead of a freeform, one-off layout.
 *
 * Refresh the snapshot by re-running scripts/snapshot-templates (see README).
 */

const path = require('path');

let _cache = null;
function load() {
  if (_cache) return _cache;
  // eslint-disable-next-line global-require
  const data = require(path.join(__dirname, '..', 'knowledge', 'ad-templates.json'));
  const templates = (data && data.templates) || [];
  _cache = { templates, byNumber: new Map(templates.map((t) => [t.number, t])) };
  return _cache;
}

/** All templates, trimmed to picker-safe fields (no full prompt body). */
function listTemplates() {
  return load().templates.map((t) => ({
    number: t.number,
    name: t.name,
    category: t.category,
    aspect_ratio: t.aspect_ratio,
    preview_image_url: t.preview_image_url || null,
  }));
}

/** Full template record (includes the token prompt body) by number. */
function getTemplate(number) {
  return load().byNumber.get(Number(number)) || null;
}

// ─── concept → template category ─────────────────────────────────────────────
// Template categories in the snapshot:
//   Hero/Product · Offer/Promotion · Social Proof · Educational · Comparison
//   UGC · Press/Authority · Lifestyle · Native/Editorial

const FORMAT_TO_CATEGORY = {
  // UGC / native
  Selfie: 'UGC', 'Native Text Overlay': 'Native/Editorial', 'Text Message': 'UGC',
  'Notes App': 'UGC', 'Comment Response': 'UGC', Letter: 'UGC', 'Post It': 'UGC',
  // Social proof
  Review: 'Social Proof', Testimonial: 'Social Proof', 'Case Study': 'Social Proof',
  // Educational / infographic
  Statistic: 'Educational', 'Feature Benefit Callout': 'Educational', Listicle: 'Educational',
  'How-To': 'Educational', 'Grid Swap': 'Educational',
  // Comparison
  'Us vs. Them': 'Comparison', 'Split Screen': 'Comparison', 'Time Lapse': 'Comparison',
  // Authority / press
  Press: 'Press/Authority', Billboard: 'Hero/Product',
};

const FAMILY_TO_CATEGORY = {
  PRODUCT_HERO: 'Hero/Product',
  TESTIMONIAL_NATIVE: 'Social Proof',
  EDUCATIONAL_DEMYSTIFY: 'Educational',
  LIFESTYLE_ASPIRATION: 'Lifestyle',
  BEFORE_AFTER: 'Comparison',
  CONTRAST: 'Comparison',
};

/** Best-guess template category for a concept, from its format then its recipe family. */
function conceptToCategory(card, recipe) {
  const format = (card && card.dna && card.dna.format) || '';
  if (FORMAT_TO_CATEGORY[format]) return FORMAT_TO_CATEGORY[format];
  const fam = recipe && recipe.family;
  if (fam && FAMILY_TO_CATEGORY[fam]) return FAMILY_TO_CATEGORY[fam];
  return 'Hero/Product';
}

/**
 * Suggest a default template for a concept. Prefers a canonical (seeded, low-number)
 * template within the matched category so the default is stable and vetted; the UI
 * lets the user override with any template.
 */
function suggestTemplate(card, recipe) {
  const category = conceptToCategory(card, recipe);
  const inCat = load().templates.filter((t) => t.category === category);
  const pool = inCat.length ? inCat : load().templates;
  // Canonical = lowest number (seeded templates 1–41 are the hand-authored, vetted set).
  const chosen = pool.slice().sort((a, b) => a.number - b.number)[0];
  return { template: chosen, category, matched: inCat.length > 0 };
}

// Token pattern — matches TAE's assembler so we find the same [PLACEHOLDER] set.
// À-ɏ covers accented Latin chars that appear in some token hint text.
const TOKEN_RE = /\[[A-Za-z][A-Za-z0-9À-ɏ _/—–\-+.',:!?()&]+\]/g;

/** Unique [PLACEHOLDER] tokens present in a template body. */
function extractTokens(templateBody) {
  return [...new Set(String(templateBody || '').match(TOKEN_RE) || [])];
}

module.exports = { listTemplates, getTemplate, suggestTemplate, conceptToCategory, extractTokens };
