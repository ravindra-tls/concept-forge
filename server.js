'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { loadEnv, hasApiKey, hasFalKey } = require('./lib/env');
loadEnv(__dirname);

const { taxonomies, staticFormats } = require('./lib/knowledge');
const { listBrands, loadDeck } = require('./lib/grounding');
const { dealHand, breedHand, dealStream } = require('./lib/engine');
const { directorTurn } = require('./lib/director');
const { refineCard } = require('./lib/refine');
const { scoreCards } = require('./lib/judge');
const { polishChampion, refineChampion } = require('./lib/champion');
const { exportConcept } = require('./lib/export');
const { listTemplates } = require('./lib/templates');
const { mineInsights } = require('./lib/insights');
const { generateImage } = require('./lib/falai');
const sessionStore = require('./lib/session');

const PORT = Number(process.env.PORT) || 4317;
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function apiError(res, err) {
  if (err && err.code === 'NO_API_KEY') {
    return sendJson(res, 400, { error: err.message, code: 'NO_API_KEY' });
  }
  if (err && err.code === 'NO_FAL_KEY') {
    return sendJson(res, 400, { error: err.message, code: 'NO_FAL_KEY' });
  }
  if (err && err.code === 'NO_BRAND') {
    return sendJson(res, 404, { error: err.message, code: 'NO_BRAND' });
  }
  // eslint-disable-next-line no-console
  console.error('[concept-forge] error:', err && err.message);
  return sendJson(res, 500, { error: (err && err.message) || 'Internal error' });
}

// Serialize a session for the client (safe: contains no secrets).
function sessionView(s) {
  return {
    id: s.id,
    brandSlug: s.brandSlug,
    brandName: s.brandName,
    score: s.score,
    streak: s.streak,
    favorites: s.favorites,
    genePool: s.genePool,
    suppressed: s.suppressed,
    champions: s.champions,
    history: s.history,
    board: s.board || [],
    pins: s.pins || {},
    chat: s.chat || [],
    insightsCache: s.insightsCache || {},
  };
}

