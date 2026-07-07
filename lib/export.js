'use strict';

const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { deckToPromptBlock } = require('./grounding');
const { formatToComposition, taxonomies } = require('./knowledge');
const { getTemplate, suggestTemplate, extractTokens, templateCompat, sceneNeedsPerson } = require('./templates');

// fal Nano Banana Pro aspect-ratio enum. Template ratios all fall inside this set.
const VALID_ASPECT = new Set(['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']);

const FILL_TOOL = {
  name: 'fill_template_tokens',
  description: 'Return a concrete, on-brand, compliance-safe value for every [PLACEHOLDER] token found in the ad template.',
  input_schema: {
    type: 'object',
    properties: {
      fills: {
        type: 'array',
        description: 'One entry per token in the template. Include EVERY token; never leave one out.',
        items: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'The exact token including its square brackets, e.g. "[YOUR HEADLINE, under 10 words]".' },
            value: { type: 'string', description: 'The concrete replacement text (short, image-model-friendly).' },
          },
          required: ['token', 'value'],
        },
      },
      sceneDirection: { type: 'string', description: '1–2 sentences of art direction translating the concept\'s scene into this template\'s composition — only what the tokens could not carry; empty string if the tokens fully carry the scene.' },
      avoid: { type: 'array', items: { type: 'string' }, description: 'Extra concrete negatives specific to this layout (optional).' },
    },
    required: ['fills'],
  },
};

const SYSTEM_FILL = `You fill the [PLACEHOLDER] tokens of a PROVEN ad-layout TEMPLATE so it renders a specific brand's ad.
The template is a battle-tested composition (a prompt for an image model). You do NOT redesign the layout — you only supply the values that go in its tokens, drawn from the finalized CONCEPT (the copy) and the BRAND grounding.

Rules:
- Use the concept's ACTUAL copy for copy tokens: the headline goes in headline/hero tokens, the tagline in subhead tokens, the CTA in CTA tokens. Keep the strategist's exact words where a token clearly maps to them.
- The concept's Headline is the strategist's CHOSEN HERO LINE. It must be the ad's dominant text. If the template has no dedicated headline token, place it verbatim in the single most dominant text token (pull-quote / main overlay / biggest line). If that dominant token is a quote/comment/testimonial, ADAPT the hero line into that first-person voice — keep its claim and key wording — do not write a different line. Never substitute an alternate tagline for the hero line.
- The product's packaging shows ONLY its real printed label (brand, product name, size). Never place testimonial text, attribution (e.g. "Verified Customer"), quotes, star ratings, or ad copy on the label or packaging itself.
- Scene tokens (background / setting / details / subject / product staging / imagery): derive them from THE SCENE in the concept, adapted to the template's composition. The template owns layout (where things go); the concept owns content (what the image depicts). Never substitute generic stock imagery when the concept specifies a scene.
- If the template's scene tokens cannot carry the concept's scene, put the remainder in sceneDirection (1–2 sentences of art direction that fit the template's layout). Leave sceneDirection empty when the tokens fully carry it.
- Colors: use the brand palette. Product/packaging tokens: describe the real product from the grounding (shape, color, label) — never a different form factor.
- People/audience tokens: match the concept's persona (age, life stage, real context). Not a generic model.
- Testimonial / quote / pull-quote tokens: when the token is the ad's dominant text, build it FROM the chosen hero line (adapted to first person, claim and key wording intact); only secondary quote tokens may be written fresh in the persona's voice, consistent with the concept and pain. Attribution should be generic ("— Verified Customer") or a first name only — NEVER a fabricated full name, and never a real person.
- NEVER invent numbers that aren't supported by the grounding: no made-up discounts, prices, review counts, star ratings, or clinical/percentage stats. If a token needs data we don't have, use a brand-safe neutral phrase or the closest supported proof point; if nothing fits, return an empty string for that token.
- Honor banned language exactly — never use a banned word or imply a banned claim.
- Keep each value short and concrete (typically 3–14 words), suitable for an image model.
- Return via fill_template_tokens with one entry for EVERY token listed.`;

// ─── concept-first (freeform) build — no template, the scene drives the composition ──

const COMPOSE_TOOL = {
  name: 'compose_ad_prompt',
  description: 'Return a complete, production-ready image-generation prompt for a static brand ad, composed around the concept\'s scene.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The full image prompt: scene, composition, exact copy placement, product, palette, photography specs.' },
      avoid: { type: 'array', items: { type: 'string' }, description: 'Extra concrete negatives specific to this composition (optional).' },
    },
    required: ['prompt'],
  },
};

