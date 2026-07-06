'use strict';

const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { JUDGE_TOOL } = require('./schema');
const { deckToPromptBlock } = require('./grounding');
const { JUDGE_RUBRIC, QUALITY_BAR } = require('../knowledge/prompt-fragments');

const PASS_THRESHOLD = 70;

function buildJudgeSystem(deck) {
  const text = [
    'You are a ruthless creative director and compliance reviewer scoring ad concepts for one brand.',
    '',
    QUALITY_BAR,
    '',
    JUDGE_RUBRIC,
    '',
    '=== BRAND GROUNDING (the only facts that count as "product truth") ===',
    deckToPromptBlock(deck),
  ].join('\n');
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

function cardForJudging(card, i) {
  const parts = [
    `#${i}`,
    `persona=${card.dna && card.dna.persona} pain=${card.dna && card.dna.pain} stage=${card.dna && card.dna.awarenessStage} mechanic=${card.dna && card.dna.mechanic} format=${card.dna && card.dna.format}`,
    `emotionalInsight: ${card.emotionalInsight || '(none)'}`,
    `messagingAngle: ${card.messagingAngle}`,
    `tagline: ${card.tagline}`,
  ];
  if (card.hookSpoken) parts.push(`hookSpoken: ${card.hookSpoken}`);
  if (card.hookTextOverlay) parts.push(`hookTextOverlay: ${card.hookTextOverlay}`);
  if (card.primaryText) parts.push(`primaryText: ${card.primaryText}`);
  parts.push(`concept: ${card.concept}`);
  return parts.join('\n');
}

/** Score a batch of cards in one call; attach `.scores` and `.gatePass` to each. */
async function scoreCards({ deck, cards }) {
  if (!cards || !cards.length) return [];
  const userMsg = [
    `Score these ${cards.length} concepts. Return exactly one verdict per concept, matching by index.`,
    '',
    cards.map(cardForJudging).join('\n\n'),
    '',
    'Return all verdicts via the emit_verdicts tool.',
  ].join('\n');

  const response = await callClaude({
    // Gate runs on the fast model for speed — the rubric is explicit enough to apply
    // consistently, and the hard compliance/banned-language gate is unchanged.
    // Swap back to MODELS.judge (Sonnet) here if you want maximum scoring rigor.
    model: MODELS.generator,
    maxTokens: 2048,
    temperature: 0,
    system: buildJudgeSystem(deck),
    messages: [{ role: 'user', content: userMsg }],
    tools: [JUDGE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_verdicts' },
  });
  const verdicts = extractToolInput(response, 'emit_verdicts').verdicts || [];
  const byIndex = new Map(verdicts.map((v) => [v.index, v]));

  return cards.map((card, i) => {
    const v = byIndex.get(i) || byIndex.get(String(i));
    if (!v) {
      return { ...card, scores: null, gatePass: false, gateReason: 'no verdict returned' };
    }
    const scores = {
      productTruth: v.productTruth,
      emotionalTruth: v.emotionalTruth,
      specificity: v.specificity,
      concreteness: v.concreteness,
      scrollStop: v.scrollStop,
      brandVoice: v.brandVoice,
      overall: v.overall,
      bannedLanguageViolation: !!v.bannedLanguageViolation,
      note: v.note,
    };
    const gatePass = !scores.bannedLanguageViolation && Number(scores.overall) >= PASS_THRESHOLD;
    return {
      ...card,
      scores,
      gatePass,
      gateReason: scores.bannedLanguageViolation ? 'banned language / compliance' : (gatePass ? 'pass' : 'below bar'),
    };
  });
}

module.exports = { scoreCards, PASS_THRESHOLD };
