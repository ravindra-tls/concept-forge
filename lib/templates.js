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

// ─── concept ↔ template compatibility ────────────────────────────────────────
// Some layouts structurally exclude parts of a concept: a "product and props only"
// template can never show the persona in the scene, and a template with no
// headline-ish token has nowhere for the chosen hero tagline to land verbatim.

const PEOPLE_BAN_RE = /no (people|humans|hands|faces|body parts)|product (and props )?only|product-only/i;
const TEMPLATE_PERSON_RE = /\b(woman|man|person|people|model|customer|creator|influencer|selfie|hand|hands|face|holding|wearing|applying)\b/i;
const HEADLINE_TOKEN_RE = /HEADLINE|HOOK|TITLE|PULL-?QUOTE|STATEMENT|CLAIM|BIG (BOLD )?TEXT|OVERLAY TEXT|MAIN LINE/i;
const SCENE_PERSON_RE = /\b(woman|man|person|people|she|her|he|his|face|hands?|arms?|shoulder|legs?|skin|model|selfie|wearing|applying)\b/i;

/** Does the concept's visual scene feature a human? */
function sceneNeedsPerson(sceneText) {
  return SCENE_PERSON_RE.test(String(sceneText || '').toLowerCase());
}

/** Structural flags for one template (computed once, cached on the record). */
function templateCompat(t) {
  if (!t) return { peopleBan: false, featuresPerson: false, headlineSlot: false };
  if (!t._compat) {
    const body = String(t.template || '');
    t._compat = {
      peopleBan: PEOPLE_BAN_RE.test(body),
      featuresPerson: TEMPLATE_PERSON_RE.test(body),
      headlineSlot: extractTokens(body).some((x) => HEADLINE_TOKEN_RE.test(x)),
    };
  }
  return t._compat;
}

let _cache = null;
function load() {
  if (_cache) return _cache;
  // eslint-disable-next-line global-require
  const data = require(path.join(__dirname, '..', 'knowledge', 'ad-templates.json'));
  const templates = (data && data.templates) || [];
  _cache = { templates, byNumber: new Map(templates.map((t) => [t.number, t])) };
  return _cache;
}

/** All templates, trimmed to picker-safe fields (no full prompt body) + compat flags. */
function listTemplates() {
  return load().templates.map((t) => {
    const c = templateCompat(t);
    return {
      number: t.number,
      name: t.name,
      category: t.category,
      aspect_ratio: t.aspect_ratio,
      preview_image_url: t.preview_image_url || null,
      people_ok: !c.peopleBan,
      features_person: c.featuresPerson,
      has_headline_slot: c.headlineSlot,
    };
  });
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
 *
 * Compatibility-aware: if the concept's scene features a person, templates that ban
 * people are excluded and person-featuring layouts win; templates with a headline-ish
 * token rank above ones with nowhere for the hero tagline to land.
 */
function suggestTemplate(card, recipe) {
  const category = conceptToCategory(card, recipe);
  const all = load().templates;
  const needsPerson = sceneNeedsPerson(card && card.visualIdea);

  const compatible = needsPerson ? all.filter((t) => !templateCompat(t).peopleBan) : all;
  const pool = compatible.length ? compatible : all;
  const inCat = pool.filter((t) => t.category === category);
  const source = inCat.length ? inCat : pool;

  // Person fit (when the scene has one) > headline slot > canonical low number
  // (seeded templates 1–41 are the hand-authored, vetted set).
  const chosen = source.slice().sort((a, b) => {
    const ca = templateCompat(a); const cb = templateCompat(b);
    if (needsPerson && ca.featuresPerson !== cb.featuresPerson) return ca.featuresPerson ? -1 : 1;
    if (ca.headlineSlot !== cb.headlineSlot) return ca.headlineSlot ? -1 : 1;
    return a.number - b.number;
  })[0];
  return { template: chosen, category, matched: inCat.length > 0 };
}

// Token pattern. Template bodies use square brackets EXCLUSIVELY for placeholders,
// so any bracketed span is a token. One level of nesting is allowed because some
// hint text embeds another token (e.g. "[HEADER like What Makes [PRODUCT] Special]"),
// and tokens may contain quotes, $/%/@/emoji, and hard-wrapped line breaks.
const TOKEN_RE = /\[(?:[^\[\]]|\[[^\[\]]*\])*\]/g;

/** Unique [PLACEHOLDER] tokens present in a template body. */
function extractTokens(templateBody) {
  const found = String(templateBody || '').match(TOKEN_RE) || [];
  return [...new Set(found.filter((t) => /[A-Za-z]/.test(t)))];
}

module.exports = { listTemplates, getTemplate, suggestTemplate, conceptToCategory, extractTokens, templateCompat, sceneNeedsPerson };
