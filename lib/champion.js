'use strict';

const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { deckToPromptBlock } = require('./grounding');
const { HOOK_CRAFT, QUALITY_BAR } = require('../knowledge/prompt-fragments');

const CHAMPION_TOOL = {
  name: 'emit_champion',
  description: 'Emit the polished, production-ready version of a winning ad concept.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'The single strongest line.' },
      taglines: { type: 'array', items: { type: 'string' }, description: '5 polished tagline variants, each a different flavor of the same core truth.' },
      concept: { type: 'string', description: 'Refined 2–3 sentence description of the ad to build.' },
      hookSpoken: { type: 'string' },
      hookVisual: { type: 'string' },
      hookTextOverlay: { type: 'string' },
      primaryText: { type: 'string' },
      beats: { type: 'array', items: { type: 'string' }, description: 'Optional 3–5 shot/script beats (for video concepts).' },
      whyItWorks: { type: 'string', description: 'One tight paragraph on the psychology for this persona at this stage.' },
      complianceCheck: { type: 'string', description: 'Confirm no banned language / disease claims, and note any qualifier used (e.g. pre-clinical).' },
    },
    required: ['headline', 'taglines', 'concept', 'whyItWorks', 'complianceCheck'],
  },
};

async function polishChampion({ deck, card }) {
  const system = [
    'You are a world-class creative director doing the FINAL polish on a winning ad concept before production. Elevate the craft; keep it grounded, specific, and on-voice. Do not drift from the concept the strategist chose.',
    'SCOPE: this is a STATIC IMAGE ad (single still). Provide static ad copy (headline/taglines/primaryText). Do NOT write spoken hooks or video shot beats.',
    '',
    QUALITY_BAR,
    '',
    HOOK_CRAFT,
    '',
    '=== BRAND GROUNDING ===',
    deckToPromptBlock(deck),
  ].join('\n');

  const userMsg = [
    'Polish this winning concept into production-ready form.',
    '',
    `DNA: ${JSON.stringify(card.dna)}`,
    `Messaging angle: ${card.messagingAngle}`,
    `Current tagline: ${card.tagline}`,
    card.concept ? `Concept: ${card.concept}` : '',
    card.hookSpoken ? `Current spoken hook: ${card.hookSpoken}` : '',
    card.primaryText ? `Current primary text: ${card.primaryText}` : '',
    '',
    'Give 5 tagline variants (keep the same core truth, vary the trigger), pick the strongest as the headline, refine the concept, and provide the static ad copy (primaryText / on-image lines). This is a STATIC image ad — do not write spoken hooks or video beats. Confirm compliance. Return via emit_champion.',
  ].filter(Boolean).join('\n');

  const response = await callClaude({
    model: MODELS.champion,
    maxTokens: 2048,
    system,
    messages: [{ role: 'user', content: userMsg }],
    tools: [CHAMPION_TOOL],
    toolChoice: { type: 'tool', name: 'emit_champion' },
  });
  return extractToolInput(response, 'emit_champion');
}

// Re-polish a finalized concept using the strategist's inline comments (plan-mode style).
async function refineChampion({ deck, card, champion, comments }) {
  const system = [
    'You are a world-class creative director revising a FINALIZED static ad concept using the strategist\'s inline comments. Address EVERY comment precisely, keep everything not commented on intact, stay grounded and compliant.',
    'SCOPE: STATIC IMAGE ad — static copy only (headline/taglines/primaryText); no spoken hooks or video beats.',
    '',
    QUALITY_BAR,
    '',
    HOOK_CRAFT,
    '',
    '=== BRAND GROUNDING ===',
    deckToPromptBlock(deck),
  ].join('\n');

  const commentLines = (comments || []).map((c, i) => `${i + 1}. On "${c.quote}" → ${c.comment}`).join('\n');
  const userMsg = [
    'Revise this finalized concept per the inline comments below. Keep the same core truth unless a comment says otherwise.',
    '',
    `DNA: ${JSON.stringify(card.dna)}`,
    'CURRENT FINALIZED CONCEPT:',
    JSON.stringify({ headline: champion.headline, taglines: champion.taglines, concept: champion.concept, primaryText: champion.primaryText, whyItWorks: champion.whyItWorks }, null, 2),
    '',
    'INLINE COMMENTS:',
    commentLines || '(none — just tighten it)',
    '',
    'Return the fully revised finalized concept (5 tagline variants, strongest as headline, refined concept + static copy, compliance) via emit_champion.',
  ].join('\n');

  const response = await callClaude({
    model: MODELS.champion,
    maxTokens: 2048,
    system,
    messages: [{ role: 'user', content: userMsg }],
    tools: [CHAMPION_TOOL],
    toolChoice: { type: 'tool', name: 'emit_champion' },
  });
  return extractToolInput(response, 'emit_champion');
}

module.exports = { polishChampion, refineChampion };
