'use strict';

const { generateCards, breedCards, buildDiversityPlan, chunkPlan, generateForChunk } = require('./generator');
const { scoreCards } = require('./judge');

/**
 * Generate → judge → gate → refill loop. Only cards that clear the quality bar
 * are ever returned, so the player never sees weak concepts. Bounded rounds keep
 * cost predictable.
 */
async function fillToTarget(genFn, deck, target) {
  // Single round: generation is now parallel (fast), so over-generate ~2× the target
  // in one shot, judge once, and return the passers. A 2nd round only fires if the
  // whole round errored out — this halves wall-clock vs the old 2-round loop.
  const over = Math.min(target * 2 + 1, 12);
  const passing = [];
  const seenIds = new Set();
  let generated = 0;
  let rounds = 0;

  async function round(want) {
    rounds += 1;
    const raw = await genFn(want);
    generated += raw.length;
    if (!raw.length) return;
    const scored = await scoreCards({ deck, cards: raw });
    for (const card of scored) {
      if (card.gatePass && !seenIds.has(card.id)) { seenIds.add(card.id); passing.push(card); }
    }
  }

  try {
    await round(over);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[concept-forge] generation round failed:', err && err.message);
  }
  // Only retry if we got NOTHING (a fully failed round) — never just to top up.
  if (passing.length === 0) {
    try { await round(over); } catch (err) { /* eslint-disable-line no-console */ console.error('[concept-forge] retry round failed:', err && err.message); }
  }

  passing.sort((a, b) => (b.scores?.overall || 0) - (a.scores?.overall || 0));
  return {
    cards: passing.slice(0, target),
    stats: { generated, passed: passing.length, rounds },
  };
}

/**
 * Streaming deal: generate + judge each plan chunk INDEPENDENTLY and in parallel,
 * calling onCard(card) for every card that clears the gate the moment its chunk is
 * judged — so cards appear on the board progressively instead of all at once.
 */
async function dealStream({ deck, loadout, onCard }) {
  const target = Math.min(Math.max(Number(loadout.count) || 4, 1), 8);
  const over = Math.min(target * 2 + 1, 12);
  const chunks = chunkPlan(buildDiversityPlan({ ...loadout, medium: 'Static' }, over));
  let generated = 0;
  const passed = [];
  await Promise.all(chunks.map(async (chunk) => {
    let raw = [];
    try { raw = await generateForChunk({ deck, loadout, chunk }); }
    catch (e) { console.error('[concept-forge] gen chunk failed:', e && e.message); return; }
    generated += raw.length;
    if (!raw.length) return;
    let scored = [];
    try { scored = await scoreCards({ deck, cards: raw }); }
    catch (e) { console.error('[concept-forge] judge chunk failed:', e && e.message); return; }
    for (const card of scored) {
      if (card.gatePass) { passed.push(card); try { onCard(card); } catch { /* stream write best-effort */ } }
    }
  }));
  passed.sort((a, b) => (b.scores?.overall || 0) - (a.scores?.overall || 0));
  return { cards: passed, stats: { generated, passed: passed.length, rounds: 1 } };
}

async function dealHand({ deck, loadout }) {
  const target = Math.min(Math.max(Number(loadout.count) || 4, 1), 8);
  return fillToTarget(
    (want) => generateCards({ deck, loadout: { ...loadout, count: want } }),
    deck,
    target
  );
}

async function breedHand({ deck, parents, loadout, suppressed }) {
  const target = Math.min(Math.max(Number(loadout.count) || 4, 1), 8);
  return fillToTarget(
    (want) => breedCards({ deck, parents, loadout: { ...loadout, count: want }, suppressed }),
    deck,
    target
  );
}

module.exports = { dealHand, breedHand, dealStream };
