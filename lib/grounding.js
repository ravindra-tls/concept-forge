'use strict';

const fs = require('fs');
const path = require('path');
const { callClaude, extractToolInput, MODELS } = require('./anthropic');

const BRAND_DIR = path.join(__dirname, '..', 'brand-context');

/** List available brands from brand-context/*.md (ignoring the .deck.json caches). */
function listBrands() {
  let files = [];
  try {
    files = fs.readdirSync(BRAND_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const deckPath = path.join(BRAND_DIR, `${slug}.deck.json`);
      let name = slug;
      try {
        if (fs.existsSync(deckPath)) name = JSON.parse(fs.readFileSync(deckPath, 'utf8')).brand || slug;
        else {
          const md = fs.readFileSync(path.join(BRAND_DIR, f), 'utf8');
          const h1 = md.match(/^#\s+(.+)$/m);
          if (h1) name = h1[1].replace(/^Brand Context\s*[—-]\s*/i, '').trim();
        }
      } catch { /* keep slug */ }
      return { slug, name, hasDeck: fs.existsSync(deckPath) };
    });
}

// Schema the distiller model must fill when converting a brand-context doc into a deck.
const DECK_TOOL = {
  name: 'emit_grounding_deck',
  description: 'Emit a compact, structured grounding deck distilled from a brand context document.',
  input_schema: {
    type: 'object',
    properties: {
      brand: { type: 'string' },
      product: { type: 'string' },
      oneLiner: { type: 'string' },
      market: { type: 'string' },
      price: { type: 'string' },
      anchorType: { type: 'string', enum: ['pain', 'desire'] },
      productTruths: { type: 'array', items: { type: 'string' } },
      mechanisms: { type: 'array', items: { type: 'string' } },
      proofPoints: { type: 'array', items: { type: 'string' } },
      personas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            lifeContext: { type: 'string' },
            desire: { type: 'string' },
            // Inner emotional life — the unspoken truths a great marketer imagines.
            innerMonologue: { type: 'string', description: 'A first-person line she thinks but would never say aloud.' },
            unspokenFears: { type: 'array', items: { type: 'string' }, description: '2–3 raw fears about her body, aging, or identity.' },
            socialComparison: { type: 'string', description: 'Who she quietly envies or measures herself against.' },
            shameMoments: { type: 'array', items: { type: 'string' }, description: 'Concrete stinging scenes (e.g. "catching her arms in a dressing-room mirror").' },
            identityLost: { type: 'string', description: 'Who she used to be — the quiet grief.' },
            identityDesired: { type: 'string', description: 'Who she wants to feel like again.' },
          },
          required: ['id', 'name', 'lifeContext', 'desire'],
        },
      },
      pains: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
            vocPhrases: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'label', 'description'],
        },
      },
      brandVoice: {
        type: 'object',
        properties: {
          adjectives: { type: 'array', items: { type: 'string' } },
          approvedLanguage: { type: 'array', items: { type: 'string' } },
          bannedLanguage: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
      constraints: { type: 'array', items: { type: 'string' } },
      offer: { type: 'string' },
      visualStyle: {
        type: 'object',
        description: 'Visual identity for image generation.',
        properties: {
          typography: { type: 'string', description: 'on-image text style, e.g. "modern sans-serif" or "clean serif"' },
          palette: { type: 'array', items: { type: 'string' }, description: 'named brand colors (with hex where known)' },
          lightingDefault: { type: 'string' },
          colorGrading: { type: 'string', description: 'warm | neutral | cool' },
        },
      },
      referenceImages: { type: 'array', items: { type: 'string' }, description: 'paths/URLs to real product photos for image-to-image conditioning' },
    },
    required: ['brand', 'product', 'anchorType', 'productTruths', 'personas', 'pains', 'brandVoice'],
  },
};

/**
 * Load the grounding deck for a brand.
 * - If <slug>.deck.json exists, use it (fast, offline).
 * - Otherwise distill <slug>.md via the API and cache the result.
 */
