---
name: find-cheapest-store
description: >-
  Given one or more specific items the user wants to buy, find candidate
  stores from both the SAS EuroBonus online-shopping portal and Trumf
  Netthandel, check which of those stores actually stock the exact item,
  and rank them by effective price after cashback/EB. Use when the user
  lists item(s) they want to buy and asks "where should I buy this",
  "cheapest place for X (with cashback)", "check Trumf/EB for X", or gives
  a wishlist and asks for the best deal. Distinct from
  find-optimal-affiliate (that skill assumes you already know the shop);
  this skill starts from the item and discovers shops first.
metadata:
  author: mathipe
  version: '1.0.0'
---

# Find Cheapest Store — Item-First Cashback Comparison

Given a shopping list, find which store sells each _exact_ item for the lowest **effective price** — sticker price minus the value of Trumf/EuroBonus (EB) cashback earned on the purchase. Unlike `find-optimal-affiliate` (which compares two portals for a shop you already picked), this skill starts from the item, discovers plausible shops from both portals' categories, then checks each shop's actual stock and price.

Process each item in the list independently and report on each separately.

## Step 1 — Discover candidate stores from both portals' categories

For every item, browse **both** portals' category listings — always check both, never skip one based on a guess about fit, since an item can land in unexpected or multiple categories (e.g. an air fryer sits under "Elektronikk" on one portal and both "Bolig" _and_ "Elektronikk" on the other).

**Trumf Netthandel** — category pages are plain server-rendered HTML:

```
https://trumfnetthandel.no/kategori/<slug>
```

e.g. `elektronikk`, `bolig`. If unsure of the exact slug, fetch `https://trumfnetthandel.no` first and read the category nav for the right slug(s) — an item can plausibly belong to more than one category here (check all that plausibly fit, not just one).

**SAS Online Shopping** — category pages are client-rendered (a plain GET returns an empty SSR shell with no data), so use `agent-browser` to open and read them:

```
https://onlineshopping.flysas.com/nb-NO/kategorier/<id>/<page>
```

Category IDs aren't self-explanatory — open the site's category navigation first (homepage menu) to find which numeric ID maps to the category name you want (e.g. "Hus og Hjem").

Each portal's category page lists a set of stores with logos/names (and, on Trumf, the bonus rate right on the tile — capture that now, it saves a lookup later).

## Step 2 — Shortlist plausible stores, max 5 per portal

From each portal's category listing(s), pick the stores plausibly relevant to the _type_ of item — not every store in a broad category sells everything in it (e.g. "Hus og Hjem" includes furniture and cleaning supplies as well as kitchenware; for an air fryer, keep the kitchen/appliance stores and drop the rest).

**Cap at 5 shortlisted stores per portal** (10 total max per item). If more than 5 plausible stores exist in a category, prioritize by: dedicated/specialist relevance to the item type first, then bonus rate. Don't visit more than 5 per portal even if the category has dozens of stores — the goal is a strong shortlist, not exhaustive coverage.

If a store appears on both portals, keep it as one candidate but note both rates — it still only counts toward one portal's cap for shortlisting purposes, but its final comparison should use whichever portal rate is actually usable (see Step 4).

## Step 3 — Visit each shortlisted store and search for the exact item

For each shortlisted store, go to the store's own website and search for the **exact item** — same model/variant/spec as the user described, not a rough category match (e.g. "Dyson V15" the specific model, not "a Dyson vacuum" or "a cordless vacuum").

- If the exact item is found, record its sticker price (and product URL, for reference).
- If the exact item is not found (out of stock, not carried, different model only), **drop that store from the comparison** — don't substitute a similar product and don't report it as a negative finding unless every shortlisted store came up empty.

## Step 4 — Compute effective price per store

For each store where the item was actually found, convert its cashback to EB-per-100-NOK, then to an effective price:

```
Trumf-sourced EB   = trumf_bonus_percentage × 13.5   (Trumf-kr → EB, auto-transfer rate)
SAS-sourced EB     = poeng shown on the portal (already EB, no conversion)

EB value           = EB_per_100_NOK × (item_price / 100) × 0.10   (1 EB ≈ 0.10 NOK, standard redemption)
Effective price     = item_price − EB value
```

Card-level EB (e.g. Amex Premium's 15 EB/100 NOK) is **not** added on top here — it applies equally to every store regardless of portal, so it doesn't change the _relative_ ranking and only adds noise. Leave it out of this comparison; the point is to find which store is cheapest, not to compute your total EB haul.

If a store is listed on both portals, use whichever rate is higher (that's the one you'd actually click through) — note that you checked both.

## Step 5 — Rank and present per item

Follow Slack formatting rules: no markdown tables, no `##` headings — bold text and bullets.

Report, per item:

- Sticker price and effective price for every store where the exact item was found, ranked cheapest-effective-first
- The cashback rate and source portal for each
- A one-line winner call-out, especially flagging when the ranking _inverts_ the sticker-price order (a store with a higher sticker price wins on effective price) — this is the whole point of the calculation, so surface it explicitly when it happens
- Stores checked but not stocking the item: mention briefly only if it affects interpretation (e.g. all Trumf-side candidates lacked it), don't clutter every response with a "not found" list for every dropped store

Example shape (hypothetical numbers — always use real prices/rates found live, never reuse this example's figures):

```
*Dyson V15 — best effective price*

• Proshop: 6 890 kr sticker, 3,7 % Trumf → 49,95 EB/100kr → 6 442 kr effective
• Elkjøp: 6 990 kr sticker, 4 % Trumf → 54 EB/100kr → 6 613 kr effective
• Power: 7 190 kr sticker, 6 EB/100kr via SAS portal → 6 972 kr effective

Komplett was listed under Trumf's Elektronikk category but doesn't stock this model — excluded.

*Proshop wins — 6 442 kr effective, cheaper than Elkjøp despite having a lower sticker price too. Power has the highest sticker price and the weakest cashback rate, making it the worst deal on both counts.*
```

## Rules

- Always browse both portals' category listings for every item — never skip a portal based on a pre-judgment about category fit.
- Cap shortlisting at 5 stores per portal per item (10 total) — don't visit more sites than that even if a category has many stores.
- Match on the _exact_ item — same model/spec. Drop a store rather than compare against a near-substitute.
- Never invent a price or cashback rate for a store you didn't actually check live.
- Don't add card-level EB (Amex etc.) into this comparison — it's a flat addition that doesn't change which store wins; the effective-price formula here is cashback-only.
- If an item's exact match isn't found at any shortlisted store, say so plainly rather than silently returning an empty comparison.
- Process each item in a multi-item list independently and report on all of them, not just the first.

## Related skills

- `find-optimal-affiliate` — use instead when the user already knows which shop they want and just wants the better portal for it.
- `compare-shopping-carts` — use instead for comparing an existing grocery receipt against Meny, not a wishlist item.
