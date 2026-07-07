'use strict';

// ---------- state ----------
let TAX = null;
let session = null;
let deck = null;
let brandSlug = null;
let suggestions = [];
const cardComments = {};      // cardId -> [{quote, comment}] on board concepts
const championComments = {};  // cardId -> [{quote, comment}] on finalized concepts
let currentChampion = null;   // { card, champ } currently open in the finalize modal
let commentWidget = null;
const toolbar = { count: 4, medium: 'Static' }; // static-image tool

const $ = (id) => document.getElementById(id);

// ---------- api ----------
async function api(method, path, body, opts = {}) {
  let res;
  // Generation can take up to ~2 min on rich brands; cap so a dropped connection
  // fails LOUDLY instead of hanging the loader forever. An optional caller signal
  // (opts.signal) lets the UI offer a Stop button.
  const timeout = AbortSignal.timeout(240000);
  const signal = opts.signal
    ? (AbortSignal.any ? AbortSignal.any([timeout, opts.signal]) : opts.signal)
    : timeout;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (opts.signal && opts.signal.aborted) {
      const e = new Error('Stopped'); e.aborted = true; throw e;
    }
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('The server took too long or the connection dropped. If the dev server restarted, reload the page (Ctrl+F5) and try again.');
    }
    throw new Error('Could not reach the server — it may have restarted or stopped. Reload the page (Ctrl+F5); if it persists, restart the dev server (node server.js).');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.code = data.code; throw e; }
  return data;
}
function isSessionErr(e) { return /session not found|deck unavailable/i.test(e.message || ''); }
async function recreateSession() {
  if (!brandSlug) throw new Error('No brand to recreate session for.');
  const data = await api('POST', '/api/session', { slug: brandSlug });
  session = data.session; deck = data.deck; toast('Server had restarted — recreated your session.');
}
async function callWithSession(method, path, makeBody, opts) {
  try { return await api(method, path, makeBody(), opts); }
  catch (e) { if (isSessionErr(e)) { await recreateSession(); return await api(method, path, makeBody(), opts); } throw e; }
}

