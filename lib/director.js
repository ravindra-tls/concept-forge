'use strict';

const crypto = require('crypto');
const { callClaude, extractToolInput, MODELS } = require('./anthropic');
const { DIRECTOR_TOOL } = require('./schema');
const { buildSystemBlocks } = require('./generator');
const { taxonomies } = require('./knowledge');

const DIRECTOR_BRIEF = `
YOU ARE THE CREATIVE PARTNER IN A CHAT.
Behave like a sharp, senior direct-response creative director sitting next to the user — a hands-on collaborator, not a form.

How you work:
- The user steers you at any time. Take their intent seriously and build on it.
- The creative process is NOT linear. The user may hand you any single part — a tagline, a visual, a persona, a pain, a mechanic, a format — and your job is to ASSEMBLE complete, grounded concepts around whatever is pinned, filling every other part yourself. Honor pinned parts exactly.
- When they share a raw idea, sharpen it and spin concepts from it. When they ask for options, produce cards. When they critique or say "make these X", REFINE the referenced cards (set "replaces" to that card's handle). When they're just thinking out loud, think with them.
- Talk like a human collaborator: brief, specific, opinionated. Have a point of view ("I'd push the bride angle — here's why"). Ask ONE sharp clarifying question only when it genuinely changes the work; otherwise just make a strong move.
- Every concept must carry BOTH a tagline that converts (not merely clever) and a concrete visualIdea (the actual shot/scene). Stay grounded in the brand truths; never use banned language.
- Keep 'reply' tight. Put the concepts in 'cards', not in prose. Offer 2–4 'suggestions' for what to do next.`.trim();

function handle(id) {
  return String(id).slice(0, 4);
}

function pinsBlock(pins) {
  pins = pins || {};
  const lines = [];
  for (const [k, v] of Object.entries(pins)) {
    if (k === 'constraints' || k === 'enhancers' || k === 'insights') continue;
    if (v == null || !String(v).trim()) continue;
    if (k === 'cta' && v === 'none') { lines.push('- call to action: NONE (no CTA — top of funnel)'); continue; }
    if (k === 'product') { lines.push(`- product: ${v === 'show' ? 'must visibly appear in the image' : v === 'hide' ? 'do NOT show the product' : v}`); continue; }
    lines.push(`- ${k}: ${v}`);
  }
  const cons = (pins.constraints || []).map((id) => taxonomies.constraintCards.find((c) => c.id === id)).filter(Boolean);
  cons.forEach((c) => lines.push(`- constraint (${c.label}): ${c.instruction}`));
  const ins = Array.isArray(pins.insights) ? pins.insights.filter(Boolean) : [];
  if (ins.length) {
    lines.push('- EMOTIONAL CORE (build concepts on these raw human truths, surfaced WITH EMPATHY — never mock/shame; record the truth in emotionalInsight):');
    ins.forEach((i) => lines.push(`    • [${i.emotion || 'feeling'}] "${i.tension}"${i.momentItStings ? ` — stings when: ${i.momentItStings}` : ''}`));
  }
  if (!lines.length) return 'ASSEMBLY CHAIN: (nothing pinned — you choose every part)';
  return 'ASSEMBLY CHAIN (pinned by the user — honor these exactly, fill the rest yourself):\n' + lines.join('\n');
}

function boardBlock(board) {
  if (!board || !board.length) return 'BOARD: (empty)';
  const lines = board.slice(0, 12).map((c) => {
    const score = c.scores ? ` [${c.scores.overall}]` : '';
    return `- #${handle(c.id)}${score}: "${c.tagline}" — ${c.dna?.mechanic || '?'} / ${c.dna?.format || '?'}`;
  });
  return 'CONCEPTS ON THE BOARD (reference by handle to refine):\n' + lines.join('\n');
}

function historyBlock(chat) {
  const recent = (chat || []).slice(-10);
  if (!recent.length) return '';
  return 'RECENT CONVERSATION:\n' + recent.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n');
}

/**
 * One conversational turn. Returns { reply, cards?, pins?, suggestions? }.
 * Cards are raw (unjudged) with ids attached; `replaces` (a board handle) preserved.
 */
async function directorTurn({ deck, message, chat, board, pins }) {
  const system = buildSystemBlocks(deck); // craft + taxonomy + grounding (cached)
  const userMsg = [
    DIRECTOR_BRIEF,
    '',
    pinsBlock(pins),
    '',
    boardBlock(board),
    '',
    historyBlock(chat),
    '',
    `USER: ${message}`,
    '',
    'Respond via the director_turn tool.',
  ].filter(Boolean).join('\n');

  const response = await callClaude({
    model: MODELS.judge, // Sonnet: strong conversation + concepting
    maxTokens: 4096,
    system,
    messages: [{ role: 'user', content: userMsg }],
    tools: [DIRECTOR_TOOL],
    toolChoice: { type: 'tool', name: 'director_turn' },
  });
  const out = extractToolInput(response, 'director_turn');

  // Resolve card ids: `replaces` (a handle) → reuse that board card's id; else new uuid.
  const byHandle = new Map((board || []).map((c) => [handle(c.id), c.id]));
  const cards = (Array.isArray(out.cards) ? out.cards : []).map((card) => {
    const { replaces, ...rest } = card;
    const existingId = replaces && byHandle.get(replaces);
    return { id: existingId || crypto.randomUUID(), replaces: existingId ? replaces : undefined, ...rest };
  });

  return { reply: out.reply, cards, pins: out.pins || null, suggestions: out.suggestions || [] };
}

module.exports = { directorTurn };
