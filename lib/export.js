'use strict';

const fs = require('fs');
const path = require('path');
const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { deckToPromptBlock } = require('./grounding');
const { formatToComposition, taxonomies } = require('./knowledge');
const { getTemplate, suggestTemplate, extractTokens } = require('./templates');

const EXPORT_DIR = path.join(__dirname, '..', 'exports');

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
      avoid: { type: 'array', items: { type: 'string' }, description: 'Extra concrete negatives specific to this layout (optional).' },
    },
    required: ['fills'],
  },
};

const SYSTEM_FILL = `You fill the [PLACEHOLDER] tokens of a PROVEN ad-layout TEMPLATE so it renders a specific brand's ad.
The template is a battle-tested composition (a prompt for an image model). You do NOT redesign the layout — you only supply the values that go in its tokens, drawn from the finalized CONCEPT (the copy) and the BRAND grounding.

Rules:
- Use the concept's ACTUAL copy for copy tokens: the headline goes in headline/hero tokens, the tagline in subhead tokens, the CTA in CTA tokens. Keep the strategist's exact words where a token clearly maps to them.
- Colors: use the brand palette. Product/packaging tokens: describe the real product from the grounding (shape, color, label) — never a different form factor.
- People/audience tokens: match the concept's persona (age, life stage, real context). Not a generic model.
- Testimonial / quote / pull-quote tokens: write a first-person line in the persona's voice consistent with the concept and pain; attribution should be generic ("— Verified Customer") or a first name only — NEVER a fabricated full name, and never a real person.
- NEVER invent numbers that aren't supported by the grounding: no made-up discounts, prices, review counts, star ratings, or clinical/percentage stats. If a token needs data we don't have, use a brand-safe neutral phrase or the closest supported proof point; if nothing fits, return an empty string for that token.
- Honor banned language exactly — never use a banned word or imply a banned claim.
- Keep each value short and concrete (typically 3–14 words), suitable for an image model.
- Return via fill_template_tokens with one entry for EVERY token listed.`;

function personaById(deck, id) { return (deck.personas || []).find((p) => p.id === id) || null; }
function painById(deck, id) { return (deck.pains || []).find((p) => p.id === id) || null; }

function toFalAspect(ratio) {
  const r = String(ratio || '').replace(/\s/g, '');
  return VALID_ASPECT.has(r) ? r : 'auto';
}