// ---------- helpers ----------
function toast(msg, isErr) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3000);
}
function showLoader(text) { $('loader-text').textContent = text || 'Generating…'; $('loader').hidden = false; }
function hideLoader() { $('loader').hidden = true; }
function personaName(id) { const p = (deck?.personas || []).find((x) => x.id === id); return p ? p.name : id; }
function painLabel(id) { const p = (deck?.pains || []).find((x) => x.id === id); return p ? p.label : id; }
function stageName(id) { const s = (TAX?.stages || []).find((x) => x.id === id); return s ? s.name : id; }
function barColor(v) { return v >= 85 ? 'var(--green)' : v >= 70 ? 'var(--warn-text)' : 'var(--wine)'; }
function randOf(a) { return a[Math.floor(Math.random() * a.length)]; }
function mediumOk(f) { if (!f || toolbar.medium === 'Any') return true; return f.medium === toolbar.medium || f.medium === 'Video/Static'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- init ----------
async function init() {
  try {
    TAX = await api('GET', '/api/taxonomies');
    const { brands, hasApiKey, hasFalKey } = await api('GET', '/api/brands');
    const sel = $('brand-select'); sel.innerHTML = '';
    if (!brands.length) { sel.innerHTML = '<option>No brands found — add brand-context/*.md</option>'; $('start-btn').disabled = true; }
    else brands.forEach((b) => { const o = document.createElement('option'); o.value = b.slug; o.textContent = b.name; sel.appendChild(o); });
    const bits = [hasApiKey ? '✓ Anthropic key detected' : '⚠ No ANTHROPIC_API_KEY — set it before generating'];
    bits.push(hasFalKey ? '✓ fal.ai key detected' : '⚠ No FAL_KEY — image generation on export will be unavailable until it\'s set');
    $('setup-hint').textContent = bits.join(' · ');
  } catch (e) { toast(e.message, true); }
}

// ---------- session ----------
function buildSuggestions() {
  const p = deck.personas || []; const pains = deck.pains || [];
  const out = [];
  if (p[0] && pains[0]) out.push(`Concepts for ${p[0].name} about "${pains[0].label}"`);
  out.push(`3 scroll-stopping visual ideas for ${deck.brand.split('(')[0].trim()}`);
  if (pains[1]) out.push(`Give me a concept that leans into "${pains[1].label}"`);
  out.push(`Which angle would convert best for ${p[1] ? p[1].name : 'our buyer'}?`);
  return out.slice(0, 4);
}
async function startSession() {
  brandSlug = $('brand-select').value;
  showLoader('Loading brand…');
  try {
    const data = await api('POST', '/api/session', { slug: brandSlug });
    session = data.session; deck = data.deck;
    $('brand-current').textContent = deck.brand + (deck.oneLiner ? ' — ' + deck.oneLiner : '');
    $('setup').hidden = true; $('game').hidden = false; $('new-session-btn').hidden = false;
    suggestions = buildSuggestions();
    render(); renderChat();
  } catch (e) { toast(e.message, true); } finally { hideLoader(); }
}

// ---------- master render ----------
function render() { renderFeed(); renderChain(); syncStats(); }

// ---------- feed tabs: Board | Finalized ----------
let feedView = 'board';
function setFeedView(v) {
  feedView = v;
  document.querySelectorAll('#feed-tabs .feed-tab').forEach((b) => b.classList.toggle('selected', b.dataset.view === v));
  renderFeed();
}
function renderFeed() {
  const isBoard = feedView === 'board';
  $('board').hidden = !isBoard;
  $('finalized').hidden = isBoard;
  if (isBoard) renderBoard(); else renderFinalized();
}
// Champions deduped by card id (last finalize wins), newest first.
function dedupedChampions() {
  const map = new Map();
  (session.champions || []).forEach((c) => map.set(c.id, c));
  return [...map.values()].reverse();
}
function renderFinalized() {
  const host = $('finalized'); host.innerHTML = '';
  const champs = dedupedChampions();
  if (!champs.length) { host.innerHTML = '<div class="feed-empty">★ Nothing finalized yet — finalize a concept on the Board and it locks in here.</div>'; return; }
  champs.forEach((c) => {
    const row = document.createElement('div'); row.className = 'final-row';
    const when = c.at ? new Date(c.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    row.innerHTML = `
      <div class="final-main">
        <div class="final-headline">${esc(c.champion.headline)}</div>
        <div class="final-sub">${esc(c.dna?.format || '')}${c.dna?.mechanic ? ' · ' + esc(c.dna.mechanic) : ''}${when ? ' · ' + esc(when) : ''}</div>
      </div>
      <button class="ghost-btn final-open" type="button">Open ★</button>`;
    // Reopen the stored champion directly — no re-polish, no API call.
    row.querySelector('.final-open').addEventListener('click', () =>
      renderChampionModal({ id: c.id, dna: c.dna, visualIdea: c.champion.visualIdea || '' }, c.champion));
    host.appendChild(row);
  });
}
function syncStats() {
  const b = (session.board || []).length, f = dedupedChampions().length;
  $('counter').textContent = `${b} concept${b !== 1 ? 's' : ''} · ${f} finalized`;
  setTabCount('board-count', b); setTabCount('final-count', f);
}
function setTabCount(id, n) {
  const el = $(id); if (!el) return;
  if (el.textContent !== String(n)) { el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
}

// ---------- chat ----------
const STARTER_ICONS = ['✨', '🎬', '💡', '🎯'];

function suggestionChip(text, icon) {
  const b = document.createElement('button'); b.className = 'suggestion';
  b.textContent = (icon ? icon + ' ' : '') + text;
  b.addEventListener('click', () => { const inp = $('chat-input'); inp.value = text; autoGrowChat(); sendChat(); });
  return b;
}

function msgEl(m, isLastAssistant) {
  const d = document.createElement('div'); d.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
  const body = document.createElement('div'); body.className = 'msg-body'; body.textContent = m.text; d.appendChild(body);
  if (m.role !== 'assistant') return d;

  // Concepts this reply created — rich chips that jump to the board (Notion-style mentions).
  if (Array.isArray(m.cards) && m.cards.length) {
    const row = document.createElement('div'); row.className = 'msg-cards';
    m.cards.forEach((c) => {
      const chip = document.createElement('button'); chip.className = 'card-chip';
      chip.textContent = '🃏 ' + c.tagline; chip.title = 'Show on the board';
      chip.addEventListener('click', () => revealCard(c.id));
      row.appendChild(chip);
    });
    d.appendChild(row);
  }
  // Hover action bar on replies: copy always, retry on the latest one.
  const bar = document.createElement('div'); bar.className = 'msg-actions';
  const copy = document.createElement('button'); copy.className = 'msg-act'; copy.textContent = '📋 Copy';
  copy.addEventListener('click', () => {
    const done = () => toast('Copied');
    if (navigator.clipboard) navigator.clipboard.writeText(m.text).then(done).catch(() => toast('Copy failed', true));
  });
  bar.appendChild(copy);
  if (isLastAssistant) {
    const re = document.createElement('button'); re.className = 'msg-act'; re.textContent = '↻ Retry';
    re.title = 'Regenerate this reply';
    re.addEventListener('click', () => sendChat(true));
    bar.appendChild(re);
  }
  d.appendChild(bar);
  return d;
}

function revealCard(id) {
  if (feedView !== 'board') setFeedView('board');
  const el = document.querySelector(`#board .card[data-id="${id}"]`);
  if (!el) { toast('That concept is no longer on the board'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

function renderChat() {
  const log = $('chat-log'); log.innerHTML = '';
  const chat = session.chat || [];
  if (!chat.length) {
    const e = document.createElement('div'); e.className = 'chat-empty';
    e.innerHTML = '<div class="ce-title">🧠 Your creative partner</div><div class="ce-sub">Share a half-formed idea, pin a Brief above, or start from one of these:</div>';
    const starters = document.createElement('div'); starters.className = 'chat-starters';
    (suggestions || []).forEach((s, i) => starters.appendChild(suggestionChip(s, STARTER_ICONS[i % STARTER_ICONS.length])));
    e.appendChild(starters);
    log.appendChild(e);
  } else {
    const lastAssistant = chat.map((m) => m.role).lastIndexOf('assistant');
    chat.forEach((m, i) => log.appendChild(msgEl(m, i === lastAssistant)));
  }
  const sug = $('chat-suggestions'); sug.innerHTML = '';
  if (chat.length) (suggestions || []).forEach((s) => sug.appendChild(suggestionChip(s)));
  renderChatContext();
  log.scrollTop = log.scrollHeight;
}

// Notion-style context visibility: show what the partner is working from.
function renderChatContext() {
  const host = $('chat-context'); if (!host) return;
  const p = (session && session.pins) || {};
  const chips = [];
  if (p.persona) chips.push('👤 ' + personaName(p.persona));
  if (p.pain) chips.push('💢 ' + painLabel(p.pain));
  if (p.awarenessStage) chips.push('🧭 ' + stageName(p.awarenessStage));
  if (p.format) chips.push('🖼 ' + p.format);
  if (p.tagline) chips.push('✍ tagline');
  if (p.visualIdea) chips.push('🎬 visual');
  const extras = ['angle', 'mechanic', 'hookTactic', 'cta', 'product', 'notes'].filter((k) => p[k]).length
    + ((p.insights || []).length ? 1 : 0) + ((p.constraints || []).length ? 1 : 0);
  host.innerHTML = '';
  const label = document.createElement('span'); label.className = 'ctx-label';
  label.textContent = chips.length || extras ? 'Context — your Brief:' : 'Context: nothing pinned — I choose freely';
  host.appendChild(label);
  chips.slice(0, 4).forEach((t) => { const s = document.createElement('span'); s.className = 'ctx-chip'; s.textContent = t; host.appendChild(s); });
  const more = Math.max(0, chips.length - 4) + extras;
  if (more) { const s = document.createElement('span'); s.className = 'ctx-chip'; s.textContent = `+${more} more`; host.appendChild(s); }
  host.title = 'Open the Brief';
  host.onclick = () => { const b = $('brief'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
}

function appendMsg(role, text) {
  const log = $('chat-log'); const empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
  const d = document.createElement('div'); d.className = 'msg ' + role; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
function thinkingEl() {
  const log = $('chat-log'); const empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
  const d = document.createElement('div'); d.className = 'msg assistant pending';
  d.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span class="pending-label">thinking…</span>';
  log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}

function autoGrowChat() {
  const t = $('chat-input');
  t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  syncChatSend();
}
function syncChatSend() {
  const btn = $('chat-send');
  if (chatCtl) { btn.textContent = '◼ Stop'; btn.classList.add('stop'); btn.disabled = false; return; }
  btn.textContent = 'Send'; btn.classList.remove('stop');
  btn.disabled = !$('chat-input').value.trim();
}

// ---------- chat rail (collapsible copilot) ----------
function railCollapsed() { return $('game').classList.contains('rail-collapsed'); }
function setRail(open, { focus = false } = {}) {
  $('game').classList.toggle('rail-collapsed', !open);
  try { localStorage.setItem('cf.railOpen', open ? '1' : '0'); } catch { /* private mode */ }
  if (open) { $('rail-dot').hidden = true; if (focus) $('chat-input').focus(); }
}
function initRail() {
  let open = true;
  try { open = localStorage.getItem('cf.railOpen') !== '0'; } catch { /* private mode */ }
  setRail(open);
}

let chatCtl = null;
async function sendChat(retry = false) {
  const input = $('chat-input');
  if (chatCtl) { chatCtl.abort(); return; } // button doubles as Stop while pending
  const text = retry ? null : input.value.trim();
  if (!retry && !text) return;
  if (!retry) { input.value = ''; autoGrowChat(); appendMsg('user', text); }
  const pending = thinkingEl();
  chatCtl = new AbortController(); syncChatSend();
  try {
    const data = await callWithSession('POST', '/api/chat',
      () => (retry ? { sessionId: session.id, retry: true } : { sessionId: session.id, message: text }),
      { signal: chatCtl.signal });
    session = data.session; suggestions = data.suggestions || suggestions;
    render(); renderChat();
    if (railCollapsed()) $('rail-dot').hidden = false; // reply arrived while rail closed
    if (data.cards && data.cards.length) toast(`${data.cards.length} concept(s) added to the board`);
  } catch (e) {
    pending.remove();
    if (e && e.aborted) {
      if (!retry && text) { input.value = text; autoGrowChat(); } // give the draft back
      toast('Stopped');
    } else toast(e.message, true);
  } finally { chatCtl = null; syncChatSend(); }
}

// ---------- board ----------
function renderBoard() {
  const host = $('board'); host.innerHTML = '';
  const board = session.board || [];
  $('board-status').textContent = board.length ? `${board.length} concept(s)` : '';
  if (!board.length) { host.innerHTML = '<div class="feed-empty" style="grid-column:1/-1">No concepts yet — set your Brief above and hit <b>⚡ Generate</b>, or ask the partner on the right.</div>'; return; }
  board.forEach((c) => host.appendChild(cardEl(c)));
}

function axesEl(s) {
  const axes = [['Truth', s.productTruth], ['Emotion', s.emotionalTruth], ['Specific', s.specificity], ['Concrete', s.concreteness], ['Scroll', s.scrollStop], ['Voice', s.brandVoice]];
  const wrap = document.createElement('div'); wrap.className = 'axes';
  axes.forEach(([label, v]) => { const a = document.createElement('div'); a.className = 'axis'; a.innerHTML = `<div class="abar"><span style="width:${v}%;background:${barColor(v)}"></span></div><div class="alabel">${label}</div>`; wrap.appendChild(a); });
  return wrap;
}

function cardEl(card) {
  const el = document.createElement('div'); el.className = 'card'; el.dataset.id = card.id;
  const s = card.scores || {}; const d = card.dna || {};
  const hasSel = () => window.getSelection().toString().trim().length > 0;
  // card.concept and card.primaryText stay on the data (finalize/build use them) but
  // aren't shown: the visual block covers the concept, the tagline covers the copy line.
  el.innerHTML = `
    <button class="card-x" title="Discard this concept">✕</button>
    <div class="tagline" title="click to add to your Brief">${esc(card.tagline)}</div>
    ${card.emotionalInsight ? `<div class="insight-line" title="the raw human truth this ad is built on">🫀 ${esc(card.emotionalInsight)}</div>` : ''}
    <div class="angle" title="click to add this angle to your Brief">“${esc(card.messagingAngle)}”</div>
    ${card.visualIdea ? `<div class="visual" title="click to add this visual to your Brief"><b>🎬 </b>${esc(card.visualIdea)}</div>` : ''}
    ${card.cta ? `<div class="cta" title="click to add this CTA to your Brief"><b>📣 CTA:</b> ${esc(card.cta)}</div>` : ''}
    <div class="dna">
      <span class="tag stage" data-k="awarenessStage" data-v="${esc(d.awarenessStage)}">${esc(stageName(d.awarenessStage))}</span>
      <span class="tag mech" data-k="mechanic" data-v="${esc(d.mechanic)}">${esc(d.mechanic)}</span>
      <span class="tag fmt" data-k="format" data-v="${esc(d.format)}">${esc(d.format)}</span>
      <span class="tag" data-k="hookTactic" data-v="${esc(d.hookTactic || '')}">${esc(d.hookTactic || d.trigger || '')}</span>
      <span class="tag" data-k="persona" data-v="${esc(d.persona)}">🎯 ${esc(personaName(d.persona))}</span>
      <span class="tag" data-k="pain" data-v="${esc(d.pain)}">💢 ${esc(painLabel(d.pain))}</span>
    </div>
    <button class="pin-row" title="Copy this concept's setup into the Brief">📌 Pin Parameters</button>
    <div class="meter">
      <div class="meter-top" title="click to see the score breakdown"><span>Quality score</span><span class="meter-right"><span class="meter-score" style="color:${barColor(s.overall || 0)}">${s.overall ?? '–'}</span>${s.productTruth != null || s.note ? '<span class="meter-chevron">▾</span>' : ''}</span></div>
      <div class="bar"><span style="width:${s.overall || 0}%;background:${barColor(s.overall || 0)}"></span></div>
    </div>
  `;
  // Score breakdown (axes + judge's note) collapsed behind the score row — click to toggle.
  if (s.productTruth != null || s.note) {
    const detail = document.createElement('div'); detail.className = 'meter-detail'; detail.hidden = true;
    if (s.productTruth != null) detail.appendChild(axesEl(s));
    if (s.note) { const note = document.createElement('div'); note.className = 'judge-note'; note.textContent = `🧑‍⚖️ ${s.note}`; detail.appendChild(note); }
    el.querySelector('.meter').appendChild(detail);
    el.querySelector('.meter-top').addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      const ch = el.querySelector('.meter-chevron'); if (ch) ch.textContent = detail.hidden ? '▾' : '▴';
    });
  }

  // click a part to add it to the Brief (skipped while selecting text to comment)
  el.querySelector('.tagline').addEventListener('click', () => { if (!hasSel()) pinPart('tagline', card.tagline); });
  el.querySelector('.angle').addEventListener('click', () => { if (!hasSel()) pinPart('angle', card.messagingAngle); });
  const vis = el.querySelector('.visual'); if (vis) vis.addEventListener('click', () => { if (!hasSel()) pinPart('visualIdea', card.visualIdea); });
  const ctaEl = el.querySelector('.cta'); if (ctaEl) ctaEl.addEventListener('click', () => { if (!hasSel()) pinPart('cta', card.cta); });
  el.querySelectorAll('.dna .tag').forEach((t) => t.addEventListener('click', () => { if (!hasSel() && t.dataset.v) pinPart(t.dataset.k, t.dataset.v); }));

  el.querySelector('.card-x').addEventListener('click', () => discard(card));
  el.querySelector('.pin-row').addEventListener('click', () => pinFrame(card));

  const actions = document.createElement('div'); actions.className = 'card-actions';
  const variants = document.createElement('button'); variants.className = 'variants'; variants.textContent = '🧬 Make variants';
  variants.title = 'Generate 3 variations of this concept';
  const crown = document.createElement('button'); crown.className = 'crown'; crown.textContent = '★ Finalize'; crown.setAttribute('data-glow', '');
  if (streaming) { variants.disabled = true; crown.disabled = true; } // mid-stream cards act after the run settles
  variants.addEventListener('click', () => makeVariants(card, variants));
  crown.addEventListener('click', () => openChampion(card));
  actions.append(variants, crown); el.appendChild(actions);

  // inline comments + regenerate (select any copy on the card)
  const cmts = cardComments[card.id] || [];
  if (cmts.length) {
    applyCommentMarkers(el, cmts, CARD_COMMENTABLE);
    el.appendChild(commentsEl(cmts, () => { renderBoard(); }, card.id, cardComments));
    const regen = document.createElement('button'); regen.className = 'regen-btn';
    regen.textContent = `↻ Regenerate with ${cmts.length} comment${cmts.length > 1 ? 's' : ''}`;
    regen.addEventListener('click', () => refineCardUI(card));
    el.appendChild(regen);
  } else {
    const hint = document.createElement('div'); hint.className = 'hint-select'; hint.textContent = '✎ select any copy above to comment & regenerate';
    el.appendChild(hint);
  }

  return el;
}

// shared comment-list renderer (board + finalize modal)
function commentsEl(cmts, rerender, id, store) {
  const cwrap = document.createElement('div'); cwrap.className = 'comments';
  cmts.forEach((cm, idx) => {
    const it = document.createElement('div'); it.className = 'comment-item';
    it.innerHTML = `<span class="crm" title="remove">✕</span><span class="cnum">${idx + 1}</span><span class="cq">“${esc(cm.quote.length > 60 ? cm.quote.slice(0, 60) + '…' : cm.quote)}”</span> <span class="cc">${esc(cm.comment)}</span>`;
    it.querySelector('.crm').addEventListener('click', () => { cmts.splice(idx, 1); if (!cmts.length) delete store[id]; rerender(); });
    cwrap.appendChild(it);
  });
  return cwrap;
}

async function discard(card) {
  try { const data = await callWithSession('POST', '/api/react', () => ({ sessionId: session.id, card, keep: false })); session = data.session; render(); }
  catch (e) { toast(e.message, true); }
}

// 3 fresh variations of one concept — same machinery as breeding, seeded by this card.
// Pending state lives on the button itself; the feed keeps working underneath.
async function makeVariants(card, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '🧬 Making variants…'; btn.classList.add('working'); }
  try {
    const data = await callWithSession('POST', '/api/breed', () => ({ sessionId: session.id, parents: [card], loadout: { count: 3 } }));
    session = data.session; render();
    $('board-status').textContent = statusLine(data.stats);
    if (data.stats && data.stats.passed === 0) toast('No variants cleared the quality bar — try again.', true);
    else toast('🧬 Variants added to the board');
  } catch (e) {
    handleErr(e);
    if (btn) { btn.disabled = false; btn.textContent = '🧬 Make variants'; btn.classList.remove('working'); }
  }
}

// ---------- Brief (assembly chain) ----------
const SLOT_HELP = {
  persona: "Who you're talking to — the target customer.",
  pain: "The core problem or desire the ad speaks to.",
  awarenessStage: "How aware the viewer is — from unaware to ready-to-buy.",
  angle: "The core truth/message the ad expresses.",
  mechanic: "The creative move that makes the point land.",
  format: "The type/structure of the static ad.",
  hookTactic: "How the opening line is framed.",
  tagline: "A line you want the concepts built around.",
  visualIdea: "A specific visual/scene you want.",
  cta: "The action you want the viewer to take — or 'No CTA' for top-of-funnel.",
  product: "Whether the product itself should appear in the image.",
  notes: "Any extra direction for the concepts.",
};
const BRIEF_GROUPS = [
  { label: 'Target', keys: ['persona', 'pain', 'awarenessStage'] },
  { label: 'Creative — optional', keys: ['angle', 'mechanic', 'format', 'hookTactic', 'tagline', 'visualIdea', 'cta', 'product', 'notes'] },
];
const WIDE_SLOTS = new Set(['angle', 'tagline', 'visualIdea', 'notes']);

function chainSlots() {
  const opt = (v, l) => ({ value: v, label: l });
  return [
    { key: 'persona', label: 'Persona', type: 'select', options: (deck.personas || []).map((p) => opt(p.id, p.name)) },
    { key: 'pain', label: 'Pain / desire', type: 'select', options: (deck.pains || []).map((p) => opt(p.id, p.label)) },
    { key: 'awarenessStage', label: 'Awareness stage', type: 'select', options: (TAX.stages || []).map((s) => opt(s.id, s.name)) },
    { key: 'angle', label: 'Angle', type: 'text' },
    { key: 'mechanic', label: 'Mechanic', type: 'select', options: (TAX.mechanics || []).map((m) => opt(m.name, m.name)) },
    { key: 'format', label: 'Visual format', type: 'select', options: (TAX.formats || []).map((f) => opt(f.name, f.name)) },
    { key: 'hookTactic', label: 'Hook tactic', type: 'select', options: (TAX.hookTactics || []).map((t) => opt(t, t)) },
    { key: 'tagline', label: 'Seed tagline', type: 'text' },
    { key: 'visualIdea', label: 'Visual idea', type: 'text' },
    { key: 'cta', label: 'Call to action', type: 'select', options: [opt('none', 'No CTA')].concat((TAX.ctaOptions || []).map((c) => opt(c, c))) },
    { key: 'product', label: 'Product in image', type: 'select', options: [opt('show', 'Show product'), opt('hide', "Don't show product")] },
    { key: 'notes', label: 'Notes', type: 'text' },
  ];
}
function displayPin(key, val) {
  if (key === 'persona') return personaName(val);
  if (key === 'pain') return painLabel(val);
  if (key === 'awarenessStage') return stageName(val);
  return val;
}
function infoIcon(key) { return `<span class="seg-info" title="${esc(SLOT_HELP[key] || '')}">i</span>`; }

function buildSeg(slot, pins) {
  const pinned = pins[slot.key] != null && pins[slot.key] !== '';
  const seg = document.createElement('div');
  seg.className = 'brief-seg' + (WIDE_SLOTS.has(slot.key) ? ' wide' : '') + (pinned ? ' pinned' : '');
  const label = document.createElement('div'); label.className = 'seg-label';
  label.innerHTML = `${esc(slot.label)} ${infoIcon(slot.key)}`;
  seg.appendChild(label);
  if (slot.type === 'select') {
    const sel = document.createElement('select');
    const open = document.createElement('option'); open.value = ''; open.textContent = '— any —'; sel.appendChild(open);
    slot.options.forEach((o) => { const el = document.createElement('option'); el.value = o.value; el.textContent = o.label; sel.appendChild(el); });
    sel.value = pins[slot.key] || '';
    sel.addEventListener('change', () => savePins({ [slot.key]: sel.value }));
    seg.appendChild(sel);
  } else {
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'optional…'; inp.value = pins[slot.key] || '';
    inp.addEventListener('change', () => savePins({ [slot.key]: inp.value.trim() }));
    seg.appendChild(inp);
  }
  return seg;
}

function chipTray(items, activeIds, getId, getLabel, getTitle, onToggle) {
  const tray = document.createElement('div'); tray.className = 'chip-tray';
  items.forEach((it) => {
    const id = getId(it);
    const chip = document.createElement('button');
    chip.className = 'chip' + (activeIds.includes(id) ? ' active' : '');
    chip.textContent = getLabel(it); chip.title = getTitle(it);
    chip.addEventListener('click', () => onToggle(id));
    tray.appendChild(chip);
  });
  return tray;
}

// ---------- composer (compact Brief with progressive disclosure) ----------
const ui = { leversOpen: false, extrasOpen: false };
const TARGET_KEYS = ['persona', 'pain', 'awarenessStage'];
const LEVER_KEYS = ['angle', 'mechanic', 'format', 'hookTactic', 'tagline', 'visualIdea', 'cta', 'product', 'notes'];

function renderChain() {
  const pins = session.pins || {};
  const byKey = Object.fromEntries(chainSlots().map((s) => [s.key, s]));
  renderComposerRow(byKey, pins);
  renderLevers(byKey, pins);
  renderExtras(pins);
  renderComposerMeta(byKey, pins);
  syncDisclosures(pins);
}

function renderComposerRow(byKey, pins) {
  const host = $('composer-targets'); host.innerHTML = '';
  TARGET_KEYS.forEach((k) => { if (byKey[k]) host.appendChild(buildSeg(byKey[k], pins)); });
}

function renderLevers(byKey, pins) {
  const host = $('levers-panel'); host.innerHTML = '';
  LEVER_KEYS.forEach((k) => { if (byKey[k]) host.appendChild(buildSeg(byKey[k], pins)); });
}

function renderExtras(pins) {
  const host = $('extras-drawer'); host.innerHTML = '';
  // constraints
  const cg = document.createElement('div'); cg.className = 'brief-toggle-group';
  cg.innerHTML = '<div class="tg-label">Constraints <span class="seg-info" title="Optional rules that force novelty (e.g. ≤6 words, as a confession).">i</span></div>';
  cg.appendChild(chipTray(TAX.constraintCards || [], pins.constraints || [], (c) => c.id, (c) => c.label, (c) => c.instruction, (id) => {
    const cur = (session.pins.constraints || []).slice(); const i = cur.indexOf(id); if (i === -1) cur.push(id); else cur.splice(i, 1); savePins({ constraints: cur });
  }));
  host.appendChild(cg);
  // conversion enhancers (badges on the exported image)
  const eg = document.createElement('div'); eg.className = 'brief-toggle-group';
  eg.innerHTML = '<div class="tg-label">Conversion enhancers <span class="seg-info" title="Integrated into the exported image in the form that fits the composition — a badge cluster, icon+text, a seal, a strip, or short trust text. Never woven into the copy.">i</span></div>';
  eg.appendChild(chipTray(TAX.conversionEnhancers || [], pins.enhancers || [], (e) => e.id, (e) => e.label, () => 'Integrated into the exported image, placed to fit the composition', (id) => {
    const cur = (session.pins.enhancers || []).slice(); const i = cur.indexOf(id); if (i === -1) cur.push(id); else cur.splice(i, 1); savePins({ enhancers: cur });
  }));
  host.appendChild(eg);
  // human-insight mining (the emotional core)
  const ig = document.createElement('div'); ig.className = 'brief-toggle-group insight-group';
  const igLabel = document.createElement('div'); igLabel.className = 'tg-label';
  igLabel.innerHTML = 'Human insights <span class="seg-info" title="Imagine this persona’s inner life and surface the raw, unspoken truths (envy, shame, fear, grief). Pick the truest 3–4 to build ads on.">i</span> ';
  const mineBtn = document.createElement('button'); mineBtn.className = 'ghost-btn mine-btn'; mineBtn.id = 'mine-btn';
  mineBtn.textContent = '🔍 Mine insights';
  mineBtn.addEventListener('click', mineInsightsUI);
  igLabel.appendChild(mineBtn);
  ig.appendChild(igLabel);
  const mined = currentInsights();
  if (mined.length) {
    const activeIds = (pins.insights || []).map((i) => i.id);
    ig.appendChild(chipTray(
      mined, activeIds,
      (i) => i.id,
      (i) => `${insightEmoji(i.emotion)} ${truncate(i.tension, 42)}`,
      (i) => `${i.emotion || ''}: ${i.tension}\n\nstings when: ${i.momentItStings || ''}\n\n${i.whyItsTrue || ''}`,
      (id) => toggleInsight(id, mined),
    ));
  } else {
    const hint = document.createElement('div'); hint.className = 'insight-hint';
    hint.textContent = pins.persona ? 'Mine insights to surface this persona’s raw truths.' : 'Pick a persona, then mine insights.';
    ig.appendChild(hint);
  }
  host.appendChild(ig);
}

// Pinned values hiding inside CLOSED sections surface as removable chips here,
// so the composer itself is always an honest summary of the Brief.
function renderComposerMeta(byKey, pins) {
  const host = $('composer-meta'); host.innerHTML = '';
  const addChip = (label, onRemove, title) => {
    const chip = document.createElement('span'); chip.className = 'meta-chip';
    const txt = document.createElement('span'); txt.textContent = label; if (title) chip.title = title;
    const x = document.createElement('button'); x.className = 'meta-x'; x.textContent = '✕'; x.title = 'Remove from Brief';
    x.addEventListener('click', onRemove);
    chip.append(txt, x); host.appendChild(chip);
  };
  if (!ui.leversOpen) {
    LEVER_KEYS.filter((k) => pins[k]).forEach((k) => {
      const slot = byKey[k];
      addChip(`${slot ? slot.label : k}: ${truncate(displayPin(k, pins[k]), 28)}`, () => savePins({ [k]: '' }), String(pins[k]));
    });
  }
  if (!ui.extrasOpen) {
    (pins.insights || []).forEach((ins) => addChip(`${insightEmoji(ins.emotion)} ${truncate(ins.tension, 26)}`, () => {
      savePins({ insights: (session.pins.insights || []).filter((x) => x.id !== ins.id) });
    }, ins.tension));
    (pins.constraints || []).forEach((id) => {
      const c = (TAX.constraintCards || []).find((x) => x.id === id);
      addChip(`⛓ ${c ? c.label : id}`, () => savePins({ constraints: (session.pins.constraints || []).filter((x) => x !== id) }), c && c.instruction);
    });
    (pins.enhancers || []).forEach((id) => {
      const e = (TAX.conversionEnhancers || []).find((x) => x.id === id);
      addChip(`🛡 ${e ? e.label : id}`, () => savePins({ enhancers: (session.pins.enhancers || []).filter((x) => x !== id) }), 'Rendered on the exported image');
    });
  }
  host.hidden = !host.children.length;
}

function syncDisclosures(pins) {
  pins = pins || session.pins || {};
  const leverCount = LEVER_KEYS.filter((k) => pins[k]).length;
  const extraCount = (pins.constraints || []).length + (pins.enhancers || []).length + (pins.insights || []).length;
  const setBtn = (btnId, cntId, open, label, count) => {
    const btn = $(btnId); const cnt = $(cntId);
    btn.childNodes[0].textContent = `${open ? '▾' : '▸'} ${label}`;
    btn.classList.toggle('open', open);
    const show = count > 0;
    if (cnt.hidden === show || cnt.textContent !== String(count)) { cnt.textContent = count; cnt.hidden = !show; if (show) { cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); } }
  };
  setBtn('levers-toggle', 'levers-count', ui.leversOpen, 'Creative levers', leverCount);
  setBtn('extras-toggle', 'extras-count', ui.extrasOpen, 'Constraints & extras', extraCount);
  $('levers-panel').hidden = !ui.leversOpen;
  $('extras-drawer').hidden = !ui.extrasOpen;
}

function toggleLevers(v) { ui.leversOpen = v == null ? !ui.leversOpen : v; renderChain(); }
function toggleExtras(v) { ui.extrasOpen = v == null ? !ui.extrasOpen : v; renderChain(); }
function closeLevers() { if (ui.leversOpen) toggleLevers(false); }
function closeExtras() { if (ui.extrasOpen) toggleExtras(false); }

const INSIGHT_EMOJI = { envy: '👀', shame: '🙈', fear: '😰', grief: '🥀', vanity: '💅', longing: '🌙', invisibility: '👻', pride: '🦚' };
function insightEmoji(e) { return INSIGHT_EMOJI[e] || '🫀'; }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Insights mined for the currently-pinned persona (+pain), from the session cache.
function currentInsights() {
  const p = session.pins || {};
  if (!p.persona) return [];
  const key = p.pain ? `${p.persona}::${p.pain}` : p.persona;
  const entry = (session.insightsCache || {})[key];
  return (entry && entry.insights) || [];
}

async function mineInsightsUI() {
  const p = session.pins || {};
  if (!p.persona) { toast('Pick a persona first — insights are mined for one person.', true); return; }
  showLoader('Imagining her inner life…');
  try {
    const data = await callWithSession('POST', '/api/insights', () => ({ sessionId: session.id, persona: p.persona, pain: p.pain || '' }));
    session = data.session;
    renderChain();
    toast(data.cached ? 'Loaded mined insights' : `Surfaced ${(data.insights || []).length} human truths`);
  } catch (e) { handleErr(e); } finally { hideLoader(); }
}

function toggleInsight(id, mined) {
  const cur = (session.pins.insights || []).slice();
  const i = cur.findIndex((x) => x.id === id);
  if (i === -1) {
    if (cur.length >= 4) { toast('Pick up to 4 — the truest ones.', true); return; }
    const obj = mined.find((x) => x.id === id);
    if (obj) cur.push(obj);
  } else {
    cur.splice(i, 1);
  }
  savePins({ insights: cur });
}

let pinsSaving = Promise.resolve(); // Enter-to-generate awaits the in-flight pin save
async function savePins(partial) {
  const p = (async () => {
    try { const data = await api('POST', '/api/pins', { sessionId: session.id, pins: partial }); session = data.session; renderChain(); }
    catch (e) { if (isSessionErr(e)) { await recreateSession(); } else toast(e.message, true); }
  })();
  pinsSaving = p;
  return p;
}
function pinPart(key, value) { savePins({ [key]: value }); toast(`Added to Brief · ${key}: ${displayPin(key, value)}`); }
function pinFrame(card) {
  const d = card.dna || {};
  savePins({ persona: d.persona, pain: d.pain, awarenessStage: d.awarenessStage, mechanic: d.mechanic, format: d.format, angle: card.messagingAngle });
  toast('Copied this setup into your Brief — Generate or ask the partner to iterate');
}

// ---------- generate / surprise / variations ----------
// In-feed loading experience: shimmer skeletons stand in for arriving concepts,
// a slim gradient progress bar + rotating messages live in the feed header.
const LOADING_MSGS = [
  'Forging concepts on the anvil…',
  'Judging every draft against the quality bar…',
  'Hunting for the raw human truth…',
  'Sharpening taglines until they stop thumbs…',
  'Sketching the scene for each idea…',
];
let feedLoadTimer = null;
function startFeedLoading(board, count) {
  const status = $('board-status');
  status.innerHTML = '<span class="feed-progress"><span></span></span><span id="feed-msg" class="feed-msg"></span>';
  let i = 0; $('feed-msg').textContent = LOADING_MSGS[0];
  feedLoadTimer = setInterval(() => {
    const m = $('feed-msg'); if (!m) return;
    i = (i + 1) % LOADING_MSGS.length;
    m.style.opacity = 0;
    setTimeout(() => { m.textContent = LOADING_MSGS[i]; m.style.opacity = 1; }, 300);
  }, 4500);
  const empty = board.querySelector('.feed-empty'); if (empty) empty.remove();
  for (let k = 0; k < count; k++) {
    const sk = document.createElement('div'); sk.className = 'card skeleton'; sk.style.animationDelay = `${k * 60}ms`;
    sk.innerHTML = '<div class="sk-line w60"></div><div class="sk-line w90"></div><div class="sk-line w80"></div><div class="sk-block"></div><div class="sk-line w70"></div>';
    board.appendChild(sk);
  }
}
function placeCardInSkeleton(board, el) {
  const sk = board.querySelector('.card.skeleton');
  if (sk) board.replaceChild(el, sk); else board.appendChild(el);
}
function clearFeedLoading(board) {
  if (feedLoadTimer) { clearInterval(feedLoadTimer); feedLoadTimer = null; }
  board.querySelectorAll('.card.skeleton').forEach((s) => s.remove());
}

let streaming = false;
async function deal() {
  if (streaming) return;
  streaming = true; $('deal-btn').disabled = true;
  setFeedView('board');
  const board = $('board');
  startFeedLoading(board, toolbar.count);
  let sawCard = false;

  // One streamed run: cards arrive as NDJSON lines and render the moment they pass.
  const runStream = async () => {
    const res = await fetch('/api/deal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, loadout: { count: toolbar.count, medium: toolbar.medium }, stream: true }),
      signal: AbortSignal.timeout(240000),
    });
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      const err = new Error(d.error || `Request failed (${res.status})`); err.code = d.code; throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'card') {
          if (!sawCard) { sawCard = true; closeLevers(); closeExtras(); }
          placeCardInSkeleton(board, cardEl(msg.card));
        } else if (msg.type === 'done') {
          clearFeedLoading(board); // leftovers out BEFORE the authoritative re-render
          session = msg.session; render(); // reconciles order + accumulates
          $('board-status').textContent = statusLine(msg.stats);
          if (msg.stats && msg.stats.passed === 0) toast('No concepts cleared the quality bar — try loosening the brief (fewer constraints, allow the product, or a different persona/pain).', true);
        } else if (msg.type === 'error') {
          throw new Error(msg.error || 'Generation failed');
        }
      }
    }
  };

  try {
    await runStream();
  } catch (e) {
    // Stale session (server restarted) → recreate once and retry, but only if nothing rendered yet.
    if (isSessionErr(e) && !sawCard) { try { await recreateSession(); await runStream(); } catch (e2) { handleErr(e2); } }
    else handleErr(e);
  } finally {
    clearFeedLoading(board); streaming = false; $('deal-btn').disabled = false;
    const stats = $('board-status').textContent; // keep the pass/fail line through the re-render
    render();
    if (stats && !stats.includes('concept(s)')) $('board-status').textContent = stats;
  }
}
function spin() {
  const roll = {};
  ['mechanic', 'format', 'hookTactic'].forEach((key) => {
    if (key === 'mechanic') roll[key] = randOf(TAX.mechanics).name;
    else if (key === 'hookTactic') roll[key] = randOf(TAX.hookTactics);
    else { const pool = TAX.formats.filter(mediumOk); roll[key] = randOf(pool.length ? pool : TAX.formats).name; }
  });
  savePins(roll); toast('✨ Filled the open creative choices — hit Generate');
}
function statusLine(stats) { return stats ? `${stats.passed} passed the quality check of ${stats.generated} generated` : ''; }
function handleErr(e) { if (e.code === 'NO_API_KEY') toast('No API key. Add ANTHROPIC_API_KEY then restart.', true); else toast(e.message, true); }

// ---------- finalize (champion) ----------
async function openChampion(card) {
  showLoader('Finalizing the concept…');
  try { const data = await callWithSession('POST', '/api/champion', () => ({ sessionId: session.id, card })); session = data.session; renderChampionModal(card, data.champion); render(); }
  catch (e) { handleErr(e); } finally { hideLoader(); }
}
function renderChampionModal(card, champ) {
  currentChampion = { card, champ };
  const body = $('champion-body');
  // Hero tagline picker: the headline + all tagline variants, de-duplicated. The
  // selected one becomes the hero headline used by the export / generated image.
  const heroOpts = [];
  const seen = new Set();
  [champ.headline, ...(champ.taglines || [])].forEach((t) => {
    const v = (t || '').trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); heroOpts.push(v); }
  });
  if (!heroOpts.length && champ.headline) heroOpts.push(champ.headline);
  const radios = heroOpts.map((t, i) =>
    `<label class="tl-opt"><input type="radio" name="hero-tagline" value="${i}"${t === champ.headline ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('');
  let hookBlock = '';
  if (champ.primaryText) hookBlock = `<h3>On-image copy</h3><div class="block">${esc(champ.primaryText)}</div>`;
  const visualText = champ.visualIdea || card.visualIdea;
  const visual = visualText ? `<h3>Visual direction</h3><div class="block">🎬 ${esc(visualText)}</div>` : '';
  const ctaBlock = card.cta ? `<h3>Call to action</h3><div class="block">📣 ${esc(card.cta)}</div>` : '';
  modalReturnFocus = document.activeElement;
  body.className = 'champ';
  body.innerHTML = `
    <h2>★ Finalized concept <svg class="check-draw" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg></h2>
    <div class="headline" id="champ-headline">${esc(champ.headline)}</div>
    <h3>Hero tagline <span class="hint-inline">— pick the one to build the ad on</span></h3>
    <div class="tagline-picker" id="tagline-picker">${radios}</div>
    <h3>Concept</h3><div class="block">${esc(champ.concept)}</div>
    ${visual}${ctaBlock}${hookBlock}
    <h3>Why it works</h3><div class="block">${esc(champ.whyItWorks)}</div>
    <h3>Compliance</h3><div class="block compliance">✓ ${esc(champ.complianceCheck)}</div>
    <div id="champ-edit"></div>
    <div class="export-row">
      <span class="model-badge">Nano Banana Pro · templated</span>
      <button class="primary-btn" id="export-btn" data-glow>Build ad from template →</button>
    </div>
    <input id="ref-input" class="ref-input" type="text" placeholder="Product reference image URL(s) for image-to-image — comma separated" value="${esc((deck.referenceImages || []).join(', '))}" />
    <div class="export-result" id="export-result"></div>`;

  // inline edit/comment on the finalized concept
  const editHost = $('champ-edit');
  const cmts = championComments[card.id] || [];
  if (cmts.length) {
    applyCommentMarkers(body, cmts, CHAMP_COMMENTABLE);
    editHost.appendChild(commentsEl(cmts, () => renderChampionModal(currentChampion.card, currentChampion.champ), card.id, championComments));
    const regen = document.createElement('button'); regen.className = 'regen-btn';
    regen.textContent = `↻ Regenerate finalized concept (${cmts.length})`;
    regen.addEventListener('click', () => refineChampionUI(card, champ));
    editHost.appendChild(regen);
  } else {
    const hint = document.createElement('div'); hint.className = 'hint-select'; hint.textContent = '✎ select any copy above to comment & regenerate this concept';
    editHost.appendChild(hint);
  }

  // Switching the hero tagline updates the headline used everywhere downstream (export → image).
  const picker = $('tagline-picker');
  if (picker) picker.addEventListener('change', (e) => {
    const idx = Number(e.target.value);
    const val = heroOpts[idx];
    if (val == null) return;
    currentChampion.champ.headline = val;
    const h = $('champ-headline'); if (h) h.textContent = val;
    // If the ad was already built, the prompt used the old hero — mark it stale until rebuilt.
    const exResult = $('export-result');
    if (exResult && exResult.innerHTML.trim()) {
      toast('Hero tagline changed — rebuild the ad to use it.');
      let stale = $('stale-prompt-warn');
      if (!stale) {
        stale = document.createElement('div');
        stale.id = 'stale-prompt-warn';
        stale.className = 'ex-warn';
        exResult.prepend(stale);
      }
      stale.textContent = '⚠ Hero tagline changed — this prompt was built with the previous line. Click “Build ad from template →” to rebuild before generating.';
    }
  });

  $('export-btn').addEventListener('click', () => exportConcept(card, currentChampion.champ));
  $('champion-modal').hidden = false;
}
async function refineChampionUI(card, champ) {
  const comments = championComments[card.id] || [];
  if (!comments.length) return;
  showLoader('Regenerating the finalized concept…');
  try {
    const data = await callWithSession('POST', '/api/refine-champion', () => ({ sessionId: session.id, card, champion: champ, comments }));
    session = data.session; delete championComments[card.id];
    renderChampionModal(card, data.champion); render();
    toast('↻ Finalized concept updated from your comments');
  } catch (e) { handleErr(e); } finally { hideLoader(); }
}
let AD_TEMPLATES = null;
async function ensureTemplates() {
  if (AD_TEMPLATES) return AD_TEMPLATES;
  try { const d = await api('GET', '/api/templates'); AD_TEMPLATES = d.templates || []; }
  catch { AD_TEMPLATES = []; }
  return AD_TEMPLATES;
}

async function exportConcept(card, champ, templateNumber = null) {
  const referenceImages = ($('ref-input') ? $('ref-input').value : '').split(',').map((s) => s.trim()).filter(Boolean);
  showLoader(templateNumber === 'freeform' ? 'Composing the ad around your concept — no template…'
    : templateNumber ? 'Rebuilding the ad from the chosen template…' : 'Filling the ad template with your concept…');
  try {
    const data = await callWithSession('POST', '/api/export', () => ({ sessionId: session.id, card, champion: champ, referenceImages, templateNumber }));
    renderExportResult(data, card, champ);
  } catch (e) { toast(e.message, true); } finally { hideLoader(); }
}

function renderExportResult(data, card, champ) {
  const rec = data.record || {};
  const s = rec.settings || {};
  const tpl = rec.template || {};
  const zones = (rec.text_zones || []).map((z) => `${esc(z.element)} @ ${esc(z.position)}: “${esc(z.text)}”`).join('<br>');
  const refs = rec.reference_images || [];
  const badges = rec.enhancers || [];
  $('export-result').innerHTML = `
    <div class="tpl-box">
      ${tpl.preview_image_url ? `<img class="tpl-thumb" src="${esc(tpl.preview_image_url)}" alt="template preview" />` : '<div class="tpl-thumb tpl-thumb-empty">no preview</div>'}
      <div class="tpl-info">
        <div class="tpl-name">${tpl.number == null ? `✍ ${esc(tpl.name || 'Concept-first (no template)')}` : `Template #${esc(String(tpl.number))} · ${esc(tpl.name || '')}`} ${tpl.auto_suggested ? '<span class="tpl-auto">auto-matched</span>' : '<span class="tpl-manual">your pick</span>'}</div>
        <div class="tpl-cat">${esc(tpl.category || '')} · ${esc(tpl.aspect_ratio || s.aspect_ratio || '')}</div>
        <label class="ex-label" for="tpl-sel">Swap layout template <span id="tpl-count" class="tpl-count"></span></label>
        <select id="tpl-sel"><option>loading templates…</option></select>
        <label class="tpl-all-label"><input type="checkbox" id="tpl-all" /> show all templates</label>
      </div>
    </div>
    <div class="ex-meta">${esc(rec.format || '')} · ${esc(s.aspect_ratio || '')} · ${esc(s.model || '')}</div>
    ${(rec.warnings || []).map((w) => `<div class="ex-warn">⚠ ${esc(w)}</div>`).join('')}
    <label class="ex-label">Final prompt (auto-sent to Nano Banana Pro)</label>
    <textarea class="ex-prompt" id="ex-prompt" readonly>${esc(rec.prompt || '')}</textarea>
    <div class="gen-row">
      <button class="ghost-btn" id="ex-copy">📋 Copy prompt</button>
      <select id="gen-resolution"><option value="1K">1K (fast)</option><option value="2K" selected>2K</option><option value="4K">4K</option></select>
      <button class="primary-btn" id="gen-image-btn" data-glow>🎨 Generate image →</button>
    </div>
    <div id="gen-image-result"></div>
    <label class="ex-label">Negative prompt (folded into the “Avoid:” line)</label>
    <div class="ex-box">${esc(rec.negative_prompt || '')}</div>
    ${badges.length ? `<label class="ex-label">Trust elements woven into the layout</label><div class="ex-box">${badges.map(esc).join(' · ')}</div>` : ''}
    ${zones ? `<label class="ex-label">Copy placed in the ad</label><div class="ex-box">${zones}</div>` : ''}
    ${refs.length ? `<label class="ex-label">Reference images (used for image-to-image)</label><div class="ex-box">${refs.map(esc).join('<br>')}</div>` : '<div class="ex-warn">⚠ No product reference image — paste product photo URL(s) above and re-export for accurate product fidelity.</div>'}
    ${data.error ? `<div class="ex-warn">⚠ ${esc(data.error)}</div>` : ''}
  `;
  const copyBtn = $('ex-copy');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const t = $('ex-prompt'); t.select();
    const done = () => toast('Prompt copied');
    if (navigator.clipboard) navigator.clipboard.writeText(rec.prompt || '').then(done).catch(() => { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  });
  $('gen-image-btn').addEventListener('click', () => generateImageUI(rec, refs));

  // Populate the template picker — auto-limited to the best matches for THIS concept
  // (by brief category + tagline/copy overlap), with a "show all" toggle. Override → re-export.
  const SHORTLIST = 15;
  ensureTemplates().then((tpls) => {
    const sel = $('tpl-sel');
    if (!sel) return;
    if (!tpls.length) { sel.innerHTML = '<option>no templates available</option>'; sel.disabled = true; return; }
    const ranked = rankTemplatesForConcept(card, rec, tpls);
    const isFreeform = tpl.number == null;
    const needsPerson = sceneNeedsPerson((rec._concept_forge && rec._concept_forge.visualIdea) || card.visualIdea);
    const freeformOpt = `<option value="freeform"${isFreeform ? ' selected' : ''}>✍ Concept-first — compose from the concept (no template)</option>`;
    const flagsFor = (t) => {
      const f = [];
      if (needsPerson && t.people_ok === false) f.push('🚫 product-only');
      if (t.has_headline_slot === false) f.push('⚠ no headline slot');
      return f.length ? ` — ${f.join(' · ')}` : '';
    };
    const optHtml = (t) => `<option value="${t.number}"${!isFreeform && t.number === tpl.number ? ' selected' : ''}>#${t.number} ${esc(t.name)} (${esc(t.aspect_ratio)})${flagsFor(t)}</option>`;
    const populate = (showAll) => {
      if (showAll) {
        const byCat = {};
        tpls.forEach((t) => { (byCat[t.category] = byCat[t.category] || []).push(t); });
        sel.innerHTML = freeformOpt + Object.keys(byCat).sort().map((cat) =>
          `<optgroup label="${esc(cat)}">` + byCat[cat].sort((a, b) => a.number - b.number).map(optHtml).join('') + '</optgroup>').join('');
      } else {
        let top = ranked.slice(0, SHORTLIST);
        if (!isFreeform && !top.some((t) => t.number === tpl.number)) { const cur = tpls.find((t) => t.number === tpl.number); if (cur) top = [cur, ...top]; }
        sel.innerHTML = freeformOpt + `<optgroup label="★ Best matches for this concept">` + top.map(optHtml).join('') + '</optgroup>';
      }
      const cnt = $('tpl-count');
      if (cnt) cnt.textContent = showAll ? `(all ${tpls.length})` : `(${Math.min(SHORTLIST, ranked.length)} best of ${tpls.length})`;
    };
    const allCb = $('tpl-all');
    populate(allCb && allCb.checked);
    if (allCb) allCb.addEventListener('change', () => populate(allCb.checked));
    sel.addEventListener('change', () => {
      if (!card || !champ) return;
      if (sel.value === 'freeform') { if (tpl.number != null) exportConcept(card, champ, 'freeform'); return; }
      const num = Number(sel.value);
      if (num && num !== tpl.number) exportConcept(card, champ, num);
    });
  });
}

