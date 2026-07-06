'use strict';

const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { REFINE_TOOL } = require('./schema');
const { buildSystemBlocks } = require('./generator');
const { taxonomies } = require('./knowledge');

function compactCard(card) {
  return {
    dna: card.dna,
    emotionalInsight: card.emotionalInsight,
    messagingAngle: card.messagingAngle,
    concept: card.concept,
    tagline: card.tagline,
    visualIdea: card.visualIdea,
    hookSpoken: card.hookSpoken,
    hookVisual: card.hookVisual,
    hookTextOverlay: card.hookTextOverlay,
    primaryText: card.primaryText,
    cta: card.cta,
  };
}

/**
 * Revise ONE concept from inline comments the strategist left on specific text
 * (plan-mode / design-annotation style). Preserves the card id so it replaces
 * the original on the board.
 */
async function refineCard({ deck, card, comments, pins }) {
  const system = buildSystemBlocks(deck);
  const commentLines = (comments || [])
    .map((c, i) => `${i + 1}. On the text "${c.quote}" → ${c.comment}`)
    .join('\n');

  // Keep honoring the active chain: constraints + CTA (unless a comment overrides them).
  const activeLines = [];
  const cons = ((pins && pins.constraints) || []).map((id) => taxonomies.constraintCards.find((c) => c.id === id)).filter(Boolean);
  cons.forEach((c) => activeLines.push(`- Constraint still applies: ${c.instruction}`));
  if (pins && pins.cta) activeLines.push(`- Keep driving toward the CTA "${pins.cta}" (in the cta field).`);

  const userMsg = [
    'Revise ONE existing ad concept using the strategist\'s inline comments.',
    'Address EVERY comment precisely, relative to the exact text it targets. Keep everything that was NOT commented on intact — do not restyle the whole thing. Keep the same dna unless a comment asks to change it. Stay grounded and compliant.',
    '',
    'CURRENT CONCEPT:',
    JSON.stringify(compactCard(card), null, 2),
    '',
    'INLINE COMMENTS:',
    commentLines || '(none — just tighten it)',
    activeLines.length ? '\nSTILL IN EFFECT (unless a comment overrides):\n' + activeLines.join('\n') : '',
    '',
    'Return the fully revised concept via the emit_refined tool. Always include a tagline and a concrete visualIdea.',
  ].filter(Boolean).join('\n');

  const response = await callClaude({
    model: MODELS.judge,
    maxTokens: 2048,
    system,
    messages: [{ role: 'user', content: userMsg }],
    tools: [REFINE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_refined' },
  });
  const out = extractToolInput(response, 'emit_refined');
  return { ...out.card, id: card.id }; // preserve id → replaces on the board
}

module.exports = { refineCard };