function buildFillMessage({ template, tokens, deck, card, champion, badges, hasRefs }) {
  const persona = personaById(deck, card.dna && card.dna.persona);
  const pain = painById(deck, card.dna && card.dna.pain);
  const headline = (champion && champion.headline) || card.tagline;
  const taglines = (champion && champion.taglines) || (card.tagline ? [card.tagline] : []);
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];
  return [
    'AD TEMPLATE (fill its tokens; do not change its structure):',
    template.template,
    '',
    `TOKENS TO FILL (${tokens.length}):`,
    tokens.map((t) => `- ${t}`).join('\n'),
    '',
    '=== FINALIZED CONCEPT (the copy — use these words) ===',
    `Headline: ${headline}`,
    taglines.length ? `Taglines: ${taglines.join(' | ')}` : '',
    card.concept ? `Concept: ${card.concept}` : '',
    (champion && champion.primaryText) ? `On-image copy: ${champion.primaryText}` : '',
    card.cta ? `CTA: ${card.cta}` : '',
    card.visualIdea ? `Visual idea: ${card.visualIdea}` : '',
    card.messagingAngle ? `Messaging angle: ${card.messagingAngle}` : '',
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
const LEFTOVER_RE = /\[[A-Za-z][A-Za-z0-9À-ɏ _/—–\-+.',:!?()&]+\]/g;
function applyFills(body, fills) {
  let out = body;
  for (const { token, value } of fills) {
    if (typeof token === 'string') out = out.split(token).join(value == null ? '' : value);
  }
  out = out.replace(LEFTOVER_RE, '');           // drop anything unfilled
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return out;
}

async function exportConcept({ deck, champion, card, placement = 'feed', brandSlug = 'concept', referenceImages = [], pins = {}, templateNumber = null }) {
  const format = (card.dna && card.dna.format) || 'Lifestyle';
  const stage = card.dna && card.dna.awarenessStage;
  const mechanic = card.dna && card.dna.mechanic;
  const recipe = formatToComposition(format, stage, mechanic, deck); // used only for template auto-suggest + notes

  // Resolve the template: explicit override wins, else auto-suggest by concept.
  let template = templateNumber ? getTemplate(templateNumber) : null;
  const suggestion = suggestTemplate(card, recipe);
  const autoNumber = suggestion.template ? suggestion.template.number : null;
  if (!template) template = suggestion.template;
  if (!template) return { record: null, file: null, error: 'No ad templates available — run the template snapshot.' };

  const refs = [...new Set([...(deck.referenceImages || []), ...(referenceImages || [])])].filter(Boolean);
  const badges = (pins.enhancers || [])
    .map((id) => (taxonomies.conversionEnhancers || []).find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => e.badge);

  const tokens = extractTokens(template.template);

  let fillsInput = { fills: [], avoid: [] };
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

  const filledTemplate = applyFills(template.template, fillsInput.fills || []);

  // Compliance + brand preamble, then the filled proven layout, then negatives.
  const brandName = deck.brand || deck.brandName || brandSlug;
  const productName = deck.product || brandName;
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];
  const aspect = toFalAspect(template.aspect_ratio);

  const negatives = [...new Set([
    ...(fillsInput.avoid || []),
    ...banned.map((w) => `no "${w}" claim`),
    'distorted hands', 'garbled text', 'watermark', 'extra fingers',
  ])];

  const promptParts = [
    `Product: ${productName} by ${brandName}.`,
    banned.length ? `Do not depict or imply: ${banned.join(', ')}.` : '',
    filledTemplate,
    `Avoid: ${negatives.join(', ')}.`,
    `Output: ${aspect} aspect ratio, high-resolution, photorealistic advertising image.`,
  ].filter(Boolean);
  const promptText = promptParts.join('\n\n');

  const headline = (champion && champion.headline) || card.tagline;
  const textZones = [];
  if (headline) textZones.push({ element: 'headline', position: 'per template', text: headline });
  if (card.cta) textZones.push({ element: 'cta', position: 'per template', text: card.cta });
  if (badges.length) textZones.push({ element: 'trust', position: 'integrated', text: badges.join(' · ') });

  const record = {
    prompt: promptText,
    negative_prompt: negatives.join(', '),
    category: template.category,
    archetype: template.name,
    format,
    settings: {
      model: 'nano-banana-pro',
      aspect_ratio: aspect,
      resolution: aspect,
      template_number: template.number,
      template_name: template.name,
    },
    template: {
      number: template.number,
      name: template.name,
      category: template.category,
      aspect_ratio: template.aspect_ratio,
      preview_image_url: template.preview_image_url || null,
      auto_suggested: template.number === autoNumber,
    },
    text_zones: textZones,
    reference_images: refs,
    enhancers: badges,
    concept_notes: `Template #${template.number} "${template.name}" (${template.category}) · ${format} · mechanic ${mechanic} · stage ${stage}${card.scores ? ` · score ${card.scores.overall}` : ''}.`,
    _concept_forge: {
      headline,
      taglines: (champion && champion.taglines) || [card.tagline],
      visualIdea: card.visualIdea,
      cta: card.cta,
      dna: card.dna,
      messagingAngle: card.messagingAngle,
      scores: card.scores || null,
    },
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeFormat = String(format).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const fileName = `${brandSlug}-${safeFormat}-tpl${template.number}-${stamp}.json`;
  try {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(EXPORT_DIR, fileName), JSON.stringify(record, null, 2));
  } catch (e) {
    return { record, file: null, error: `Could not write export file: ${e.message}` };
  }
  return { record, file: path.join('exports', fileName) };
}

module.exports = { exportConcept, EXPORT_DIR };
