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

## Loop discipline — read this first

These rules exist because this skill can eat a turn budget if you let it. Follow them strictly:

1. **Heartbeat up front.** Before any browsing, call `send_message("Researching best affiliate for X…")` (or `final: false` mid-turn). Never go silent for more than ~60s without a status update — the user can't see what you're doing and will assume you're stuck.
2. **Hard budget: 8 store checks per item total** (the 5/portal cap from Step 2 still applies, but 8 is the absolute ceiling). After 8 checks — even if some are unverified — stop and ship what you have.
3. **Max 2 attempts per store** to verify stock. On the second failure (Cloudflare block, HTTP2 error, timeout, empty 0-result page that clearly loaded, etc.), mark the store `blocked` and move on. Do not retry with different headers, different search engines, or longer waits — that path has no end.
4. **Bot-wall signature = give up fast.** If you see "Just a moment…" / "Verifying you are human" / `ERR_HTTP2_PROTOCOL_ERROR` / persistent empty response, that's your one signal to mark `blocked` and move on. Don't spend 15s waiting on Cloudflare to clear — it won't from this container's IP.
5. **Always end with `send_message(..., final: true)`, even on partial results.** A partial answer with `unverified` tags beats an unfinished turn that ships nothing. If after the budget you have zero verified stockists, say so plainly and rank by cashback rate alone as a fallback.

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

**Domain shortlist.** Trumf/SAS may list brand stores (Dyson, Philips Hue, Harman Kardon) that only sell their own products, and miss the major general retailers. Before finalizing the shortlist, cross-reference these known Norwegian stockists for the item type:

| Category | Likely Norwegian stockists (check whether each is in either portal) |
|----------|---|
| AV receivers / hifi / home cinema | Proshop, Komplett, Power, Elkjøp, NetOnNet, HifiKlubben, Soundgarden, Dustin |
| Headphones / earbuds | Komplett, Power, Elkjøp, Kjell & Company, NetOnNet, Proshop, soundgarden.no |
| TVs | Power, Elkjøp, Komplett, NetOnNet, Proshop, Extra |
| White goods / kitchen appliances | Power, Elkjøp, Komplett, Miele, Witt, Elon |
| Small kitchen (air fryer, kettle, blender) | Power, Elkjøp, Komplett, Proshop, Witt, Bodum, KitchenTime |
| Photo / video gear | Foto.no, Komplett, Proshop, Scandinavian Photo, Calumet |
| PC components | Komplett, Proshop, Dustin, NetOnNet, Multicom |

If a likely stockist isn't on either portal, mention that in the final answer as "available outside portals" — Power, Elkjøp, and NetOnNet in particular are common Norwegian stockists but currently sit outside both Trumf Netthandel and SAS Online Shopping. Brand stores (Dyson, JBL, Sonos) can stay in the shortlist but only count toward the 5/portal cap if they actually carry the item type.

## Step 3 — Visit each shortlisted store and search for the exact item

For each shortlisted store, go to the store's own website and search for the **exact item** — same model/variant/spec as the user described, not a rough category match (e.g. "Dyson V15" the specific model, not "a Dyson vacuum" or "a cordless vacuum").

- If the exact item is found, record its sticker price (and product URL, for reference).
- If the exact item is not found (out of stock, not carried, different model only), **drop that store from the comparison** — don't substitute a similar product and don't report it as a negative finding unless every shortlisted store came up empty.

### Step 3.5 — When direct verification fails, use Prisjakt or PriceRunner

Major Norwegian electronics retailers (Proshop, Komplett, Power, Elkjøp, NetOnNet, Dustin, Foto.no) all run aggressive Cloudflare/bot-defence that blocks this container's IP. If you hit "Just a moment…", `ERR_HTTP2_PROTOCOL_ERROR`, persistent empty bodies, or "Verifying you are human" pages — **stop trying to bypass**. Move on to the next store in the shortlist (max 2 attempts per store, per Loop discipline), and use a price-comparison aggregator for the price + stock fallback:

```
https://www.prisjakt.no/search?q=<url-encoded exact item name>
```

Prisjakt aggregates real-time prices from all major Norwegian stores and shows stock per store. Open it with `agent-browser` (it's a JS-rendered SPA — `agent-browser snapshot -i` after `wait --load networkidle` works, plain `curl` returns an empty SSR shell). Each result card has a price and a list of stores with current stock.

- Use Prisjakt to fill in **sticker price + which Norwegian stores have it in stock** for the exact model. Don't quote a Prisjakt price as the "store price" — quote the price at the specific store from its own listing when available, otherwise quote Prisjakt with the caveat "via Prisjakt".
- PriceRunner.no works as a fallback if Prisjakt is also blocked.
- Mark any store whose own site you couldn't reach as `unverified-direct, price via Prisjakt`.

### Step 3.6 — Maximum attempt budget

Hard cap: 2 direct store visits per shortlisted store. After 2 failures (any combination of bot wall, HTTP error, or empty result), mark the store `blocked` and rely on Prisjakt for price/stock context only. Move to the next store — do not retry with different User-Agent, different search query, different locale, or a search engine (Google/DuckDuckGo/Bing all block this container too).

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
- Hard cap of 8 store checks per item total (Loop discipline). After 8, ship what you have.
- Max 2 direct attempts per store. After 2 failures, mark `blocked`, rely on Prisjakt/PriceRunner for price+stock context, and move on.
- Never spend more than ~15s waiting on a Cloudflare/HTTP2/etc. block. It's not clearing from this container's IP — accept it and continue.
- **Always call `send_message(..., final: true)` at the end**, even with partial results. A partial answer beats a silent turn. If zero stores verified, ship a cashback-rate-only ranking with explicit `unverified` caveats.
- Match on the _exact_ item — same model/spec. Drop a store rather than compare against a near-substitute.
- Never invent a price or cashback rate for a store you didn't actually check live (direct visit or Prisjakt). Mark unverified, don't guess.
- Don't add card-level EB (Amex etc.) into this comparison — it's a flat addition that doesn't change which store wins; the effective-price formula here is cashback-only.
- If an item's exact match isn't found at any shortlisted store, say so plainly rather than silently returning an empty comparison.
- Process each item in a multi-item list independently and report on all of them, not just the first.

## Related skills

- `find-optimal-affiliate` — use instead when the user already knows which shop they want and just wants the better portal for it.
- `compare-shopping-carts` — use instead for comparing an existing grocery receipt against Meny, not a wishlist item.

## Fallback resources (when direct store checks are blocked)

- **Prisjakt.no** — Norwegian price/stock aggregator; the cleanest fallback for "which Norwegian stores stock this exact model and at what price." JS-rendered SPA, use `agent-browser`.
- **PriceRunner.no** — secondary aggregator, similar shape.
- **Google Shopping** (`https://www.google.com/search?tbm=shop&q=...`) — last resort, often blocked.
- **The cashback portal itself** — Trumf and SAS occasionally feature items on their category landing pages with a direct "shop now" link; if you find the item on the portal's own featured/promoted listings, that price counts as live (the portal is not bot-defended).
