'use strict';

/**
 * Deep audience insight mining. Given an enriched persona (+ optional pain),
 * imagine that ONE real person's inner life and surface the raw, uncomfortable
 * human tensions a brilliant, empathetic marketer would notice — the truths she
 * feels but would never say out loud (envy, shame, fear, grief, vanity, longing).
 *
 * RAW ideation, EMPATHETIC final ad: mining goes to uncomfortable places, but the
 * adAngle for each insight must already point at an empathetic, non-shaming way to
 * hold it, and HARD compliance (banned language, no medical claims) is enforced
 * even inside the raw tension text. Brand TONE constraints shape the final ad, not
 * what the mining may explore.
 */

const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { deckToPromptBlock } = require('./grounding');

const INSIGHT_TOOL = {
  name: 'emit_insights',
  description: 'Emit a set of raw human-tension insights for one persona.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'short stable kebab-case id you assign (used for selection)' },
            tension: { type: 'string', description: 'The raw truth in ONE first-person sentence she would never say aloud.' },
            momentItStings: { type: 'string', description: 'The concrete, specific scene/trigger where this feeling hits her.' },
            emotion: { type: 'string', enum: ['envy', 'shame', 'fear', 'grief', 'vanity', 'longing', 'invisibility', 'pride'] },
            whyItsTrue: { type: 'string', description: 'The human logic that makes this ring true for her (from her inner life).' },
            adAngle: { type: 'string', description: 'How an empathetic ad could hold this truth so she feels SEEN — never mocked or shamed.' },
          },
          required: ['id', 'tension', 'momentItStings', 'emotion', 'whyItsTrue'],
        },
      },
    },
    required: ['insights'],
  },
};

const SYSTEM = `You imagine the real inner life of ONE specific person and surface the uncomfortable, unspoken truths a brilliant, empathetic marketer would notice — the things she feels but would never say out loud.

MINE RAW: go to genuinely uncomfortable places — envy of younger women, shame about her body, fear of disappearing or being seen as old, grief for who she used to be, vanity she won't admit. Do NOT sanitize into feel-good platitudes. Each insight must be a real, specific, first-person truth tied to a concrete moment.

HARD COMPLIANCE ALWAYS: never use the brand's banned language, never make a medical or disease claim, never violate a brand constraint — not even inside the raw tension text.

TONE vs MINING: brand tone rules (e.g. "never shame aging") shape the FINAL ad, not what you may explore here. But every 'adAngle' must already point at an EMPATHETIC, non-shaming way to hold the truth — the ad makes her feel seen and understood, never mocked or judged.

Return ~8 distinct insights via emit_insights, varied across different emotions and moments.`;

function personaById(deck, id) { return (deck.personas || []).find((p) => p.id === id) || null; }
function painById(deck, id) { return (deck.pains || []).find((p) => p.id === id) || null; }

/**
 * Mine ~8 raw human-tension insights for a persona.
 * @param {object} opts
 * @param {object} opts.deck
 * @param {string} opts.personaId
 * @param {string} [opts.painId]
 * @returns {Promise<Array>} insight objects
 */
async function mineInsights({ deck, personaId, painId }) {
  const persona = personaById(deck, personaId);
  if (!persona) throw new Error(`Persona "${personaId}" not found in deck.`);
  const pain = painId ? painById(deck, painId) : null;
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];

  const personaBlock = [
    `PERSONA — imagine HER, one real person:`,
    `[${persona.id}] ${persona.name} — ${persona.description || ''}`,
    `life: ${persona.lifeContext || ''}`,
    `wants: ${persona.desire || ''}`,
    persona.innerMonologue ? `inner voice: "${persona.innerMonologue}"` : '',
    persona.unspokenFears && persona.unspokenFears.length ? `fears: ${persona.unspokenFears.join(' / ')}` : '',
    persona.socialComparison ? `envies: ${persona.socialComparison}` : '',
    persona.shameMoments && persona.shameMoments.length ? `stings: ${persona.shameMoments.join(' / ')}` : '',
    (persona.identityLost || persona.identityDesired) ? `was → wants to be: ${persona.identityLost || '—'} → ${persona.identityDesired || '—'}` : '',
  ].filter(Boolean).join('\n');

  const painBlock = pain
    ? `\nFOCUS PAIN: ${pain.label} — ${pain.description || ''}${pain.vocPhrases && pain.vocPhrases.length ? `\nthey say: "${pain.vocPhrases.join('" / "')}"` : ''}`
    : '\n(No single pain pinned — range across her whole inner life.)';

  const userMsg = [
    personaBlock,
    painBlock,
    '',
    banned.length ? `BANNED LANGUAGE — never use, even in the raw tension: ${banned.join(', ')}` : '',
    '',
    'Surface ~8 raw human tensions she feels but would never say. Vary the emotion and the moment. Each adAngle must point at an empathetic, non-shaming ad.',
    'Return via emit_insights.',
  ].filter(Boolean).join('\n');

  const system = [
    { type: 'text', text: SYSTEM },
    { type: 'text', text: '=== BRAND GROUNDING ===\n' + deckToPromptBlock(deck), cache_control: { type: 'ephemeral' } },
  ];

  const response = await callClaude({
    model: MODELS.champion, // Opus — depth matters here; note Opus rejects the temperature param
    maxTokens: 2500,
    system,
    messages: [{ role: 'user', content: userMsg }],
    tools: [INSIGHT_TOOL],
    toolChoice: { type: 'tool', name: 'emit_insights' },
  });
  const out = extractToolInput(response, 'emit_insights');
  return (out && out.insights) || [];
}

module.exports = { mineInsights, INSIGHT_TOOL };
