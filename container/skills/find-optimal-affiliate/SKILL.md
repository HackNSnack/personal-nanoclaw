---
name: find-optimal-affiliate
description: >-
  Look up a shop in both the SAS EuroBonus online-shopping portal and Trumf
  Netthandel to find which affiliate gives more EuroBonus (EB) value. Use
  when the user names a shop and asks which cashback/points portal to buy
  through, e.g. "which is better for X", "check cashback for X", "should I
  buy through SAS or Trumf for X".
metadata:
  author: mathipe
  version: '1.0.0'
---

# Find Optimal Affiliate — SAS EuroBonus vs Trumf Netthandel

Both portals pay out for the same purchase, but in different currencies (EB directly, or Trumf-kroner that convert to EB at a fixed rate). This skill looks a shop up in both, converts to a common EB-per-100-NOK basis, and recommends the better one.

## Step 1 — Look up the shop on Trumf Netthandel

```
https://trumfnetthandel.no/Search/?searchTerm=<url-encoded shop name>
```

Plain GET, static HTML, no login required. Use the WebFetch tool. Each result is an `<a>` tile with `data-name="..."` and `data-percentage="X %"` attributes — read those directly rather than parsing visible text.

- `data-percentage` is a **Trumf-bonus percentage**, i.e. Trumf-kroner earned per 100 NOK spent (6,2 % = 6.2 Trumf-kr per 100 NOK).
- "Opptil X %" means a capped/conditional rate (varies by product category on that site) — note this as a caveat rather than treating it as guaranteed.
- No result for the search term = not available through Trumf. Say so and move to Step 2 without inventing a rate.

## Step 2 — Look up the shop on SAS Online Shopping

There is no working search query for this site — `?search=` is silently ignored. Instead, paginate through the shop listing and scan for the name:

```
https://onlineshopping.flysas.com/nb-NO/alle-butikker/1
https://onlineshopping.flysas.com/nb-NO/alle-butikker/2
...
https://onlineshopping.flysas.com/nb-NO/alle-butikker/8
```

Fetch with the WebFetch tool (it renders the underlying data correctly; plain `curl` returns a broken SSR shell with no shop data). Stop as soon as you find a match — shops are listed alphabetically, so you can usually jump straight to the page covering the right letter range instead of fetching all 8. Each shop entry shows a line like `Tjen 25 poeng per 100 kr.` directly under the shop name.

- Most shops earn a flat **X poeng per 100 kr** — this is already in EB, no conversion needed.
- Some shops instead show a **fixed reward** (e.g. `Tjen 250 poeng`, `Tjen 1 000 poeng`) regardless of purchase size — these aren't proportionally comparable to a percentage rate. Report the flat amount as-is and flag it as non-proportional rather than forcing a per-100-NOK comparison.
- "Doble poeng" / "Ekstra poeng" badges are time-limited promos — mention them but don't assume they're permanent.
- No match after checking all relevant pages = not available through SAS. Say so.

## Step 3 — Convert to a common basis and compare

```
SAS EB per 100 NOK   = poeng value shown (already EB)
Trumf EB-equivalent  = trumf_percentage × 13.5   (Trumf-kroner → EB conversion rate)
```

Whichever number is higher per 100 NOK wins. If the user wants the NOK value too, apply the standard EB-value assumption (1 EB ≈ 0.10 NOK, or 0.20 NOK with a 2-for-1 Companion Ticket) from the grocery/EuroBonus reference docs — but the primary answer is the EB-per-100-NOK comparison, since that's currency-neutral between the two portals.

If the shop only exists on one portal, recommend that one directly and skip the comparison math. If it exists on neither, say so plainly — don't guess a rate.

## Step 4 — Present the result

Follow Slack formatting rules: no markdown tables, no `##` headings — bold text and bullets.

Example shape:

```
*Lyko — affiliate comparison*

• SAS Online Shopping: 25 EB per 100 kr
• Trumf Netthandel: 6,2 % Trumf-bonus → 6.2 × 13.5 = 83,7 EB per 100 kr

*Trumf Netthandel wins — 83,7 EB vs 25 EB per 100 kr (≈3.3x more).*
```

## Rules

- Never invent a rate for a shop you didn't actually find on the page — report "not found" instead.
- Always show the conversion math (Trumf % × 13.5), not just the conclusion, so the user can sanity-check it.
- Flag "Opptil" (up to) rates and fixed-point rewards as non-standard rather than comparing them at face value.
- If both portals list the shop at genuinely equal EB value, say so — don't force a winner.