async function loadDeck(slug) {
  const safeSlug = String(slug).replace(/[^a-z0-9._-]/gi, '');
  const deckPath = path.join(BRAND_DIR, `${safeSlug}.deck.json`);
  const mdPath = path.join(BRAND_DIR, `${safeSlug}.md`);

  let deck;
  if (fs.existsSync(deckPath)) {
    deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  } else {
    if (!fs.existsSync(mdPath)) {
      const err = new Error(`No brand context found for "${slug}". Add brand-context/${safeSlug}.md`);
      err.code = 'NO_BRAND';
      throw err;
    }
    const md = fs.readFileSync(mdPath, 'utf8');
    const response = await callClaude({
      model: MODELS.judge,
      maxTokens: 8000,
      system: 'You distill a brand context document into a compact, structured grounding deck used to ground ad-concept generation. Extract only what is stated or clearly implied. Preserve exact approved/banned language and any compliance constraints. Give personas and pains short stable kebab-case ids. For each persona, ALSO infer their inner emotional life — the uncomfortable, unspoken truths a brilliant, empathetic marketer imagines when picturing ONE real person: their inner monologue, unspoken fears, who they quietly envy, the concrete moments that sting, who they used to be, and who they want to feel like again. Go to real, human places (envy, shame, fear of aging, grief, vanity). This raw layer is internal grounding for ideation only — downstream copy always surfaces it with empathy, never mocking. Never use the brand\'s banned language or make medical claims, even in these fields.',
      messages: [{ role: 'user', content: `Brand context document:\n\n${md}` }],
      tools: [DECK_TOOL],
      toolChoice: { type: 'tool', name: 'emit_grounding_deck' },
    });
    deck = extractToolInput(response, 'emit_grounding_deck');
    try {
      fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2));
    } catch { /* cache write is best-effort */ }
  }

  // Lazily deepen legacy decks that predate the inner-life fields; writes back once.
  await enrichPersonas(deck, deckPath);
  return deck;
}

// Tool the enrichment model fills — inner emotional life for ONE persona.
// (Per-persona so the tool JSON can never truncate at max_tokens.)
const ENRICH_TOOL = {
  name: 'emit_persona_inner_life',
  description: 'Return the inner emotional life of one persona.',
  input_schema: {
    type: 'object',
    properties: {
      innerMonologue: { type: 'string' },
      unspokenFears: { type: 'array', items: { type: 'string' } },
      socialComparison: { type: 'string' },
      shameMoments: { type: 'array', items: { type: 'string' } },
      identityLost: { type: 'string' },
      identityDesired: { type: 'string' },
    },
    required: ['innerMonologue'],
  },
};

const ENRICH_SYSTEM = 'You deepen ad-audience personas with their inner emotional life — the uncomfortable, unspoken truths a brilliant, empathetic marketer imagines when picturing ONE real person. Go to real, human places: envy of others, shame about the body or aging, fear of disappearing or being seen as old, grief for who they used to be, vanity they will not admit. This raw layer is internal grounding for ideation — downstream copy always surfaces it with empathy, never mocking or shaming. Never use the brand\'s banned language and never make a medical/disease claim, even inside these fields. Return exactly one enrichment object per persona id you are given, keeping ids unchanged.';

/**
 * Lazily add inner-life fields to a deck's personas if they lack them (Sonnet).
 * Merges only into empty fields, then writes the deck back. Best-effort: any
 * failure is swallowed so a session is never blocked.
 */
async function enrichOnePersona(deck, persona) {
  const banned = (deck.brandVoice && deck.brandVoice.bannedLanguage) || [];
  const painLines = (deck.pains || []).map((p) => `- ${p.label}: ${p.description || ''}`).join('\n');
  const userMsg = [
    `BRAND: ${deck.brand} — ${deck.product || ''}`,
    banned.length ? `BANNED LANGUAGE (never use, even in these fields): ${banned.join(', ')}` : '',
    deck.brandVoice && deck.brandVoice.notes ? `BRAND NOTES: ${deck.brandVoice.notes}` : '',
    '',
    'PERSONA — imagine HER, one real person:',
    `[${persona.id}] ${persona.name}: ${persona.description || ''}`,
    `life: ${persona.lifeContext || ''}`,
    `wants: ${persona.desire || ''}`,
    painLines ? `\nTHE PAINS SHE LIVES WITH:\n${painLines}` : '',
    '',
    'Return her innerMonologue, unspokenFears (2–3), socialComparison, shameMoments (2–3 concrete scenes), identityLost, identityDesired.',
  ].filter(Boolean).join('\n');

  const response = await callClaude({
    model: MODELS.judge,
    maxTokens: 4000,
    system: ENRICH_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    tools: [ENRICH_TOOL],
    toolChoice: { type: 'tool', name: 'emit_persona_inner_life' },
  });
  return extractToolInput(response, 'emit_persona_inner_life');
}

async function enrichPersonas(deck, deckPath) {
  if (!deck || !Array.isArray(deck.personas) || !deck.personas.length) return deck;
  const targets = deck.personas.filter((p) => p && !p.innerMonologue);
  if (!targets.length) return deck;
  try {
    // One small call per persona, in parallel — keeps each tool response tiny so
    // it can never truncate at max_tokens. Per-persona failures are tolerated.
    const results = await Promise.all(targets.map((p) =>
      enrichOnePersona(deck, p).then((e) => ({ id: p.id, e })).catch(() => ({ id: p.id, e: null }))));
    const byId = new Map(results.filter((r) => r.e).map((r) => [r.id, r.e]));
    let changed = false;
    deck.personas = deck.personas.map((p) => {
      const e = byId.get(p.id);
      if (!e) return p;
      const merged = { ...p };
      for (const k of ['innerMonologue', 'socialComparison', 'identityLost', 'identityDesired']) {
        if (!merged[k] && e[k]) { merged[k] = e[k]; changed = true; }
      }
      for (const k of ['unspokenFears', 'shameMoments']) {
        if ((!merged[k] || !merged[k].length) && Array.isArray(e[k]) && e[k].length) { merged[k] = e[k]; changed = true; }
      }
      return merged;
    });
    if (changed) { try { fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2)); } catch { /* best-effort */ } }
  } catch (err) {
    // Enrichment is best-effort; never block a session — but surface why it skipped.
    // eslint-disable-next-line no-console
    console.error('[concept-forge] persona enrichment skipped:', err && err.message);
  }
  return deck;
}

