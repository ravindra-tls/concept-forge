'use strict';

/**
 * Tool (structured-output) schemas for the generator and judge.
 * Card DNA maps 1:1 onto the creative-strategy skill stack:
 *   persona × pain × awarenessStage → messagingAngle → mechanic → hookTactic/trigger/voicePattern → format
 */

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    dna: {
      type: 'object',
      description: 'The dimension values that define this concept. Used for display and for breeding.',
      properties: {
        persona: { type: 'string', description: 'persona id from the grounding deck' },
        pain: { type: 'string', description: 'pain/desire id from the grounding deck' },
        awarenessStage: { type: 'string', description: 'one of: unaware, problem-aware, solution-aware, product-aware, most-aware' },
        mechanic: { type: 'string', description: 'creative mechanic name' },
        format: { type: 'string', description: 'visual format name' },
        hookTactic: { type: 'string', description: 'hook tactic name' },
        trigger: { type: 'string', description: 'psychological trigger name' },
        voicePattern: { type: 'string', description: 'voice pattern cluster name (optional)' },
      },
      required: ['persona', 'pain', 'awarenessStage', 'mechanic', 'format', 'hookTactic', 'trigger'],
    },
    emotionalInsight: { type: 'string', description: 'The raw human tension this concept is built on, in ONE first-person sentence she\'d never say aloud (e.g. "I close the app when my niece posts her skin."). Surface it with empathy — never mock or shame her.' },
    messagingAngle: { type: 'string', description: 'The core truth for this pain × persona — a human sentence, not marketing copy.' },
    concept: { type: 'string', description: '1–2 sentences describing the actual ad to build (how the mechanic plays out in the format).' },
    tagline: { type: 'string', description: 'The single scroll-stopping line / headline. Must convert, not just be clever.' },
    visualIdea: { type: 'string', description: 'The KEY visual that makes this convert — describe the actual shot/scene (subject, action, framing), not a caption. Must obey the brand visual rules.' },
    hookSpoken: { type: 'string', description: 'First words said on camera (video formats only).' },
    hookVisual: { type: 'string', description: 'The opening frame/action that stops the scroll (video formats only).' },
    hookTextOverlay: { type: 'string', description: 'On-screen text (video formats only).' },
    primaryText: { type: 'string', description: 'First line of ad copy (static/caption formats only).' },
    cta: { type: 'string', description: 'The call to action, when the awareness stage/offer calls for one (esp. product-aware/most-aware). Leave empty for pure top-of-funnel.' },
    rationale: { type: 'string', description: 'One sentence: why this lands for THIS persona at THIS awareness stage.' },
  },
  required: ['dna', 'emotionalInsight', 'messagingAngle', 'concept', 'tagline', 'visualIdea', 'rationale'],
};

const GENERATE_TOOL = {
  name: 'emit_concepts',
  description: 'Emit a set of distinct ad concept cards.',
  input_schema: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: CARD_SCHEMA },
    },
    required: ['cards'],
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer', description: 'index of the concept being scored (0-based, matching input order)' },
    productTruth: { type: 'integer' },
    emotionalTruth: { type: 'integer' },
    specificity: { type: 'integer' },
    concreteness: { type: 'integer' },
    scrollStop: { type: 'integer' },
    brandVoice: { type: 'integer' },
    overall: { type: 'integer' },
    bannedLanguageViolation: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['index', 'productTruth', 'emotionalTruth', 'specificity', 'concreteness', 'scrollStop', 'brandVoice', 'overall', 'bannedLanguageViolation', 'note'],
};

const JUDGE_TOOL = {
  name: 'emit_verdicts',
  description: 'Score every concept against the rubric.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: { type: 'array', items: VERDICT_SCHEMA },
    },
    required: ['verdicts'],
  },
};

// The assembly-chain slots. Any can be pinned by the user; the rest are the model's to fill.
const PINS_SCHEMA = {
  type: 'object',
  properties: {
    persona: { type: 'string', description: 'persona id, or free text' },
    pain: { type: 'string', description: 'pain/desire id, or free text' },
    awarenessStage: { type: 'string' },
    angle: { type: 'string', description: 'a core messaging-angle truth to build on' },
    mechanic: { type: 'string' },
    format: { type: 'string' },
    hookTactic: { type: 'string' },
    tagline: { type: 'string', description: 'a seed line/idea to anchor concepts on' },
    visualIdea: { type: 'string', description: 'a visual direction to build around' },
    cta: { type: 'string', description: 'the call to action the concepts should drive toward' },
    insights: {
      type: 'array',
      description: 'Selected human-tension insight objects to build concepts on (the emotional core).',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tension: { type: 'string' },
          momentItStings: { type: 'string' },
          emotion: { type: 'string' },
          whyItsTrue: { type: 'string' },
          adAngle: { type: 'string' },
        },
      },
    },
    constraints: { type: 'array', items: { type: 'string' }, description: 'active constraint-card ids to apply to every concept' },
    enhancers: { type: 'array', items: { type: 'string' }, description: 'conversion-enhancer ids to render as trust badges on the exported image' },
    product: { type: 'string', enum: ['', 'show', 'hide'], description: 'whether the product should appear in the image: show, hide, or empty for auto' },
    notes: { type: 'string', description: 'any other standing direction from the user' },
  },
};

// A card the director emits — a full concept, optionally replacing an existing board card by short handle.
const DIRECTOR_CARD_SCHEMA = {
  type: 'object',
  properties: {
    ...CARD_SCHEMA.properties,
    replaces: { type: 'string', description: 'Optional short handle (e.g. "a1b2") of an existing board card this refines/replaces. Omit for a brand-new concept.' },
  },
  required: CARD_SCHEMA.required,
};

const DIRECTOR_TOOL = {
  name: 'director_turn',
  description: 'Respond to the user as their creative director, optionally producing/refining concepts, updating the assembly chain, and offering next steps.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'What you say to the user, in a natural, sharp, human collaborator voice.' },
      cards: { type: 'array', items: DIRECTOR_CARD_SCHEMA, description: 'New or refined concept cards to place on the board. Omit if this turn is just talk/questions.' },
      pins: { ...PINS_SCHEMA, description: 'Assembly-chain slots to set based on what the user asked (e.g. focus on a persona). Omit to leave the chain unchanged.' },
      suggestions: { type: 'array', items: { type: 'string' }, description: '2–4 short, clickable next-step prompts for the user.' },
    },
    required: ['reply'],
  },
};

// Refine one existing concept from inline comments.
const REFINE_TOOL = {
  name: 'emit_refined',
  description: 'Emit the revised concept after addressing the strategist\'s inline comments.',
  input_schema: {
    type: 'object',
    properties: { card: CARD_SCHEMA },
    required: ['card'],
  },
};

module.exports = { CARD_SCHEMA, GENERATE_TOOL, VERDICT_SCHEMA, JUDGE_TOOL, PINS_SCHEMA, DIRECTOR_TOOL, REFINE_TOOL };
