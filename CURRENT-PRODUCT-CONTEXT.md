# Concept Forge — Current Product Context

**Active brand:** Ayuttva Herbius Flex & Fine
**Source files:** `brand-context/flex-and-fine.md` (human doc) → `brand-context/flex-and-fine.deck.json` (machine deck)

The block below is the EXACT grounding text injected (with prompt caching) into every
generation, chat, judge, and export call. This is literally what the model sees as
"the only facts you may use." To change what the app knows, edit the source files above
(delete the .deck.json to force a fresh distillation from the .md).

---

## Grounding block (verbatim, as injected)

```
BRAND: Ayuttva Herbius Flex & Fine
PRODUCT: 100% natural Ayurvedic joint-mobility capsule
ONE-LINER: Refill your joints' natural lubricant for butter-smooth, gliding movement — no glucosamine, no shellfish.
MARKET: US
PRICE/OFFER: $28 / 120 capsules (30-day supply, 4 capsules/day)
PRIMARY ANCHOR: pain

PRODUCT TRUTHS (anchor every concept in at least one — do not invent facts beyond these):
- Supports the body's own synovial fluid — the joint's natural lubricant
- Supports healthy cartilage
- 100% natural Ayurvedic formula; key botanicals turmeric and boswellia
- No glucosamine and no shellfish, unlike most joint products
- Vegan, gluten-free; HPMC vegetable capsules
- 4 capsules a day; a 30-day refill is $28
UNIQUE MECHANISM:
- The 'joint drought' framing: joints dry out and lose fluidity; Flex & Fine helps refill the natural lubricant
- Lubrication + cartilage support = 'butter-smooth', gliding movement
PROOF POINTS:
- Pre-clinical study: Collagen Type II +311.9% (must be qualified as 'pre-clinical')
- Trust stack: 100% Natural | No Shellfish | No Glucosamine | Vegan | Gluten-Free

PERSONAS:
- [active-retiree] Active Retiree — 60+, refuses to slow down
    life: Gardening, golf, daily walks, travel with the grandkids. Measures a good day by how much she got to do.
    wants: To keep doing everything she loves without her body setting the limit.
- [weekend-warrior] Weekend Warrior — 45–55, recreational athlete
    life: Pickleball, tennis, lifting, long hikes. Plays hard on weekends, then moves like a rusty gate for two days after.
    wants: To recover fast and keep competing without feeling every game the next morning.
- [desk-professional] Desk-Bound Professional — 40–50, sits all day
    life: Back-to-back meetings, long hours at a desk. Notices knees that click on stairs and a stiff, slow rise out of the chair.
    wants: To move through the workday without feeling older than they are.
- [handson-grandparent] Hands-On Grandparent — 50–60, wants to keep up
    life: Babysits grandkids, gets down on the floor to play, hauls car seats and strollers.
    wants: To get down on the floor with the grandkids — and get back up just as easily.

PAINS/DESIRES:
- [joint-drought] Joint drought — Joints feel dried out and stiff; movement has lost its fluidity
    they say: "everything feels stiff and dry" / "my joints just don't glide anymore" / "like there's no oil left in the hinges"
- [morning-stiffness] Morning stiffness — Slow, creaky, reluctant start to the day
    they say: "it takes me an hour to loosen up" / "mornings are the worst" / "I creak getting out of bed"
- [stairs-getting-up] Stairs & getting up — The small everyday movements — stairs, standing up — that betray you
    they say: "the stairs remind me every time" / "I make that noise getting up now" / "I grab the railing without thinking"
- [shrinking-range] Shrinking range of motion — Quietly giving up activities because the body won't cooperate
    they say: "I've just stopped doing some things" / "I don't kneel in the garden anymore" / "I plan my day around what my knees will allow"
- [burned-by-glucosamine] Burned by glucosamine — Tried glucosamine/shellfish pills and felt nothing
    they say: "glucosamine did nothing for me" / "I've got a cabinet full of pills that didn't work" / "another supplement that was a waste of money"

BRAND VOICE:
- tone: warm, confident, plain-spoken, aspirational but grounded
- APPROVED language (prefer these): mobility, flexibility, ease of motion, joint fluidity, supports healthy cartilage, supports healthy synovial fluid, butter-smooth, refill, joint drought, gliding, natural lubricant, 100% Natural, No Shellfish, No Glucosamine, Vegan, Gluten-Free
- BANNED language (never use — hard fail): pain, reduce, treat, cure, ache, arthritis, osteoarthritis
- notes: No disease claims. No before/after implying medical treatment. Never show a person in active distress or pain. Talk about freedom of movement and everyday moments, not symptoms.
CONSTRAINTS:
- People shown should be 40–60+ adults in aspirational poses; from behind is preferred (no face needed).
- Show the product bottle or capsules naturally in scene; keep the trust stack visible where possible.
- Text-heavy static images do not perform — keep on-image text minimal.
- Brand colors: navy blue (#0A1628) with gold/white accents; default warm color grading.
- Always qualify the Collagen Type II claim as 'pre-clinical'.
```

---

## Structured deck (raw JSON source)

