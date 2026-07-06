'use strict';

const crypto = require('crypto');
const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { GENERATE_TOOL } = require('./schema');
const { taxonomies, staticFormats, mechanicsForStage } = require('./knowledge');
const { deckToPromptBlock } = require('./grounding');
const { HOOK_CRAFT, CONCEPT_CRAFT, QUALITY_BAR } = require('../knowledge/prompt-fragments');

/** Compact taxonomy reference so the model only picks valid dimension values. */
function taxonomyReference() {
  const lines = [];
  lines.push('AWARENESS STAGES: ' + taxonomies.awarenessStages.map((s) => `${s.id} (${s.name}: ${s.strategy})`).join(' | '));
  lines.push('CREATIVE MECHANICS (how the viewer arrives at the truth):');
  taxonomies.mechanics.forEach((m) => lines.push(`- ${m.name}: ${m.move} [fits: ${m.stageFit.join(', ')}]`));
  lines.push('PSYCHOLOGICAL TRIGGERS: ' + taxonomies.triggers.map((t) => t.name).join(', '));
  lines.push('HOOK TACTICS: ' + taxonomies.hookTactics.join(', '));
  lines.push('VOICE PATTERN CLUSTERS: ' + taxonomies.voicePatterns.map((v) => v.name).join(', '));
  lines.push('VISUAL FORMATS — STATIC ONLY (name — funnel): ' + staticFormats().map((f) => `${f.name} (${f.funnel})`).join('; '));
  return lines.join('\n');
}

/** The stable, cacheable system block (craft rules + taxonomy + brand grounding). */
function buildSystemBlocks(deck) {
  const stable = [
    'You are an elite direct-response creative strategist and copywriter. You generate ad concepts that are grounded in real product truth, targeted to a specific persona and pain, and specific enough to feel written for one person. You never produce generic AI slop.',
    '',
    'SCOPE: Concept Forge produces STATIC IMAGE ADS ONLY (a single still frame). Never propose video-only formats, scripts, or video hooks. Every concept must work as one static image. Fill tagline + primaryText; leave hookSpoken/hookVisual/hookTextOverlay empty. Set dna.format to an EXACT name from the STATIC VISUAL FORMATS list — never invent or combine format names.',
    '',
    QUALITY_BAR,
    '',
    CONCEPT_CRAFT,
    '',
    HOOK_CRAFT,
    '',
    '=== CREATIVE TAXONOMY (choose dimension values only from these) ===',
    taxonomyReference(),
    '',
    '=== BRAND GROUNDING (the only facts you may use) ===',
    deckToPromptBlock(deck),
  ].join('\n');

  return [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }];
}

function dimDirective(label, value, autoText) {
  if (!value || value === 'auto' || value === 'spin') return `- ${label}: ${autoText}`;
  return `- ${label}: MUST be "${value}".`;
}

function renderLoadout(loadout, opts = {}) {
  const skip = new Set(opts.skipDims || []); // dims handled elsewhere (e.g. the per-card diversity plan)
  const lines = [];
  if (!skip.has('persona')) lines.push(dimDirective('Persona', loadout.persona, 'choose the persona from the deck this concept fits best.'));
  if (!skip.has('pain')) lines.push(dimDirective('Pain/Desire', loadout.pain, 'choose the pain/desire from the deck this concept fits best.'));
  if (!skip.has('awarenessStage')) lines.push(dimDirective('Awareness stage', loadout.awarenessStage, 'choose the awareness stage this concept fits best.'));
  if (!skip.has('mechanic')) lines.push(dimDirective('Creative mechanic', loadout.mechanic, 'choose the mechanic that best serves the angle and stage.'));
  if (!skip.has('format')) lines.push(dimDirective('Visual format', loadout.format, 'choose a fitting visual format for the stage and medium.'));
  if (!skip.has('hookTactic')) lines.push(dimDirective('Hook tactic', loadout.hookTactic, 'choose the tactic that best frames the line.'));
  const medium = loadout.medium && loadout.medium !== 'Any' ? loadout.medium : null;
  if (medium) lines.push(`- Medium: ${medium} only. Pick a format compatible with ${medium}.`);
  // Non-linear "assembly chain" seeds: any of these may be pinned by the user.
  if (!opts.skipInsights && Array.isArray(loadout.insights) && loadout.insights.length) {
    lines.push('EMOTIONAL CORE (build every concept on THESE raw human truths — this is the point of the ad):');
    loadout.insights.forEach((ins) => {
      if (!ins) return;
      lines.push(`  • [${ins.emotion || 'feeling'}] "${ins.tension}"${ins.momentItStings ? ` — it stings when: ${ins.momentItStings}` : ''}`);
    });
    lines.push('  SURFACE WITH EMPATHY: name the truth so she feels SEEN — never mocked, judged, or shamed. Brand tone rules (see grounding) govern the final wording. Anchor each concept in the pinned pain/product truth AND one of these emotional cores — the pain is what the product addresses, the insight is why she feels it. Put the specific truth each concept expresses in its emotionalInsight field.');
  }
  if (loadout.angle) lines.push(`- Messaging angle: express THIS core truth — "${loadout.angle}".`);
  if (loadout.tagline) lines.push(`- Seed line: anchor concepts on this line/idea (refine wording, keep its essence) — "${loadout.tagline}".`);
  if (loadout.visualIdea) lines.push(`- Visual direction: build concepts that use this visual — "${loadout.visualIdea}".`);
  if (loadout.cta === 'none') lines.push('- Call to action: NONE — this is a top-of-funnel concept with no CTA. Leave the cta field empty.');
  else if (loadout.cta) lines.push(`- Call to action (PINNED — required): drive each concept toward this CTA and ALWAYS put it (verbatim or a tight variant) in the card's cta field: "${loadout.cta}".`);
  if (loadout.product === 'show') lines.push('- Product: the concept MUST visibly feature the product in the image.');
  else if (loadout.product === 'hide') lines.push('- Product: do NOT feature the product in the image (product-absent concept).');
  if (loadout.notes) lines.push(`- Extra direction from the user: ${loadout.notes}`);
  const constraints = (loadout.constraints || [])
    .map((id) => taxonomies.constraintCards.find((c) => c.id === id))
    .filter(Boolean);
  if (constraints.length) {
    lines.push('CONSTRAINT CARDS (apply ALL of these to the line):');
    constraints.forEach((c) => lines.push(`  • ${c.instruction}`));
  }
  return lines.join('\n');
}