const SYSTEM_COMPOSE = `You write ONE complete, production-ready prompt for an image model that renders a static brand ad, built AROUND the concept's scene — no preset layout template.
The SCENE is the ad's visual essence: depict it faithfully (subject, action, setting, framing, mood) and choose whatever composition best serves it.

Rules:
- Structure the prompt like a proven ad layout: name the composition, then the scene, then exact text placement, then product, palette, and photography specs (lens, light, angle).
- Use the concept's ACTUAL copy verbatim: the headline in quotes as the dominant text, the CTA (if any) as a button/line, on-image copy where it serves the layout. Never rewrite the strategist's words.
- Product/packaging: describe the real product from the grounding (shape, color, label) — never a different form factor. The packaging shows ONLY its real printed label (brand, product name, size) — never testimonial text, attribution, quotes, ratings, or ad copy on the label itself. People: match the concept's persona (age, life stage, real context), not a generic model.
- NEVER invent numbers not supported by the grounding: no made-up discounts, prices, review counts, star ratings, or clinical/percentage stats.
- Honor banned language exactly — never use a banned word or imply a banned claim. Testimonial-style quotes: first-person, generic attribution ("— Verified Customer" or first name only), never a real or fabricated full name.
- Keep it concrete and image-model-friendly (one dense paragraph or short labeled lines, ~120–200 words). Compose for the given aspect ratio.
- Return via compose_ad_prompt.`;

function buildComposeMessage({ deck, card, champion, badges, hasRefs, aspect }) {
  const persona = personaById(deck, card.dna && card.dna.persona);
  const pain = painById(deck, card.dna && card.dna.pain);
  const headline = (champion && champion.headline) || card.tagline;
  const taglines = (champion && champion.taglines) || (card.tagline ? [card.tagline] : []);
  const scene = (champion && champion.visualIdea) || card.visualIdea;
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];
  return [
    'Compose the full image prompt for this finalized static ad concept.',
    '',
    '=== THE SCENE (this ad\'s visual essence — depict it faithfully) ===',
    scene || card.concept || '(no scene provided — stage the product per the grounding)',
    '',
    '=== FINALIZED CONCEPT (the copy — use these exact words) ===',
    `HERO LINE (the strategist's chosen headline — this exact line is the ad's dominant text): ${headline}`,
    (() => { const alts = taglines.filter((t) => t !== headline); return alts.length ? `Alternate tagline variants (context only — NEVER use in place of the hero line): ${alts.join(' | ')}` : ''; })(),
    card.concept ? `Concept: ${card.concept}` : '',
    (champion && champion.primaryText) ? `On-image copy: ${champion.primaryText}` : '',
    card.cta ? `CTA: ${card.cta}` : '',
    card.messagingAngle ? `Messaging angle: ${card.messagingAngle}` : '',
    card.emotionalInsight ? `Emotional core (tone, never printed verbatim): ${card.emotionalInsight}` : '',
    persona ? `Persona: ${persona.name} — ${persona.lifeContext || persona.description || ''}` : '',
    pain ? `Pain/desire: ${pain.label} — ${pain.description || ''}` : '',
    badges.length ? `Trust elements to weave in where the composition has room: ${badges.join(' · ')}` : '',
    hasRefs ? 'Product reference image(s) WILL be attached at generation — describe placement/scale, not fine label details.' : 'No product reference image — describe the product accurately from the grounding.',
    `Aspect ratio to compose for: ${aspect}`,
    '',
    '=== BRAND GROUNDING & VISUAL RULES ===',
    deckToPromptBlock(deck),
    banned.length ? `BANNED LANGUAGE (never use or imply): ${banned.join(', ')}` : '',
    '',
    'Return via compose_ad_prompt.',
  ].filter(Boolean).join('\n');
}

function personaById(deck, id) { return (deck.personas || []).find((p) => p.id === id) || null; }
function painById(deck, id) { return (deck.pains || []).find((p) => p.id === id) || null; }

// The tool schemas declare `avoid` as an array, but models occasionally return a
// comma-separated string — spreading that into Set would explode it into characters.
function toAvoidList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function toFalAspect(ratio) {
  const r = String(ratio || '').replace(/\s/g, '');
  return VALID_ASPECT.has(r) ? r : 'auto';
}