```json
{
  "brand": "Ayuttva Herbius Flex & Fine",
  "product": "100% natural Ayurvedic joint-mobility capsule",
  "oneLiner": "Refill your joints' natural lubricant for butter-smooth, gliding movement — no glucosamine, no shellfish.",
  "market": "US",
  "price": "$28 / 120 capsules (30-day supply, 4 capsules/day)",
  "anchorType": "pain",
  "productTruths": [
    "Supports the body's own synovial fluid — the joint's natural lubricant",
    "Supports healthy cartilage",
    "100% natural Ayurvedic formula; key botanicals turmeric and boswellia",
    "No glucosamine and no shellfish, unlike most joint products",
    "Vegan, gluten-free; HPMC vegetable capsules",
    "4 capsules a day; a 30-day refill is $28"
  ],
  "mechanisms": [
    "The 'joint drought' framing: joints dry out and lose fluidity; Flex & Fine helps refill the natural lubricant",
    "Lubrication + cartilage support = 'butter-smooth', gliding movement"
  ],
  "proofPoints": [
    "Pre-clinical study: Collagen Type II +311.9% (must be qualified as 'pre-clinical')",
    "Trust stack: 100% Natural | No Shellfish | No Glucosamine | Vegan | Gluten-Free"
  ],
  "personas": [
    {
      "id": "active-retiree",
      "name": "Active Retiree",
      "description": "60+, refuses to slow down",
      "lifeContext": "Gardening, golf, daily walks, travel with the grandkids. Measures a good day by how much she got to do.",
      "desire": "To keep doing everything she loves without her body setting the limit."
    },
    {
      "id": "weekend-warrior",
      "name": "Weekend Warrior",
      "description": "45–55, recreational athlete",
      "lifeContext": "Pickleball, tennis, lifting, long hikes. Plays hard on weekends, then moves like a rusty gate for two days after.",
      "desire": "To recover fast and keep competing without feeling every game the next morning."
    },
    {
      "id": "desk-professional",
      "name": "Desk-Bound Professional",
      "description": "40–50, sits all day",
      "lifeContext": "Back-to-back meetings, long hours at a desk. Notices knees that click on stairs and a stiff, slow rise out of the chair.",
      "desire": "To move through the workday without feeling older than they are."
    },
    {
      "id": "handson-grandparent",
      "name": "Hands-On Grandparent",
      "description": "50–60, wants to keep up",
      "lifeContext": "Babysits grandkids, gets down on the floor to play, hauls car seats and strollers.",
      "desire": "To get down on the floor with the grandkids — and get back up just as easily."
    }
  ],
  "pains": [
    {
      "id": "joint-drought",
      "label": "Joint drought",
      "description": "Joints feel dried out and stiff; movement has lost its fluidity",
      "vocPhrases": [
        "everything feels stiff and dry",
        "my joints just don't glide anymore",
        "like there's no oil left in the hinges"
      ]
    },
    {
      "id": "morning-stiffness",
      "label": "Morning stiffness",
      "description": "Slow, creaky, reluctant start to the day",
      "vocPhrases": [
        "it takes me an hour to loosen up",
        "mornings are the worst",
        "I creak getting out of bed"
      ]
    },
    {
      "id": "stairs-getting-up",
      "label": "Stairs & getting up",
      "description": "The small everyday movements — stairs, standing up — that betray you",
      "vocPhrases": [
        "the stairs remind me every time",
        "I make that noise getting up now",
        "I grab the railing without thinking"
      ]
    },
    {
      "id": "shrinking-range",
      "label": "Shrinking range of motion",
      "description": "Quietly giving up activities because the body won't cooperate",
      "vocPhrases": [
        "I've just stopped doing some things",
        "I don't kneel in the garden anymore",
        "I plan my day around what my knees will allow"
      ]
    },
    {
      "id": "burned-by-glucosamine",
      "label": "Burned by glucosamine",
      "description": "Tried glucosamine/shellfish pills and felt nothing",
      "vocPhrases": [
        "glucosamine did nothing for me",
        "I've got a cabinet full of pills that didn't work",
        "another supplement that was a waste of money"
      ]
    }
  ],
  "brandVoice": {
    "adjectives": [
      "warm",
      "confident",
      "plain-spoken",
      "aspirational but grounded"
    ],
    "approvedLanguage": [
      "mobility",
      "flexibility",
      "ease of motion",
      "joint fluidity",
      "supports healthy cartilage",
      "supports healthy synovial fluid",
      "butter-smooth",
      "refill",
      "joint drought",
      "gliding",
      "natural lubricant",
      "100% Natural",
      "No Shellfish",
      "No Glucosamine",
      "Vegan",
      "Gluten-Free"
    ],
    "bannedLanguage": [
      "pain",
      "reduce",
      "treat",
      "cure",
      "ache",
      "arthritis",
      "osteoarthritis"
    ],
    "notes": "No disease claims. No before/after implying medical treatment. Never show a person in active distress or pain. Talk about freedom of movement and everyday moments, not symptoms."
  },
  "constraints": [
    "People shown should be 40–60+ adults in aspirational poses; from behind is preferred (no face needed).",
    "Show the product bottle or capsules naturally in scene; keep the trust stack visible where possible.",
    "Text-heavy static images do not perform — keep on-image text minimal.",
    "Brand colors: navy blue (#0A1628) with gold/white accents; default warm color grading.",
    "Always qualify the Collagen Type II claim as 'pre-clinical'."
  ],
  "offer": "30-day refill for $28; 4 capsules a day."
}
```
