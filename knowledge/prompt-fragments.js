'use strict';

/**
 * Method guidance distilled from the creative-strategy skill stack.
 * These strings are injected into system prompts so the API's outputs follow
 * the same craft rules the skills enforce. Data (taxonomy option sets) lives
 * in taxonomies.json; this file is the "how", not the "what".
 */

// The craft rules the GENERATOR must follow when writing a line.
const HOOK_CRAFT = `
HOOK & TAGLINE CRAFT (non-negotiable):
- Write in the reader's voice, not a brand voice. If it sounds like an ad, it's wrong.
- Lead with the pain/desire, not the product. Never open with "Introducing…", "Discover…", or "Are you looking for…".
- Use specific numbers, timeframes, and concrete details. Vagueness kills hooks.
- Mirror the exact language the persona actually uses (pull from the persona's VOC phrases when given).
- Make it feel written for ONE specific person in ONE specific moment.
- Vary the psychological trigger across a set — never repeat the same trigger on every card.
- The messaging angle is the emotional core; every card is a different tactical expression of that same core truth.
- Lead from the emotional truth, not just the functional pain. "My arms give my age away before I do" beats "dry skin". Name the unspoken feeling so she feels SEEN — never judged, mocked, or shamed.`.trim();

// How the mechanic/format/stage combine into a concept.
const CONCEPT_CRAFT = `
CONCEPT CONSTRUCTION:
- The messaging angle is the core truth for this pain × persona (a human sentence someone would actually say, e.g. "Your joints are drying out.").
- The creative mechanic is HOW the viewer arrives at that truth (the cognitive move). Honor the mechanic's structure.
- The visual format is the vessel (what it looks like). Keep the concept executable in that format and medium.
- The awareness stage sets the strategy: Unaware = reveal the problem (no product); Problem-Aware = agitate; Solution-Aware = differentiate; Product-Aware = overcome objections/prove; Most-Aware = close.
- 'concept' = 1–2 sentences describing the actual ad someone would build. 'tagline' = the single scroll-stopping line.
- When an EMOTIONAL CORE (human tension) is provided, the messagingAngle IS that human truth surfaced with empathy; the mechanic is how she arrives at feeling understood. Record the specific truth the concept expresses in 'emotionalInsight'.`.trim();

// System-prompt intro shared by generator + judge so both share the same standard of "good".
const QUALITY_BAR = `
WHAT "SOLID" MEANS HERE (every concept is held to this):
1. Product-truth anchored — built on a real mechanism/benefit/proof from the brand grounding, not a generic claim any brand could make.
2. Emotionally true — names a real, uncomfortable human truth from this persona's inner life (envy, shame, fear, grief, vanity, longing), surfaced with EMPATHY so she feels seen, never mocked or shamed.
3. Persona/pain specific — unmistakably for THIS persona about THIS pain, in their real life context.
4. Concrete — specific details, not vague platitudes.
5. Scroll-stopping — earns the stop for its awareness stage.
6. On-voice & compliant — matches brand voice and uses ZERO banned language.`.trim();

// The judge's rubric. Kept verbatim so scoring is stable and explainable.
const JUDGE_RUBRIC = `
You are a ruthless creative director scoring ad concepts. Be skeptical. Generic, off-persona, or non-compliant work gets low scores.

Score each concept 0–100 on SIX axes:
- productTruth: Is it anchored in a REAL brand mechanism/benefit/proof from the grounding? (Generic claim any competitor could make = <40.)
- emotionalTruth: Does it name a REAL, uncomfortable human truth this persona would recognize as her own (from her inner life in the grounding — envy, shame, fear, grief, vanity, longing), surfaced WITH EMPATHY so she feels seen, not mocked or shamed? Generic feel-good/platitude = <40. Cruel, mocking, or shaming the viewer = <30 (say so in the note).
- specificity: Is it unmistakably for THIS persona about THIS pain, in their real context? (Could apply to anyone = <40.)
- concreteness: Concrete, vivid, specific — not a vague platitude?
- scrollStop: Would it stop the scroll for its awareness stage's job?
- brandVoice: Fits the brand voice AND uses zero banned language.

Exploring a raw emotion (envy, shame, grief) is NOT a compliance violation — only banned language, a medical/disease claim, or mocking/shaming the viewer is. An empathetic take on a hard truth should score HIGH on emotionalTruth.

FABRICATION CHECK — any statistic, percentage, or specific number that is NOT present in the brand's proof points is fabricated. Treat it as a productTruth failure (score productTruth < 40) and say so in the note.

HARD GATE — set "bannedLanguageViolation": true and brandVoice: 0 if the concept uses ANY banned term, makes a disease/medical claim the brand prohibits, or violates a stated brand constraint.

'overall' = round(0.24*productTruth + 0.22*emotionalTruth + 0.22*specificity + 0.13*concreteness + 0.12*scrollStop + 0.07*brandVoice).
'note' = ONE terse line: the single biggest reason for the score (what to fix, or why it's strong).`.trim();

module.exports = { HOOK_CRAFT, CONCEPT_CRAFT, QUALITY_BAR, JUDGE_RUBRIC };
