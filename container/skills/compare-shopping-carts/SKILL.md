---
name: compare-shopping-carts
description: >-
  Compare a grocery receipt (image or text) against Meny's live prices to
  find the *effective* price after Trumf and EuroBonus earnings. Use when
  the user uploads a receipt or pastes a grocery order and asks whether
  Meny (or NorgesGruppen generally) would be cheaper, or asks to "compare
  this cart", "check against Meny", or similar.
metadata:
  author: mathipe
  version: '1.0.0'
---

# Compare Shopping Cart — Effective Price vs Meny

Given a grocery receipt, determine whether the _effective_ price — after Trumf and EuroBonus (EB) earnings — would be lower buying the same cart at Meny instead. This only makes sense when the receipt is from a store outside NorgesGruppen (e.g. Coop, Rema 1000) — Meny, Kiwi, and Spar all share the same Trumf program, so if the receipt is already NorgesGruppen, say so and skip the comparison.

## Step 1 — Extract the cart

Read the receipt into a list of line items: `{name, quantity, unit_price, line_total}`.

- **Image**: use vision to read it. If OCR comes back patchy or a working vision provider isn't available, say so and ask the user to paste the text instead rather than guessing at illegible line items.
- **Text**: parse directly. Norwegian receipts commonly abbreviate names (`H-MELK`, `KYLLINGFILET`, `LOFF`) — keep enough of the abbreviation to search with in Step 2.

Note the store name and the receipt date — the date matters for Step 3 (Thursday = Trippel Trumf).

## Step 2 — Find each item's Meny equivalent

For each line item, query Meny's catalog:

```
https://meny.no/sok?query=<url-encoded product name>&expanded=products
```

This is a plain server-rendered page — a GET request returns product cards directly (name, brand, pack size, price, and a unit price like `kr/l` or `kr/kg`), no login or JS execution required. Use the **WebFetch tool** to fetch it (not `agent-browser`) — a plain GET is all this page needs, and WebFetch is the lighter, faster path for a static page like this. Reach for `agent-browser` only if WebFetch comes back incomplete or blocked.

Simplify the search query before hitting the URL — strip receipt noise and keep the core product name, e.g. `KYLLINGFILET FERSK` → `kyllingfilet`, `TINE LETTMELK 1,75L` → `lettmelk`.

### Matching rules

- Match on **product type first, brand second** — a store's own-brand item should match against any brand's equivalent at Meny, not just a same-brand hit.
- Match **pack size** where possible. If Meny only has a different size, use the item's `kr/l`/`kr/kg` unit price and scale it to the receipt's actual quantity instead of comparing sticker price to sticker price directly.
- If nothing in the results is a reasonable match (wrong category, no plausible size-adjusted equivalent) — **skip the item**. Don't force a bad match; track it separately as "not compared" with a one-line reason.
- Check the first page of results (~20 items) per query; don't paginate hunting for a marginal match.

## Step 3 — Compute effective prices

Default assumptions — state any you override in the final message:

- **Card:** SAS Amex Premium, 15 EB per 100 NOK spent (use 20 EB if the user says Amex Elite)
- **EB value:** 1 EB ≈ 0.10 NOK, standard economy redemption (use 0.20 NOK if the user says they're using a 2-for-1 Companion Ticket)
- **Trumf:** 1% at Meny/Kiwi/Spar, unless the receipt date is a **Thursday** → use 3% (Trippel Trumf Torsdag)
- **Coop bonus:** 1% at Coop, redeemable only at Coop (not convertible to EB) — value it at exactly 1 NOK per 100 NOK spent, don't run it through the EB conversion

```
Meny effective total = meny_total − meny_total × (trumf_rate × 13.5 + amex_rate) × eb_value
Coop effective total = coop_total − coop_total × 0.01 − coop_total × amex_rate × eb_value
```

Apply this per matched item — `coop_total` is the item's actual receipt line total, `meny_total` is the Meny price scaled to the same quantity — then sum across all matched items. Items with no NorgesGruppen loyalty program (e.g. Rema 1000 originals) skip the store-bonus term but still earn the card EB.

## Step 4 — Present the result

Follow Slack formatting rules: no markdown tables, no `##` headings — bold text and bullets instead.

Report:

- Matched item count vs. skipped count, and which were skipped and why
- Nominal total: original store vs. Meny equivalent (matched items only)
- Effective total: original store vs. Meny, after loyalty/EB adjustments
- The recommendation — which is cheaper effectively, and by how much
- The skipped items' original cost, called out separately as "still cost this regardless — no comparable Meny match," so the total isn't misrepresented as fully covered by the comparison

Example shape:

```
*Coop Extra receipt vs Meny — effective price comparison*

Matched 7 of 9 items (2 skipped — no comparable product: "hjemmelaget kokt skinke", and a 2kg carrot bag with no matching Meny pack size).

Nominal: Coop 312,40 kr → Meny 298,90 kr
Effective (Trumf 1% + Amex Premium): Coop 305,58 kr → Meny 289,52 kr

*Meny would be ~16 kr cheaper effectively on the matched items.*

Skipped items (still cost 44,00 kr at Coop regardless): kokt skinke, gulrøtter 2kg
```

## Rules

- Never invent a Meny price for an item with no real search result — skip it and say so.
- State any assumption overrides (card tier, EB value, Trumf rate) in the final message.
- Meny's search page returns prices for one specific pickup store — note this as a caveat if the user cares about a particular location.
- Full pricing methodology and worked examples live in the Obsidian vault at `Obsidian-Netlight/Clients/Personal/AgentNotes/Reference/SAS Travels/Grocery Store Price Comparison with EuroBonus.md` and `.../EuroBonus Best Case Value — Sale Awards + Companion Ticket.md` — read them if you want the full derivation or need best-case (sale + Companion Ticket) EB values.
