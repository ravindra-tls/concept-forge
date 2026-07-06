'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadDeck } = require('./grounding');

const SESSION_DIR = path.join(__dirname, '..', 'sessions');

// In-memory stores. Decks are kept out of the persisted file (large + reloadable).
const sessions = new Map();
const decks = new Map();

function createSession(brandSlug, brandName, deck) {
  const id = crypto.randomUUID();
  const session = {
    id,
    brandSlug,
    brandName,
    createdAt: new Date().toISOString(),
    score: 0,
    streak: 0,
    favorites: [],
    suppressed: [],
    genePool: {},
    champions: [],
    history: [],
    board: [],   // working set of concept cards (chat + deal both contribute)
    pins: {},    // the assembly chain — user-pinned parts (selected insights live in pins.insights)
    chat: [],    // conversation with the creative partner
    insightsCache: {}, // mined human-tension insights keyed by persona or persona::pain
  };
  sessions.set(id, session);
  decks.set(id, deck);
  save(session);
  return session;
}

function findSessionFileById(id) {
  try {
    return fs.readdirSync(SESSION_DIR).find((f) => f.endsWith(`-${id}.json`)) || null;
  } catch {
    return null;
  }
}

// Ensure fields added in later versions exist on rehydrated sessions.
function normalize(s) {
  if (!Array.isArray(s.board)) s.board = [];
  if (!s.pins || typeof s.pins !== 'object') s.pins = {};
  if (!Array.isArray(s.chat)) s.chat = [];
  if (!s.insightsCache || typeof s.insightsCache !== 'object') s.insightsCache = {};
  return s;
}

// Rehydrate from disk if the in-memory map was cleared (e.g. server restart).
function getSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const file = findSessionFileById(id);
  if (!file) return null;
  try {
    const s = normalize(JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8')));
    sessions.set(id, s);
    return s;
  } catch {
    return null;
  }
}

// Add or replace cards on the board (newest first). Match by id.
function upsertCards(session, cards) {
  for (const card of cards || []) {
    const clean = { ...card };
    delete clean.replaces;
    const i = session.board.findIndex((c) => c.id === clean.id);
    if (i === -1) session.board.unshift(clean);
    else session.board[i] = clean;
  }
}

function removeCard(session, id) {
  session.board = session.board.filter((c) => c.id !== id);
  session.favorites = session.favorites.filter((c) => c.id !== id);
}

// Merge pins; an empty string clears that slot.
function setPins(session, pins) {
  for (const [k, v] of Object.entries(pins || {})) {
    if (v === '' || v === null) delete session.pins[k];
    else if (v !== undefined) session.pins[k] = v;
  }
}

function setInsightsCache(session, key, insights) {
  if (!session.insightsCache || typeof session.insightsCache !== 'object') session.insightsCache = {};
  session.insightsCache[key] = { at: new Date().toISOString(), insights: insights || [] };
}

function addChat(session, role, text) {
  if (!text) return;
  session.chat.push({ role, text, at: new Date().toISOString() });
  if (session.chat.length > 60) session.chat = session.chat.slice(-60);
}

function getDeck(id) {
  return decks.get(id) || null;
}

// Deck isn't persisted (large + reloadable). Reload it from the brand slug on a miss.
async function ensureDeck(id) {
  if (decks.has(id)) return decks.get(id);
  const s = getSession(id);
  if (!s) return null;
  const deck = await loadDeck(s.brandSlug);
  decks.set(id, deck);
  return deck;
}

// Bump gene-pool weights for a kept card's DNA; suppress a discarded card's DNA.
function reinforce(session, dna, delta) {
  if (!dna) return;
  for (const [dim, value] of Object.entries(dna)) {
    if (!value) continue;
    const key = `${dim}:${value}`;
    session.genePool[key] = (session.genePool[key] || 0) + delta;
    if (session.genePool[key] <= 0) delete session.genePool[key];
  }
}

function suppressDna(session, dna) {
  if (!dna) return;
  // Suppress the two most defining dims (mechanic + format) so breeding avoids them.
  for (const dim of ['mechanic', 'format', 'hookTactic']) {
    if (dna[dim]) {
      const key = `${dim}:${dna[dim]}`;
      if (!session.suppressed.includes(key)) session.suppressed.push(key);
    }
  }
}

function save(session) {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const file = path.join(SESSION_DIR, `${session.brandSlug}-${session.id}.json`);
    fs.writeFileSync(file, JSON.stringify(session, null, 2));
  } catch { /* best-effort persistence */ }
}

module.exports = {
  createSession, getSession, getDeck, ensureDeck,
  reinforce, suppressDna, save, SESSION_DIR,
  upsertCards, removeCard, setPins, addChat, setInsightsCache,
};