// Does the concept's visual scene feature a human? (mirror of server-side check)
function sceneNeedsPerson(sceneText) {
  return /\b(woman|man|person|people|she|her|he|his|face|hands?|arms?|shoulder|legs?|skin|model|selfie|wearing|applying)\b/.test(String(sceneText || '').toLowerCase());
}

// Rank templates by fit to a concept: compatibility first (a product-only layout can
// never show the concept's person; no headline slot means the hero tagline can't land),
// then same category (from the brief), then keyword/signal overlap with the copy.
function rankTemplatesForConcept(card, rec, tpls) {
  const d = (card && card.dna) || {};
  const cat = rec && rec.template && rec.template.category;
  const scene = (rec && rec._concept_forge && rec._concept_forge.visualIdea) || card.visualIdea;
  const needsPerson = sceneNeedsPerson(scene);
  const hay = [card.tagline, card.emotionalInsight, card.messagingAngle, card.concept, card.cta, d.mechanic, d.hookTactic, d.format]
    .filter(Boolean).join(' ').toLowerCase();
  const hasNum = /\d/.test(`${card.tagline || ''} ${card.messagingAngle || ''} ${card.concept || ''}`);
  const wantTestimonial = /testimonial|review|quote|verified|["“”]|—\s*\w|\bsaid\b|\bshe told\b/.test(hay);
  const wantBeforeAfter = /before|after|used to|now i|weeks|transform|no longer/.test(hay);
  const wantText = /text|message|note|screenshot|dm|comment|search/.test(hay);
  const scored = tpls.map((t) => {
    const name = (t.name || '').toLowerCase();
    let s = 0;
    if (needsPerson && t.people_ok === false) s -= 1000;   // scene's person can never appear
    if (needsPerson && t.features_person) s += 40;
    if (t.has_headline_slot) s += 25;                       // hero tagline has a place to land
    if (cat && t.category === cat) s += 100;
    name.split(/\W+/).filter((w) => w.length > 3).forEach((w) => { if (hay.includes(w)) s += 6; });
    if (hasNum && /stat|number|result|numeral|%/.test(name)) s += 22;
    if (wantTestimonial && /testimonial|review|quote|note|screenshot/.test(name)) s += 22;
    if (wantBeforeAfter && /before|after|comparison|transform/.test(name)) s += 22;
    if (wantText && /text|message|note|screenshot|chat|comment|search|handwritten/.test(name)) s += 14;
    return { t, s };
  });
  scored.sort((a, b) => b.s - a.s || a.t.number - b.t.number);
  return scored.map((x) => x.t);
}

async function generateImageUI(rec, refs) {
  const host = $('gen-image-result');
  const btn = $('gen-image-btn');
  const resolution = $('gen-resolution').value;
  btn.disabled = true; btn.textContent = '🎨 Generating…';
  host.innerHTML = '<div class="gen-loading">Rendering with Nano Banana Pro — usually 10–30s…</div>';
  try {
    const data = await api('POST', '/api/generate-image', {
      prompt: rec.prompt,
      referenceImages: refs,
      aspectRatio: rec.settings?.aspect_ratio,
      resolution,
    });
    const img = (data.images || [])[0];
    if (!img) { host.innerHTML = '<div class="ex-warn">⚠ No image returned.</div>'; return; }
    host.innerHTML = `
      <img class="gen-image" src="${esc(img.url)}" alt="Generated ad image" />
      <div class="gen-image-actions">
        <a class="ghost-btn" href="${esc(img.url)}" target="_blank" rel="noopener">↗ Open full size</a>
        <a class="ghost-btn" href="${esc(img.url)}" download>⬇ Download</a>
        <button class="ghost-btn" id="gen-regen-btn">↻ Regenerate</button>
      </div>
      ${data.description ? `<div class="gen-image-desc">${esc(data.description)}</div>` : ''}
    `;
    $('gen-regen-btn').addEventListener('click', () => generateImageUI(rec, refs));
    toast('Image generated');
  } catch (e) {
    const netErr = /failed to fetch|networkerror|load failed/i.test(e.message || '');
    const msg = netErr
      ? "Couldn't reach the server — it may have restarted or stopped. Reload the page (Ctrl+F5); if it persists, restart the dev server (node server.js)."
      : e.message;
    host.innerHTML = `<div class="ex-warn">⚠ ${esc(msg)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '🎨 Generate image →';
  }
}

// ---------- inline comments → regenerate (board + finalized) ----------
// Only actual creative copy is commentable — never section headers, labels,
// tags, scores, buttons, or the export panel.
const CARD_COMMENTABLE = '.tagline, .insight-line, .angle, .visual, .concept, .hook, .cta';
const CHAMP_COMMENTABLE = '.champ .headline, .champ .block, .tl-opt';

function toElement(node) { return node && node.nodeType === 3 ? node.parentElement : node; }

function onTextSelect(e) {
  if (e && e.target && e.target.closest && e.target.closest('.comment-widget')) return;
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 2 || !sel.rangeCount) return;
    const a = toElement(sel.anchorNode); const b = toElement(sel.focusNode);
    if (!a || !a.closest || !b || !b.closest) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const boardCard = a.closest('#board .card');
    if (boardCard && boardCard.dataset.id) {
      // both selection endpoints must sit in the SAME commentable copy element
      const el = a.closest(CARD_COMMENTABLE);
      if (el && el === b.closest(CARD_COMMENTABLE)) showCommentWidget(boardCard.dataset.id, text, rect, 'board');
      return;
    }
    if (a.closest('#champion-body') && currentChampion) {
      if (a.closest('.export-result, .export-row, .ref-input, #champ-edit')) return;
      const el = a.closest(CHAMP_COMMENTABLE);
      if (el && el === b.closest(CHAMP_COMMENTABLE)) showCommentWidget(currentChampion.card.id, text, rect, 'champion');
    }
  }, 0);
}

// Numbered circle markers on the copy that carries each comment (rebuilt on render).
function applyCommentMarkers(rootEl, cmts, selectorList) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  cmts.forEach((cm, i) => {
    const q = norm(cm.quote);
    const el = [...rootEl.querySelectorAll(selectorList)].find((n) => norm(n.textContent).includes(q));
    if (!el) return;
    const mark = document.createElement('span'); mark.className = 'cmark'; mark.textContent = i + 1;
    mark.title = cm.comment;
    el.appendChild(mark);
  });
}
function closeCommentWidget() { if (commentWidget) { commentWidget.remove(); commentWidget = null; } }
function showCommentWidget(id, quote, rect, mode) {
  closeCommentWidget();
  const store = mode === 'champion' ? championComments : cardComments;
  const w = document.createElement('div'); w.className = 'comment-widget';
  w.innerHTML = `
    <div class="cw-quote">“${esc(quote.length > 120 ? quote.slice(0, 120) + '…' : quote)}”</div>
    <textarea placeholder="What should change about this? (e.g. make it warmer, shorter, more specific)"></textarea>
    <div class="cw-actions"><button class="ghost-btn cw-cancel">Cancel</button><button class="primary-btn cw-add">Add comment</button></div>`;
  document.body.appendChild(w);
  // fixed positioning: rect is viewport-based, so the widget lands on the
  // selection even inside the scrolled modal or a scrolled feed
  w.style.top = Math.min(rect.bottom + 6, window.innerHeight - 180) + 'px';
  w.style.left = Math.min(Math.max(rect.left, 8), window.innerWidth - 290) + 'px';
  // Keys typed in the widget must never reach page-level shortcut handlers
  // (our "/" chat shortcut, browser quick-find, space-scroll).
  w.addEventListener('keydown', (ev) => ev.stopPropagation());
  w.addEventListener('keyup', (ev) => ev.stopPropagation());
  w.addEventListener('keypress', (ev) => ev.stopPropagation());
  const ta = w.querySelector('textarea');
  ta.focus({ preventScroll: true });
  requestAnimationFrame(() => ta.focus({ preventScroll: true })); // survive the mouseup/entry-animation race
  const add = () => {
    const comment = ta.value.trim(); if (!comment) { ta.focus(); return; }
    (store[id] = store[id] || []).push({ quote, comment });
    window.getSelection().removeAllRanges(); closeCommentWidget();
    if (mode === 'champion' && currentChampion) renderChampionModal(currentChampion.card, currentChampion.champ);
    else renderBoard();
    toast('💬 Comment added — hit ↻ Regenerate');
  };
  w.querySelector('.cw-add').addEventListener('click', add);
  w.querySelector('.cw-cancel').addEventListener('click', () => { window.getSelection().removeAllRanges(); closeCommentWidget(); });
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) add(); if (ev.key === 'Escape') closeCommentWidget(); });
  commentWidget = w;
}
async function refineCardUI(card) {
  const comments = cardComments[card.id] || [];
  if (!comments.length) return;
  showLoader('Regenerating with your comments…');
  try {
    const data = await callWithSession('POST', '/api/refine', () => ({ sessionId: session.id, card, comments }));
    session = data.session; delete cardComments[card.id]; render();
    toast('↻ Concept regenerated from your comments');
  } catch (e) { handleErr(e); } finally { hideLoader(); }
}

// ---------- wire up ----------
$('start-btn').addEventListener('click', startSession);
// TAE ButtonGlowTracker (vanilla port): pointer-tracked radial glow on [data-glow]
let glowBtn = null;
document.addEventListener('pointermove', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-glow]') : null;
  if (glowBtn && glowBtn !== btn) { glowBtn.style.removeProperty('--glow-o'); glowBtn = null; }
  if (!btn) return;
  glowBtn = btn;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--gx', `${e.clientX - r.left}px`);
  btn.style.setProperty('--gy', `${e.clientY - r.top}px`);
  btn.style.setProperty('--gw', `${Math.max(r.width * 0.65, 30)}px`);
  btn.style.setProperty('--gh', `${Math.max(r.height * 1.4, 22)}px`);
  btn.style.setProperty('--glow-o', '1');
});
$('new-session-btn').addEventListener('click', () => location.reload());
$('chat-send').addEventListener('click', () => sendChat());
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('chat-input').addEventListener('input', autoGrowChat);
syncChatSend();
$('rail-toggle').addEventListener('click', () => setRail(false));
$('rail-strip').addEventListener('click', () => setRail(true, { focus: true }));
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (commentWidget) return; // never steal focus while a comment is being written
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if ($('game').hidden) return;
  e.preventDefault(); setRail(true, { focus: true });
});
initRail();
$('spin-btn').addEventListener('click', spin);
$('deal-btn').addEventListener('click', deal);
$('levers-toggle').addEventListener('click', () => toggleLevers());
$('extras-toggle').addEventListener('click', () => toggleExtras());
document.querySelectorAll('#feed-tabs .feed-tab').forEach((b) => b.addEventListener('click', () => setFeedView(b.dataset.view)));
// Enter anywhere in the composer = Generate (after committing the field being edited)
$('brief').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
  e.preventDefault();
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') e.target.dispatchEvent(new Event('change'));
  await pinsSaving;
  deal();
});
// Esc closes the topmost layer: comment widget → extras drawer → levers → champion modal
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (commentWidget) { closeCommentWidget(); return; }
  if (ui.extrasOpen) { toggleExtras(false); return; }
  if (ui.leversOpen) { toggleLevers(false); return; }
  if (!$('champion-modal').hidden) closeChampionModal();
});
let modalReturnFocus = null;
function closeChampionModal() {
  $('champion-modal').hidden = true;
  if (modalReturnFocus && modalReturnFocus.focus) { try { modalReturnFocus.focus(); } catch { /* gone */ } }
  modalReturnFocus = null;
}
$('chain-clear').addEventListener('click', () => { const cleared = { constraints: [], enhancers: [], insights: [] }; chainSlots().forEach((s) => { cleared[s.key] = ''; }); savePins(cleared); });
document.addEventListener('mouseup', onTextSelect);
document.addEventListener('mousedown', (e) => { if (commentWidget && !e.target.closest('.comment-widget')) closeCommentWidget(); });
$('champ-close').addEventListener('click', closeChampionModal);
$('champion-modal').addEventListener('click', (e) => { if (e.target.id === 'champion-modal') closeChampionModal(); });
$('count-range').addEventListener('input', (e) => { toolbar.count = Number(e.target.value); $('count-label').textContent = e.target.value; });

init();
