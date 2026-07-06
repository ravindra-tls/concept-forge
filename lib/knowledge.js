'use strict';

const path = require('path');
const taxonomies = require(path.join(__dirname, '..', 'knowledge', 'taxonomies.json'));
const families = require(path.join(__dirname, '..', 'knowledge', 'archetype-families.json'));
const formatComposition = require(path.join(__dirname, '..', 'knowledge', 'format-composition.json'));

// Which awareness stages each funnel token covers.
const FUNNEL_TO_STAGES = {
  TOF: ['unaware', 'problem-aware'],
  MOF: ['solution-aware', 'product-aware'],
  BOF: ['most-aware'],
  Full: ['unaware', 'problem-aware', 'solution-aware', 'product-aware', 'most-aware'],
};

function stagesForFunnel(funnel) {
  const tokens = String(funnel).split('-'); // e.g. "TOF-MOF" -> ["TOF","MOF"]
  const set = new Set();
  for (const t of tokens) (FUNNEL_TO_STAGES[t] || []).forEach((s) => set.add(s));
  if (set.size === 0) FUNNEL_TO_STAGES.Full.forEach((s) => set.add(s));
  return [...set];
}

// Concept Forge is a STATIC-IMAGE-ONLY tool. Only formats that can be executed as a still.
function staticFormats() {
  return taxonomies.formats.filter((f) => f.medium === 'Static' || f.medium === 'Video/Static');
}

/** Formats that naturally fit a given awareness stage (optionally filtered by medium). */
function formatsForStage(stageId, medium) {
  return taxonomies.formats.filter((f) => {
    const stageOk = stagesForFunnel(f.funnel).includes(stageId);
    const mediumOk = !medium || medium === 'Any' || f.medium === medium || f.medium === 'Video/Static';
    return stageOk && mediumOk;
  });
}

/** Mechanics whose stageFit includes the stage (falls back to all if none match). */
function mechanicsForStage(stageId) {
  const fit = taxonomies.mechanics.filter((m) => m.stageFit.includes(stageId));
  return fit.length ? fit : taxonomies.mechanics;
}

function stageById(id) {
  return taxonomies.awarenessStages.find((s) => s.id === id) || null;
}

function constraintById(id) {
  return taxonomies.constraintCards.find((c) => c.id === id) || null;
}

// Map a visual format to the closest ad-creative-generator category (for export).
function formatToAdCategory(formatName) {
  const staticProducty = ['Statistic', 'Feature Benefit Callout', 'Billboard', 'Press', 'Case Study'];
  const ugcy = ['Selfie', 'Native Text Overlay', 'Text Message', 'Notes App', 'Review', 'Testimonial', 'Comment Response', 'Letter', 'Post It'];
  const infographicy = ['Listicle', 'How-To', 'Grid Swap', 'Statistic', 'Case Study'];
  if (formatName === 'Statistic' || formatName === 'Feature Benefit Callout') return 'infographics';
  if (staticProducty.includes(formatName)) return 'product-hero';
  if (ugcy.includes(formatName)) return 'ugc-style';
  if (infographicy.includes(formatName)) return 'infographics';
  return 'lifestyle';
}

// Does the brand forbid before/after imagery? (compliance guard for BEFORE_AFTER family)
function deckBansBeforeAfter(deck) {
  if (!deck) return false;
  const hay = [
    ...(deck.constraints || []),
    (deck.brandVoice && deck.brandVoice.notes) || '',
    ...((deck.brandVoice && deck.brandVoice.bannedLanguage) || []),
  ].join(' \n ').toLowerCase();
  return /before\s*[-/&]?\s*after|before and after|doctored|digitally altered/.test(hay);
}

function categoryToFamily(cat) {
  return ({ 'product-hero': 'PRODUCT_HERO', 'ugc-style': 'TESTIMONIAL_NATIVE', infographics: 'EDUCATIONAL_DEMYSTIFY', lifestyle: 'LIFESTYLE_ASPIRATION' })[cat] || 'PRODUCT_HERO';
}

/**
 * Resolve the composition recipe for a concept: per-format override ⊕ family default,
 * adjusted by awareness stage for stage-flexible formats, and guarded so a brand that
 * bans before/after never gets the BEFORE_AFTER family.
 */
function formatToComposition(format, awarenessStage, mechanic, deck) {
  const entry = formatComposition[format] || null;
  let familyId = (entry && entry.family) || categoryToFamily(formatToAdCategory(format));

  // Stage-flexible formats (Split Screen, Time Lapse, Us vs. Them) lean transformation early-funnel.
  if (entry && entry.stageFlex && (awarenessStage === 'problem-aware' || awarenessStage === 'solution-aware')) {
    familyId = 'BEFORE_AFTER';
  }
  // Compliance guard: downgrade before/after to a neutral contrast when the brand forbids it.
  if (familyId === 'BEFORE_AFTER' && deckBansBeforeAfter(deck)) familyId = 'CONTRAST';

  const fam = families[familyId] || families.PRODUCT_HERO;
  const pick = (k) => (entry && entry[k] != null ? entry[k] : fam[k]);
  return {
    family: familyId,
    genre: pick('genre'),
    composition: pick('composition'),
    mood: pick('mood'),
    style: pick('style'),
    camera: { ...(fam.camera || {}), ...((entry && entry.camera) || {}) },
    textZone: pick('textZone'),
    productPlacement: pick('productPlacement'),
    grammarNote: pick('grammarNote'),
    negatives: [...new Set([...(fam.negatives || []), ...((entry && entry.negatives) || [])])],
  };
}

module.exports = {
  taxonomies,
  families,
  staticFormats,
  stagesForFunnel,
  formatsForStage,
  mechanicsForStage,
  stageById,
  constraintById,
  formatToAdCategory,
  formatToComposition,
  deckBansBeforeAfter,
};