function mediumFillNote(loadout) {
  const medium = loadout.medium;
  const always = ' Always fill tagline AND a concrete visualIdea (the actual shot/scene that makes it convert — obey the brand visual rules). Include a cta when the awareness stage/offer calls for one (esp. product-aware/most-aware); leave it empty only for pure top-of-funnel with no pinned CTA.';
  if (medium === 'Static') return 'These are STATIC concepts: fill tagline + primaryText; leave the video hook fields empty.' + always;
  if (medium === 'Video') return 'These are VIDEO concepts: fill tagline + hookSpoken + hookVisual + hookTextOverlay.' + always;
  return 'For video formats fill hookSpoken/hookVisual/hookTextOverlay; for static formats fill primaryText.' + always;
}

function attachIds(cards) {
  return (Array.isArray(cards) ? cards : []).map((c) => ({ id: crypto.randomUUID(), ...c }));
}

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
// Spread a pool across `count` slots: distinct while the pool lasts, then wrap.
function spread(pool, count) {
  if (!pool.length) return Array.from({ length: count }, () => undefined);
  const s = shuffle(pool);
  return Array.from({ length: count }, (_, i) => s[i % s.length]);
}

/**
 * Assign each card in the batch a DISTINCT (awareness × mechanic × hook tactic ×
 * format) and, when insights are pinned, one insight per card — so every concept
 * is a different KIND of ad, not a reworded line. Pinned dims are held constant.
 */
function buildDiversityPlan(loadout, count) {
  const stagePool = loadout.awarenessStage ? [loadout.awarenessStage] : taxonomies.awarenessStages.map((s) => s.id);
  const stages = spread(stagePool, count);
  const tactics = loadout.hookTactic ? Array(count).fill(loadout.hookTactic) : spread(taxonomies.hookTactics, count);
  const formats = loadout.format ? Array(count).fill(loadout.format) : spread(staticFormats().map((f) => f.name), count);
  const insights = Array.isArray(loadout.insights) ? loadout.insights.filter(Boolean) : [];
  const usedMech = new Set();
  return stages.map((stage, i) => {
    let mechanic = loadout.mechanic;
    if (!mechanic) {
      const pool = mechanicsForStage(stage).map((m) => m.name);
      const fresh = pool.filter((m) => !usedMech.has(m));
      const from = fresh.length ? fresh : pool;
      mechanic = from[Math.floor(Math.random() * from.length)];
      usedMech.add(mechanic);
    }
    return {
      awarenessStage: loadout.awarenessStage || stage,
      mechanic,
      hookTactic: tactics[i],
      format: formats[i],
      insight: insights.length ? insights[i % insights.length] : null,
    };
  });
}

function renderPlan(plan) {
  const lines = ['PER-CARD ASSIGNMENTS (each concept MUST use its row and be a fundamentally different KIND of ad):'];
  plan.forEach((p, i) => {
    lines.push(`Card ${i + 1}: awareness=${p.awarenessStage} · mechanic=${p.mechanic} · hook tactic=${p.hookTactic} · format=${p.format}`);
    if (p.insight) lines.push(`   emotional core (build THIS card on this one): [${p.insight.emotion || 'feeling'}] "${p.insight.tension}"${p.insight.momentItStings ? ` — stings when: ${p.insight.momentItStings}` : ''}`);
  });
  return lines.join('\n');
}

