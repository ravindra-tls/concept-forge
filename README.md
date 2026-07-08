# ⚒ Concept Forge — Vercel deployment

> This is the **Vercel-deployable variant** of [ravindra-tls/concept-forge](https://github.com/ravindra-tls/concept-forge).
> The app itself is identical; this repo adds the serverless wiring.

## Deploying on Vercel

1. Import this repo in Vercel (framework preset: **Other**; no build step needed).
2. Set the environment variables in Project → Settings → Environment Variables:
   - `ANTHROPIC_API_KEY` — required (concept generation, judging, finalize, template fill)
   - `FAL_KEY` — optional (image rendering via Nano Banana Pro; without it everything works except Generate image)
3. Deploy. Static UI is served from `public/` by the CDN; all `/api/*` routes run in one
   serverless function (`api/index.js`) that wraps the same zero-dependency handler
   `server.js` uses locally — including the NDJSON streaming deal endpoint.

**What's different from the main repo:**
- `api/index.js` + `vercel.json` — serverless entry, `/api/*` rewrite, `maxDuration: 300`,
  `includeFiles` for `knowledge/` + `brand-context/` (they're read at runtime).
- Sessions are stored in `/tmp` (the only writable path) — they survive warm invocations
  but are lost on cold starts. The client detects a stale session and recreates it
  automatically; board/finalized state is per-session anyway.
- `brand-context/*.deck.json` (the pre-distilled grounding decks) **are committed** so a
  cold start never re-distills the brand document (~60s + tokens).
- Long operations (deal ≈ 30–60s, finalize ≈ 30s) need `maxDuration` above the default —
  on Hobby plans functions cap lower; if generation times out, enable Fluid Compute or
  upgrade the plan.

Local run is unchanged: `node server.js` → http://localhost:4317.

---

A gamified ad-concept ideation tool that uses the Anthropic API as a creative thinking
partner. It sits on top of your existing **creative-strategy skill stack** (brand-intake →
creative-strategy-engine → creative-mechanics → visual-formats → hook-writing/tactics/voice)
and turns concepting into a **spin-and-breed game** — while a hidden quality gate guarantees
every card you see is grounded, specific, and on-brand.

## The idea in one picture

```
Grounding deck (facts, fixed)      ← brand truths, personas, pains, VOC, banned language
        │                            never invented, only recombined
        ▼
Play loop (the game)               ← Spin a loadout → Deal a hand → Keep/Discard → Breed winners
        │
        ▼
Judge / gate (hidden)              ← every concept scored on 5 axes; only those ≥ bar are dealt
```

Each concept "card" is a combination of skill-stack dimensions:

`persona × pain × awareness stage → messaging angle → mechanic → hook tactic/trigger → visual format → the line`

## Why it stays "solid" while being fun

- **Grounded:** concepts may only use facts from the brand grounding deck (`brand-context/*.md`).
- **Gated:** a ruthless judge model scores each card on *product-truth, specificity, concreteness,
  scroll-stop, brand-voice* and hard-fails any banned language. Below-bar cards are silently
  regenerated — you only ever see cards that passed.
- **Targeted:** persona, pain, and awareness stage are first-class dimensions.

## Deep audience insight (emotional core)

Functional pains ("joint drought") make grounded but emotionally flat ads. This layer reaches the
raw, unspoken human truths a great marketer gets by imagining one real person — envy, shame, fear,
grief, vanity — surfaced **with empathy**, never shaming the viewer.

- **Enriched personas** — every persona is deepened (once, cached back into the `.deck.json`) with an
  inner-life layer: inner monologue, unspoken fears, who she quietly envies, the concrete moments that
  sting, who she used to be vs. wants to be (`lib/grounding.js` `enrichPersonas`, one small Sonnet call
  per persona so it never truncates). This feeds every concept by default.
- **🔍 Mine insights** — pick a persona, and the app (Opus, `lib/insights.js`) imagines her inner life
  and surfaces ~8 raw first-person tensions. Pick the truest 3–4 (chip tray); concepts are then built
  on those. Each concept card shows the `🫀` truth it's built on.
- **The judge rewards emotional truth** — a 6th `emotionalTruth` axis (rebalanced with productTruth so
  emotion isn't crowded out). Raw ≠ non-compliant: banned language / medical claims / *shaming the
  viewer* still hard-fail; an empathetic take on a hard truth scores high.

Raw ideation, empathetic final ad: mining goes to uncomfortable places, but concepts surface them so
she feels *seen*; brand tone rules (e.g. "never shame aging") govern the final wording.

## Game mechanics

- **Per-card diversity engine** — a batch isn't N phrasings of one idea. Before generating, each card is
  assigned a *distinct* awareness × mechanic × hook tactic × format (and one pinned insight rotated per
  card), so every concept is a different **kind of ad** — a Curiosity teaser vs. a Social-Witness moment
  vs. a Borrowed-Enemy contrarian. Pinned dimensions stay fixed; the overused "X isn't broken — it's Y"
  reframe is capped at one card per set. (`lib/generator.js` `buildDiversityPlan`.)
- **🎲 Spin the reels** — randomize the creative dimensions (mechanic / format / hook tactic)
  while you keep persona + pain locked to your target. Or leave any reel on *Auto* and let Claude choose.
- **Constraint cards** — optional modifiers ("≤6 words", "as a confession", "no adjectives"…) that force novelty.
- **🧬 Breed** — the cards you ❤ Keep become parents; breeding recombines their DNA and mutates one
  dimension to explore. Discarded DNA is suppressed so it stops reappearing.
- **👑 Crown** — promote a card to final polish (5 tagline variants + full concept spec + compliance check),
  then **export** an image brief in your `ad-creative-generator` JSON schema.

## Run it

```bash
cd "C:\Users\ravindra.singh\.claude\Claude code\concept-forge"
# 1. Provide your keys (any one of these per key):
#    - set an env var (ANTHROPIC_API_KEY, FAL_KEY), or
#    - copy .env.example to .env and paste them, or
#    - set ANTHROPIC_ENV_FILE to a file that already has them
node server.js
# → open http://localhost:4317
```

The UI (loadout, taxonomy, brand selection) loads without a key; **dealing/breeding/crowning needs `ANTHROPIC_API_KEY`, generating the actual image on export needs `FAL_KEY`.**

## Templated export → real image (no copy/paste)

Export no longer asks the model to freestyle a composition (that produced strong photos but weak
*ads*). Instead it **fills a proven ad-layout template** with your concept's copy + brand grounding:

1. **Templates** — 300 real-ad-derived layout formulas (each a prompt with `[PLACEHOLDER]` tokens,
   categorized: Hero/Product · Social Proof · Educational · Comparison · UGC · Lifestyle ·
   Native/Editorial · Press/Authority · Offer/Promotion) snapshotted into
   `knowledge/ad-templates.json`.
2. **Auto-match + override** — the export panel auto-picks a template by the concept's format/archetype
   and shows it with a preview thumbnail; a **Swap layout template** picker lets you choose any of the
   300 (grouped by category). `lib/templates.js` handles load/select; `lib/export.js` fills the tokens
   via one Opus call (persona-matched, compliance-safe — never invents discounts, prices, review
   counts, or clinical stats, and honors banned language).
3. **🎨 Generate image** — `lib/falai.js` renders the filled prompt for real via **Nano Banana Pro**
   (Google's Gemini 3 Pro Image, on fal.ai) — pick 1K/2K/4K, uses your product reference image(s) for
   image-to-image conditioning automatically. Zero-dependency: talks to fal's queue REST API directly
   (submit → poll → result), no `@fal-ai/client` package. Get a key at
   [fal.ai](https://fal.ai/dashboard/keys).

**Refresh templates:** re-run the snapshot script (reads TAE Ad Studio's `prompt_templates` table via
its `.env.local`, writes `knowledge/ad-templates.json`).

## Models (swap in `lib/anthropic.js`)

| Stage | Model | Why |
|---|---|---|
| Generate candidates | `claude-haiku-4-5` | fast, cheap, high volume |
| Judge / gate | `claude-sonnet-4-6` | strong, skeptical scoring |
| Champion polish & export | `claude-opus-4-8` | best final craft |

The brand grounding block is sent with **prompt caching** so every round in a session reuses it cheaply.

## Add a brand

Drop a `brand-context/<slug>.md` file (structured like a brand-intake output — see
`flex-and-fine.md`). On first use it's distilled into a cached `<slug>.deck.json`. To ground offline
immediately, author the `.deck.json` by hand alongside it (see `flex-and-fine.deck.json`).

## Supply-chain note

Intentionally **zero runtime dependencies** — Node's built-in `http` server and `fetch`, no npm
packages to install, pin, or audit. Secrets are read from the environment/`.env` only and never logged
or committed (`.env`, `sessions/`, `exports/`, `*.deck.json` are gitignored).

## Layout

```
server.js                 HTTP server + API routes (zero-dep)
lib/anthropic.js          Messages API client (fetch, caching, tool output)
lib/grounding.js          brand-context → compact grounding deck
lib/knowledge.js          taxonomy accessors (stage↔format fit, format→category)
lib/generator.js          deal + breed prompts (Haiku)
lib/judge.js              rubric scoring + gate (Sonnet)
lib/engine.js             generate→judge→refill loop
lib/champion.js           final polish (Opus)
lib/export.js             fills a proven ad template with concept copy + brand grounding (Opus)
lib/templates.js          load/select/list the 300 ad templates; concept→category auto-match
lib/falai.js              Nano Banana Pro image generation (fal.ai queue REST API, zero-dep)
knowledge/ad-templates.json  300 real-ad layout templates (snapshot of TAE prompt_templates)
lib/session.js            in-memory + on-disk session state
knowledge/taxonomies.json 5 stages · 8 mechanics · 8 triggers · 35 tactics · 10 voice clusters · 46 formats · constraint cards
knowledge/prompt-fragments.js  craft rules + judge rubric
brand-context/            *.md brand docs (+ cached *.deck.json)
public/                   vanilla-JS single-page app
```