function buildFillMessage({ template, tokens, deck, card, champion, badges, hasRefs }) {
  const persona = personaById(deck, card.dna && card.dna.persona);
  const pain = painById(deck, card.dna && card.dna.pain);
  const headline = (champion && champion.headline) || card.tagline;
  const taglines = (champion && champion.taglines) || (card.tagline ? [card.tagline] : []);
  const scene = (champion && champion.visualIdea) || card.visualIdea;
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];
  return [
    'AD TEMPLATE (fill its tokens; do not change its structure):',
    template.template,
    '',
    `TOKENS TO FILL (${tokens.length}):`,
    tokens.map((t) => `- ${t.replace(/\s+/g, ' ')}`).join('\n'),
    '',
    '=== FINALIZED CONCEPT (the copy — use these words) ===',
    `HERO LINE (the strategist's chosen headline — this exact line is the ad's dominant text): ${headline}`,
    (() => { const alts = taglines.filter((t) => t !== headline); return alts.length ? `Alternate tagline variants (context only — NEVER use in place of the hero line): ${alts.join(' | ')}` : ''; })(),
    card.concept ? `Concept: ${card.concept}` : '',
    (champion && champion.primaryText) ? `On-image copy: ${champion.primaryText}` : '',
    card.cta ? `CTA: ${card.cta}` : '',
    ...(scene ? [
      '',
      '=== THE SCENE (this ad\'s visual essence — non-negotiable) ===',
      scene,
      'The template decides WHERE things go (layout). This scene decides WHAT the image depicts. Fill every scene-type token from it; anything the tokens cannot carry goes in sceneDirection.',
    ] : []),
    card.messagingAngle ? `Messaging angle: ${card.messagingAngle}` : '',
    card.emotionalInsight ? `Emotional core (tone, never printed verbatim): ${card.emotionalInsight}` : '',
    persona ? `Persona: ${persona.name} — ${persona.lifeContext || persona.description || ''}` : '',
    pain ? `Pain/desire: ${pain.label} — ${pain.description || ''}` : '',
    badges.length ? `Trust elements to weave in where the template has room: ${badges.join(' · ')}` : '',
    hasRefs ? 'Product reference image(s) WILL be attached at generation — describe placement/scale, not fine label details.' : 'No product reference image — describe the product accurately from the grounding.',
    '',
    '=== BRAND GROUNDING & VISUAL RULES ===',
    deckToPromptBlock(deck),
    banned.length ? `BANNED LANGUAGE (never use or imply): ${banned.join(', ')}` : '',
    '',
    'Return via fill_template_tokens — one entry per token above.',
  ].filter(Boolean).join('\n');
}

// Replace [TOKEN] occurrences; then strip any token the model failed to fill.
// Any bracketed span (nesting-aware) counts — template bodies use brackets only
// for placeholders, and tokens may contain quotes, $/%/@/emoji, and line breaks.
const LEFTOVER_RE = /\[(?:[^\[\]]|\[[^\[\]]*\])*\]/g;

// Whitespace-flexible matcher: the model sees tokens collapsed to one line, so a
// token that spans a line break in the body must still match its returned fill.
function tokenRegex(token) {
  const esc = token.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(esc, 'g');
}

function applyFills(body, fills) {
  let out = body;
  for (const { token, value } of fills) {
    if (typeof token !== 'string' || !token.trim()) continue;
    const val = value == null ? '' : String(value);
    out = out.replace(tokenRegex(token), () => val); // fn form: no $-pattern surprises in val
  }
  out = out.replace(LEFTOVER_RE, '');           // drop anything unfilled
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return out;
}