const DIVERSITY_RULES = `FUNDAMENTAL VARIETY (hard rules — this is the point):
- Obey each card's assigned awareness/mechanic/hook tactic/format/emotional core. Do NOT let them all drift into the same shape.
- No two taglines may share the same sentence architecture.
- The negation-reframe crutch ("X isn't broken", "You didn't fail X — X failed you", "Not because…") may appear on AT MOST ONE card. Reach for other devices instead: a real question, a command, a confession, a stat, a story fragment, a definition, an overheard line, a list, a single stark word.
- Vary sentence length and rhythm across the set — some short and blunt, some longer and intimate.
- Surface the emotional core WITH EMPATHY (she feels seen, never mocked or shamed); brand tone rules in the grounding govern the final wording. Record each card's specific truth in its emotionalInsight field.`;

const GEN_CHUNK = 3; // cards per parallel generation call — keeps wall-clock ≈ one small call

/** Split a diversity plan into chunks of GEN_CHUNK. */
function chunkPlan(plan) {
  const out = [];
  for (let i = 0; i < plan.length; i += GEN_CHUNK) out.push(plan.slice(i, i + GEN_CHUNK));
  return out;
}

/** Generate the cards for ONE plan chunk (one API call). Returns id-tagged cards. */
async function generateForChunk({ deck, loadout, chunk }) {
  const lo = { ...loadout, medium: 'Static' };
  const userMsg = [
    `Produce ${chunk.length} DISTINCT ad concept${chunk.length > 1 ? 's' : ''}. Persona/pain and the emotional cores are shared context; the ad TYPE must differ per card.`,
    renderLoadout(lo, { skipDims: ['awarenessStage', 'mechanic', 'format', 'hookTactic'], skipInsights: true }),
    '',
    renderPlan(chunk),
    '',
    DIVERSITY_RULES,
    '',
    mediumFillNote(lo),
    'Return them via the emit_concepts tool.',
  ].join('\n');
  const r = await callClaude({
    model: MODELS.generator,
    maxTokens: 2600, // enough for ~3 cards
    temperature: 1,
    system: buildSystemBlocks(deck),
    messages: [{ role: 'user', content: userMsg }],
    tools: [GENERATE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_concepts' },
  });
  return attachIds(extractToolInput(r, 'emit_concepts').cards || []);
}

/**
 * Generate a fresh hand of concept cards (before judging), in PARALLEL chunks so
 * wall-clock ≈ one small call instead of one long serial call. Each chunk gets its
 * own slice of the diversity plan, so variety is preserved across the whole hand.
 */
async function generateCards({ deck, loadout }) {
  const count = Math.min(Math.max(Number(loadout.count) || 4, 1), 12);
  const chunks = chunkPlan(buildDiversityPlan({ ...loadout, medium: 'Static' }, count));
  const results = await Promise.all(chunks.map((chunk) =>
    generateForChunk({ deck, loadout, chunk })
      .catch((e) => { console.error('[concept-forge] generation chunk failed:', e && e.message); return []; })));
  return results.flat();
}

/** Breed new concepts from parent cards the user favorited. */
async function breedCards({ deck, parents, loadout, suppressed }) {
  loadout = { ...loadout, medium: 'Static' }; // static-image tool
  const count = Math.min(Math.max(Number(loadout.count) || 4, 1), 8);
  const parentDigest = (parents || []).map((p, i) => ({
    parent: i + 1,
    dna: p.dna,
    emotionalInsight: p.emotionalInsight,
    messagingAngle: p.messagingAngle,
    tagline: p.tagline,
  }));
  const suppressList = (suppressed || []).filter(Boolean);

  const userMsg = [
    `The strategist LOVED these ${parentDigest.length} parent concept(s). Breed ${count} new concepts from their DNA.`,
    'For each child: inherit most dimensions from the parents (mix and match across them), then MUTATE exactly ONE dimension to something new, and write a fresh, distinct line. Keep what made the parents strong — the angle energy and mechanic — while exploring new territory.',
    '',
    'PARENTS:',
    JSON.stringify(parentDigest, null, 2),
    '',
    suppressList.length ? `AVOID these tired dimension values the strategist rejected: ${suppressList.join(', ')}.` : '',
    'Additional settings that still apply (a MUST overrides inheritance):',
    renderLoadout(loadout),
    '',
    mediumFillNote(loadout),
    'Return them via the emit_concepts tool.',
  ].filter(Boolean).join('\n');

  const response = await callClaude({
    model: MODELS.generator,
    maxTokens: 6000, // headroom for the over-generated round-1 batch
    temperature: 1,
    system: buildSystemBlocks(deck),
    messages: [{ role: 'user', content: userMsg }],
    tools: [GENERATE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_concepts' },
  });
  return attachIds(extractToolInput(response, 'emit_concepts').cards);
}

module.exports = { generateCards, breedCards, buildSystemBlocks, buildDiversityPlan, chunkPlan, generateForChunk };