/**
 * Compact text block of the deck for injection into generation/judge system prompts.
 * This block is marked cacheable by callers (prompt caching).
 */
function deckToPromptBlock(deck) {
  const lines = [];
  lines.push(`BRAND: ${deck.brand}`);
  lines.push(`PRODUCT: ${deck.product}`);
  if (deck.oneLiner) lines.push(`ONE-LINER: ${deck.oneLiner}`);
  if (deck.market) lines.push(`MARKET: ${deck.market}`);
  if (deck.price) lines.push(`PRICE/OFFER: ${deck.price}`);
  lines.push(`PRIMARY ANCHOR: ${deck.anchorType}`);
  lines.push('');
  lines.push('PRODUCT TRUTHS (anchor every concept in at least one — do not invent facts beyond these):');
  (deck.productTruths || []).forEach((t) => lines.push(`- ${t}`));
  if (deck.mechanisms && deck.mechanisms.length) {
    lines.push('UNIQUE MECHANISM:');
    deck.mechanisms.forEach((m) => lines.push(`- ${m}`));
  }
  if (deck.proofPoints && deck.proofPoints.length) {
    lines.push('PROOF POINTS:');
    deck.proofPoints.forEach((p) => lines.push(`- ${p}`));
  }
  lines.push('');
  lines.push('PERSONAS:');
  (deck.personas || []).forEach((p) => {
    lines.push(`- [${p.id}] ${p.name} — ${p.description || ''}`.trim());
    lines.push(`    life: ${p.lifeContext}; wants: ${p.desire}`);
    // Compact inner-life: enough emotional signal for generation + the judge's
    // emotionalTruth axis, without the full arrays (which bloat every call). The
    // complete depth still reaches the insight miner via its own persona block.
    const inner = [
      p.innerMonologue ? `"${p.innerMonologue}"` : '',
      (p.unspokenFears && p.unspokenFears[0]) ? `fears ${p.unspokenFears[0]}` : '',
      p.socialComparison ? `envies ${p.socialComparison}` : '',
      (p.shameMoments && p.shameMoments[0]) ? `stings when ${p.shameMoments[0]}` : '',
      (p.identityLost || p.identityDesired) ? `${p.identityLost || '—'} → ${p.identityDesired || '—'}` : '',
    ].filter(Boolean).join(' · ');
    if (inner) lines.push(`    inner: ${inner}`);
  });
  lines.push('');
  lines.push('PAINS/DESIRES:');
  (deck.pains || []).forEach((p) => {
    lines.push(`- [${p.id}] ${p.label} — ${p.description}`);
    if (p.vocPhrases && p.vocPhrases.length) lines.push(`    they say: "${p.vocPhrases.join('" / "')}"`);
  });
  lines.push('');
  const bv = deck.brandVoice || {};
  lines.push('BRAND VOICE:');
  if (bv.adjectives) lines.push(`- tone: ${bv.adjectives.join(', ')}`);
  if (bv.approvedLanguage) lines.push(`- APPROVED language (prefer these): ${bv.approvedLanguage.join(', ')}`);
  if (bv.bannedLanguage) lines.push(`- BANNED language (never use — hard fail): ${bv.bannedLanguage.join(', ')}`);
  if (bv.notes) lines.push(`- notes: ${bv.notes}`);
  if (deck.constraints && deck.constraints.length) {
    lines.push('CONSTRAINTS:');
    deck.constraints.forEach((c) => lines.push(`- ${c}`));
  }
  const vs = deck.visualStyle;
  if (vs && (vs.typography || (vs.palette && vs.palette.length))) {
    lines.push('VISUAL STYLE:');
    if (vs.typography) lines.push(`- typography: ${vs.typography}`);
    if (vs.palette && vs.palette.length) lines.push(`- palette: ${vs.palette.join(', ')}`);
    if (vs.lightingDefault) lines.push(`- lighting: ${vs.lightingDefault}`);
    if (vs.colorGrading) lines.push(`- color grading: ${vs.colorGrading}`);
  }
  return lines.join('\n');
}

module.exports = { listBrands, loadDeck, deckToPromptBlock, BRAND_DIR };