async function exportConcept({ deck, champion, card, placement = 'feed', brandSlug = 'concept', referenceImages = [], pins = {}, templateNumber = null }) {
  const format = (card.dna && card.dna.format) || 'Lifestyle';
  const stage = card.dna && card.dna.awarenessStage;
  const mechanic = card.dna && card.dna.mechanic;
  const recipe = formatToComposition(format, stage, mechanic, deck); // used only for template auto-suggest + notes

  const freeform = templateNumber === 'freeform';

  // Resolve the template: explicit override wins, else auto-suggest by concept.
  // Suggest against the polished scene (champion's visual) so compatibility is
  // judged on what will actually be depicted.
  let template = (!freeform && templateNumber) ? getTemplate(templateNumber) : null;
  const sceneForSuggest = (champion && champion.visualIdea) || card.visualIdea;
  const suggestion = suggestTemplate({ ...card, visualIdea: sceneForSuggest }, recipe);
  const autoNumber = suggestion.template ? suggestion.template.number : null;
  if (!template && !freeform) template = suggestion.template;
  if (!template && !freeform) return { record: null, file: null, error: 'No ad templates available — run the template snapshot.' };

  const refs = [...new Set([...(deck.referenceImages || []), ...(referenceImages || [])])].filter(Boolean);
  const badges = (pins.enhancers || [])
    .map((id) => (taxonomies.conversionEnhancers || []).find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => e.badge);

  const aspect = toFalAspect(freeform
    ? ((suggestion.template && suggestion.template.aspect_ratio) || '4:5')
    : template.aspect_ratio);

  let fillsInput = { fills: [], avoid: [] };
  let layoutBody; // the scene/layout section of the final prompt
  if (freeform) {
    const response = await callClaude({
      model: MODELS.champion,
      maxTokens: 1500,
      system: SYSTEM_COMPOSE,
      messages: [{ role: 'user', content: buildComposeMessage({ deck, card, champion, badges, hasRefs: refs.length > 0, aspect }) }],
      tools: [COMPOSE_TOOL],
      toolChoice: { type: 'tool', name: 'compose_ad_prompt' },
    });
    const composed = extractToolInput(response, 'compose_ad_prompt') || {};
    layoutBody = String(composed.prompt || '').trim();
    fillsInput.avoid = composed.avoid || [];
    if (!layoutBody) return { record: null, file: null, error: 'Concept-first compose returned an empty prompt — try again or pick a template.' };
  } else {
    const tokens = extractTokens(template.template);
    if (tokens.length) {
      const response = await callClaude({
        model: MODELS.champion,
        maxTokens: 2600,
        system: SYSTEM_FILL,
        messages: [{ role: 'user', content: buildFillMessage({ template, tokens, deck, card, champion, badges, hasRefs: refs.length > 0 }) }],
        tools: [FILL_TOOL],
        toolChoice: { type: 'tool', name: 'fill_template_tokens' },
      });
      fillsInput = extractToolInput(response, 'fill_template_tokens') || fillsInput;
    }
    layoutBody = applyFills(template.template, fillsInput.fills || []);
    // Bridge for templates whose tokens couldn't carry the concept's scene.
    const sceneDirection = String(fillsInput.sceneDirection || '').trim();
    if (sceneDirection) layoutBody += `\n\nScene direction: ${sceneDirection}`;
  }

  // Compliance + brand preamble, then the filled proven layout, then negatives.
  const brandName = deck.brand || deck.brandName || brandSlug;
  const productName = deck.product || brandName;
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];

  const negatives = [...new Set([
    ...toAvoidList(fillsInput.avoid),
    ...banned.map((w) => `no "${w}" claim`),
    'distorted hands', 'garbled text', 'watermark', 'extra fingers',
    'testimonial or attribution text printed on the product label', 'extra text on packaging',
  ])];

  const promptParts = [
    `Product: ${productName} by ${brandName}.`,
    banned.length ? `Do not depict or imply: ${banned.join(', ')}.` : '',
    layoutBody,
    `Avoid: ${negatives.join(', ')}.`,
    `Output: ${aspect} aspect ratio, high-resolution, photorealistic advertising image.`,
  ].filter(Boolean);
  const promptText = promptParts.join('\n\n');

  const tplMeta = freeform
    ? { number: null, name: 'Concept-first (no template)', category: 'Freeform', aspect_ratio: aspect, preview_image_url: null, auto_suggested: false }
    : {
      number: template.number,
      name: template.name,
      category: template.category,
      aspect_ratio: template.aspect_ratio,
      preview_image_url: template.preview_image_url || null,
      auto_suggested: template.number === autoNumber,
    };

  const headline = (champion && champion.headline) || card.tagline;

  // Surface concept ↔ template conflicts the strategist should know about.
  const warnings = [];
  const sceneHasPerson = sceneNeedsPerson((champion && champion.visualIdea) || card.visualIdea);
  if (!freeform && sceneHasPerson && templateCompat(template).peopleBan) {
    warnings.push("This template is product-only (no people) — the concept's scene features a person, who will NOT appear. Pick a template with people (Lifestyle / UGC) or use Concept-first.");
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (headline && !norm(promptText).includes(norm(headline))) {
    warnings.push('Your chosen hero tagline did not land verbatim in the layout — switch template or use Concept-first if the hero line matters here.');
  }

  const textZones = [];
  if (headline) textZones.push({ element: 'headline', position: freeform ? 'per composition' : 'per template', text: headline });
  if (card.cta) textZones.push({ element: 'cta', position: freeform ? 'per composition' : 'per template', text: card.cta });
  if (badges.length) textZones.push({ element: 'trust', position: 'integrated', text: badges.join(' · ') });

  const record = {
    prompt: promptText,
    negative_prompt: negatives.join(', '),
    category: tplMeta.category,
    archetype: tplMeta.name,
    format,
    settings: {
      model: 'nano-banana-pro',
      aspect_ratio: aspect,
      resolution: aspect,
      template_number: tplMeta.number,
      template_name: tplMeta.name,
    },
    template: tplMeta,
    text_zones: textZones,
    warnings,
    reference_images: refs,
    enhancers: badges,
    concept_notes: `${freeform ? 'Concept-first build (no template)' : `Template #${tplMeta.number} "${tplMeta.name}" (${tplMeta.category})`} · ${format} · mechanic ${mechanic} · stage ${stage}${card.scores ? ` · score ${card.scores.overall}` : ''}.`,
    _concept_forge: {
      headline,
      taglines: (champion && champion.taglines) || [card.tagline],
      visualIdea: (champion && champion.visualIdea) || card.visualIdea,
      cta: card.cta,
      dna: card.dna,
      messagingAngle: card.messagingAngle,
      scores: card.scores || null,
    },
  };

  return { record };
}

module.exports = { exportConcept };
