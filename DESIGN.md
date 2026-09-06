# DESIGN.md — leg-agent on BOT Chain

Shown before visual polish. Build against this; do not invent a purple-gradient template.

## One-line product

**leg-agent** settles advisor credits on BOT Chain so every reservation confirms in under a second at ~$0.002 — legendary-investor guidance without L2 fee friction.

## Type pairing

| Role | Choice | Why |
|------|--------|-----|
| Display | **Fraunces** (variable, soft terminals) | Quiet authority; reads as “advisory desk,” not memecoin |
| Body / UI | **Sora** or **Source Sans 3** | High legibility at small sizes; pairs with Fraunces without shouting |
| Mono | **IBM Plex Mono** | Addresses, amounts, tx hashes |

Avoid Inter / Roboto / system-ui as the hero face.

## Palette (restrained, BOT-anchored)

BOT Chain brand cues: deep ink + electric lime accent (not purple, not cream-serif terracotta).

| Token | Hex | Use |
|-------|-----|-----|
| `--bg` | `#0B1210` | Page ground |
| `--bg-elev` | `#121A17` | Panels (not cards-by-default) |
| `--ink` | `#E8F0EC` | Primary text |
| `--muted` | `#8A9A93` | Secondary |
| `--line` | `#24302B` | Hairlines / rules |
| `--accent` | `#A8F07A` | CTA, focus, confirmed state |
| `--accent-ink` | `#0B1210` | Text on accent |
| `--warn` | `#E8B86D` | Wrong-network / stand-in trade |
| `--danger` | `#E07A6A` | Reverts / errors |

Atmosphere: subtle radial gradient from `#14301F` (top-left) into `--bg` — not flat, not glow-stack.

## Spacing scale

`4 / 8 / 12 / 16 / 24 / 40 / 64` — section gaps jump by the 40/64 tier only.

## Signature interaction

**Credit settle flash:** on vault write confirmation, the fee line ticks from `pending…` → `confirmed · N gas · BOT` in &lt;1s with a 120ms accent underline wipe (respect `prefers-reduced-motion`: instant swap, no wipe).

## Landing first viewport (budget)

1. Brand: **leg-agent**
2. One headline (product job)
3. One supporting sentence (why BOT Chain)
4. One CTA group (Connect / Fund credits)
5. Full-bleed atmospheric field (gradient + soft grid) — no inset hero card, no stat strip

## Do not ship

Purple-indigo crypto gradients · cream + terracotta newspaper look · floating badges on hero · multi-layer shadows · emoji rows · “this may take a few minutes” copy