async function handleApi(req, res, pathname) {
  // Health
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, hasApiKey: hasApiKey(), hasFalKey: hasFalKey() });
  }

  // Taxonomies (for the loadout UI)
  if (req.method === 'GET' && pathname === '/api/taxonomies') {
    return sendJson(res, 200, {
      stages: taxonomies.awarenessStages,
      mechanics: taxonomies.mechanics,
      triggers: taxonomies.triggers,
      hookTactics: taxonomies.hookTactics,
      voicePatterns: taxonomies.voicePatterns,
      formats: staticFormats(),
      constraintCards: taxonomies.constraintCards,
      ctaOptions: taxonomies.ctaOptions,
      conversionEnhancers: taxonomies.conversionEnhancers,
    });
  }

  // Brands
  if (req.method === 'GET' && pathname === '/api/brands') {
    return sendJson(res, 200, { brands: listBrands(), hasApiKey: hasApiKey(), hasFalKey: hasFalKey() });
  }

  // Get a session
  if (req.method === 'GET' && pathname.startsWith('/api/session/')) {
    const id = pathname.slice('/api/session/'.length);
    const s = sessionStore.getSession(id);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    return sendJson(res, 200, { session: sessionView(s) });
  }

  // Start a session
  if (req.method === 'POST' && pathname === '/api/session') {
    const body = await readBody(req);
    if (!body.slug) return sendJson(res, 400, { error: 'slug required' });
    const brand = listBrands().find((b) => b.slug === body.slug);
    if (!brand) return sendJson(res, 404, { error: `Unknown brand "${body.slug}"`, code: 'NO_BRAND' });
    const deck = await loadDeck(body.slug);
    const s = sessionStore.createSession(body.slug, deck.brand || brand.name, deck);
    return sendJson(res, 200, {
      session: sessionView(s),
      deck: {
        brand: deck.brand,
        product: deck.product,
        oneLiner: deck.oneLiner,
        anchorType: deck.anchorType,
        personas: deck.personas,
        pains: deck.pains,
        referenceImages: deck.referenceImages || [],
        approvedLanguage: (deck.brandVoice && deck.brandVoice.approvedLanguage) || [],
      },
    });
  }

  // Deal a hand
  if (req.method === 'POST' && pathname === '/api/deal') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    const loadout = { ...(s.pins || {}), ...(body.loadout || {}) };

    // Streaming path: emit each concept as it clears the gate (NDJSON), so the
    // board fills progressively instead of waiting for the whole hand.
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      const write = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ } };
      try {
        const result = await dealStream({ deck, loadout, onCard: (card) => write({ type: 'card', card }) });
        sessionStore.upsertCards(s, result.cards);
        s.history.push({ type: 'deal', at: new Date().toISOString(), returned: result.cards.length, stats: result.stats });
        sessionStore.save(s);
        write({ type: 'done', stats: result.stats, session: sessionView(s) });
      } catch (err) {
        write({ type: 'error', error: (err && err.message) || 'Generation failed' });
      }
      return res.end();
    }

    const result = await dealHand({ deck, loadout });
    sessionStore.upsertCards(s, result.cards);
    s.history.push({ type: 'deal', at: new Date().toISOString(), returned: result.cards.length, stats: result.stats });
    sessionStore.save(s);
    return sendJson(res, 200, { ...result, session: sessionView(s) });
  }

  // Breed from parents
  if (req.method === 'POST' && pathname === '/api/breed') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    const parents = (body.parents && body.parents.length) ? body.parents : s.favorites;
    if (!parents || !parents.length) return sendJson(res, 400, { error: 'No parent concepts to breed from. Keep at least one card first.' });
    const loadout = { ...(s.pins || {}), ...(body.loadout || {}) };
    const result = await breedHand({ deck, parents, loadout, suppressed: s.suppressed });
    sessionStore.upsertCards(s, result.cards);
    s.history.push({ type: 'breed', at: new Date().toISOString(), returned: result.cards.length, stats: result.stats });
    sessionStore.save(s);
    return sendJson(res, 200, { ...result, session: sessionView(s) });
  }

  // Keep / discard a card (feeds gene pool, score, favorites)
  if (req.method === 'POST' && pathname === '/api/react') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const card = body.card;
    if (!card) return sendJson(res, 400, { error: 'card required' });
    if (body.keep) {
      if (!s.favorites.find((c) => c.id === card.id)) s.favorites.push(card);
      sessionStore.reinforce(s, card.dna, +1);
      s.score += Math.max(1, Math.round((card.scores?.overall || 50) / 10));
      s.streak += 1;
    } else {
      sessionStore.reinforce(s, card.dna, -1);
      sessionStore.suppressDna(s, card.dna);
      sessionStore.removeCard(s, card.id); // drop from board + favorites
      s.streak = 0;
    }
    sessionStore.save(s);
    return sendJson(res, 200, { session: sessionView(s) });
  }

  // Chat with the creative director (produces/refines concepts, updates the chain)
  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });

    // Regenerate: re-run the last user turn without duplicating history.
    let message; let priorChat;
    if (body.retry === true) {
      while (s.chat.length && s.chat[s.chat.length - 1].role === 'assistant') s.chat.pop();
      const idx = s.chat.map((m) => m.role).lastIndexOf('user');
      if (idx === -1) return sendJson(res, 400, { error: 'Nothing to regenerate yet.' });
      message = s.chat[idx].text;
      priorChat = s.chat.slice(0, idx);
    } else {
      message = String(body.message || '').trim();
      if (!message) return sendJson(res, 400, { error: 'message required' });
      priorChat = s.chat.slice();
      sessionStore.addChat(s, 'user', message);
    }
    const turn = await directorTurn({ deck, message, chat: priorChat, board: s.board, pins: s.pins });

    let judged = [];
    if (turn.cards && turn.cards.length) {
      judged = await scoreCards({ deck, cards: turn.cards });
      sessionStore.upsertCards(s, judged);
    }
    if (turn.pins) sessionStore.setPins(s, turn.pins);
    // Card refs ride on the chat entry so replies stay linked to the concepts they made.
    sessionStore.addChat(s, 'assistant', turn.reply,
      judged.length ? { cards: judged.map((c) => ({ id: c.id, tagline: c.tagline })) } : undefined);
    sessionStore.save(s);
    return sendJson(res, 200, {
      reply: turn.reply, cards: judged, pins: s.pins, suggestions: turn.suggestions, session: sessionView(s),
    });
  }

  // Set assembly-chain pins from the UI
  if (req.method === 'POST' && pathname === '/api/pins') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    sessionStore.setPins(s, body.pins || {});
    sessionStore.save(s);
    return sendJson(res, 200, { session: sessionView(s) });
  }

  // Mine deep human-tension insights for a persona (Opus). Cached per persona(::pain).
  if (req.method === 'POST' && pathname === '/api/insights') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    const personaId = body.persona || (s.pins && s.pins.persona);
    if (!personaId) return sendJson(res, 400, { error: 'Pick a persona first — insights are mined for one person.' });
    const painId = body.pain || (s.pins && s.pins.pain) || '';
    const key = painId ? `${personaId}::${painId}` : personaId;
    if (!body.force && s.insightsCache && s.insightsCache[key]) {
      return sendJson(res, 200, { insights: s.insightsCache[key].insights, cached: true, session: sessionView(s) });
    }
    const insights = await mineInsights({ deck, personaId, painId });
    sessionStore.setInsightsCache(s, key, insights);
    sessionStore.save(s);
    return sendJson(res, 200, { insights, cached: false, session: sessionView(s) });
  }

  // Refine a concept from inline comments (select-text → comment → regenerate)
  if (req.method === 'POST' && pathname === '/api/refine') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    if (!body.card) return sendJson(res, 400, { error: 'card required' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    const refined = await refineCard({ deck, card: body.card, comments: body.comments || [], pins: s.pins });
    const [judged] = await scoreCards({ deck, cards: [refined] });
    sessionStore.upsertCards(s, [judged]);
    sessionStore.save(s);
    return sendJson(res, 200, { card: judged, session: sessionView(s) });
  }

  // Crown a champion (final polish)
  if (req.method === 'POST' && pathname === '/api/champion') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    if (!body.card) return sendJson(res, 400, { error: 'card required' });
    const champion = await polishChampion({ deck, card: body.card });
    const entry = { id: body.card.id, dna: body.card.dna, champion, at: new Date().toISOString() };
    s.champions.push(entry);
    s.score += 25;
    sessionStore.save(s);
    return sendJson(res, 200, { champion, session: sessionView(s) });
  }

  // Re-polish a finalized concept from inline comments
  if (req.method === 'POST' && pathname === '/api/refine-champion') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    if (!body.card || !body.champion) return sendJson(res, 400, { error: 'card and champion required' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    const champion = await refineChampion({ deck, card: body.card, champion: body.champion, comments: body.comments || [] });
    const entry = s.champions.find((c) => c.id === body.card.id);
    if (entry) entry.champion = champion; else s.champions.push({ id: body.card.id, dna: body.card.dna, champion, at: new Date().toISOString() });
    sessionStore.save(s);
    return sendJson(res, 200, { champion, session: sessionView(s) });
  }

  // Ad-template library (for the export-panel picker)
  if (req.method === 'GET' && pathname === '/api/templates') {
    return sendJson(res, 200, { templates: listTemplates() });
  }

  // Export: fill a proven ad template with this concept's copy + brand grounding
  if (req.method === 'POST' && pathname === '/api/export') {
    const body = await readBody(req);
    const s = sessionStore.getSession(body.sessionId);
    if (!s) return sendJson(res, 404, { error: 'Session not found' });
    const deck = await sessionStore.ensureDeck(body.sessionId);
    if (!deck) return sendJson(res, 404, { error: 'Session deck unavailable — start a new session.' });
    if (!body.card || !body.champion) return sendJson(res, 400, { error: 'card and champion required' });
    const out = await exportConcept({
      deck,
      champion: body.champion,
      card: body.card,
      placement: body.placement || 'feed',
      referenceImages: body.referenceImages || [],
      pins: s.pins || {},
      brandSlug: s.brandSlug,
      templateNumber: body.templateNumber || null,
    });
    return sendJson(res, 200, out);
  }

  // Actually render the image via fal.ai (Nano Banana Pro) — no copy/paste required.
  if (req.method === 'POST' && pathname === '/api/generate-image') {
    const body = await readBody(req);
    if (!body.prompt) return sendJson(res, 400, { error: 'prompt required' });
    const result = await generateImage({
      prompt: body.prompt,
      imageUrls: body.referenceImages || [],
      aspectRatio: body.aspectRatio,
      resolution: body.resolution || '2K',
    });
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    apiError(res, err);
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Concept Forge running →  http://localhost:${PORT}`);
  if (!hasApiKey()) {
    // eslint-disable-next-line no-console
    console.log('  ⚠  No ANTHROPIC_API_KEY found. The UI loads, but dealing cards needs a key.');
    console.log('     Add it to concept-forge/.env or set ANTHROPIC_ENV_FILE. See .env.example.\n');
  } else {
    // eslint-disable-next-line no-console
    console.log('  ✓  API key detected.\n');
  }
});
