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

**BOTH portals require a real, fresh tool call every time — no exceptions, no shortcuts, no memory.** This skill has two independent, equally mandatory data-gathering steps: Step 1 (Trumf) and Step 2 (SAS). It is not enough to nail Step 2's (admittedly more finicky) SAS lookup and consider the job done — a comparison with only one side fetched is not a comparison, it's a guess. Before writing any final answer, explicitly confirm to yourself: "Did I call WebFetch for the Trumf URL _in this conversation, for this specific shop_, and did I call it for the SAS URL(s) too?" If either answer is no, stop and make that call now — do not proceed to Step 3/4 without both.

**Never reuse a rate, percentage, or EB number from memory, from a prior answer, or from a different shop's lookup earlier in this conversation.** Every specific number in a final answer must come from a WebFetch call you made _in this turn, for this exact shop_. If you catch yourself writing a specific percentage or EB figure without having just fetched it for the shop currently being asked about, that is a hallucination — stop and go fetch it for real, don't carry a number over from a previous shop or previous answer.

## Step 1 — Look up the shop on Trumf Netthandel

**MANDATORY — do this for every lookup, regardless of how much work Step 2 (SAS) ends up taking.** Skipping this because Step 2 was tedious, or because you already "know" a rate from earlier in the conversation, is not acceptable — Trumf rates must come from a fresh fetch every time.

```
https://trumfnetthandel.no/Search/?searchTerm=<url-encoded shop name>
```

Plain GET, static HTML, no login required. Use the WebFetch tool. Each result is an `<a>` tile with `data-name="..."` and `data-percentage="X %"` attributes — read those directly rather than parsing visible text.

- `data-percentage` is a **Trumf-bonus percentage**, i.e. Trumf-kroner earned per 100 NOK spent (6,2 % = 6.2 Trumf-kr per 100 NOK).
- "Opptil X %" means a capped/conditional rate (varies by product category on that site) — note this as a caveat rather than treating it as guaranteed.
- No result for the search term = not available through Trumf. Say so and move to Step 2 without inventing a rate.

## Step 2 — Look up the shop on SAS Online Shopping

### Step 2a — Paginate and scan

There is no working search query for this site — `?search=` is silently ignored. Instead, paginate through the shop listing and scan for the name.

**This page is a client-rendered SPA (Nuxt) — the shop list is populated by JavaScript after load, and it is NOT present in the raw HTML at all.** The WebFetch tool does a plain HTTP GET and does not execute JavaScript, so fetching these URLs directly returns only the nav/footer chrome ("Velg en butikk", "Søk", "Se alle butikker", etc.) with zero shop cards — this looks like an empty/broken page, but it isn't broken, it's just unrendered. Plain `curl` has the identical problem for the same reason. There is no JSON API endpoint to hit instead (checked — no sitemap, no `/api/` route serving shop data to unauthenticated requests).

**Fix: fetch through a rendering proxy that executes the JS server-side and returns plain HTML**, by prefixing the target URL with `https://r.jina.ai/`. r.jina.ai renders the page in a headless browser and returns the fully populated shop list as markdown, which a plain GET can then read normally. Expect ~5–10s per page. Each shop entry shows a line like `Tjen 25 poeng per 100 kr.` directly under the shop name. If you ever get only nav/footer content with no shop cards back, that's a signal the JS never rendered — retry through the `r.jina.ai/` proxy rather than assuming the shop doesn't exist.

**MANDATORY CHECKLIST — do this before you do anything else in Step 2, and before touching Step 1 or Step 2b.** Fetch all 8 pages below, in order, every single time, regardless of whether you "expect" to find the shop early (e.g. on page 1 because it seems popular, or alphabetically obvious). Shops are roughly alphabetical but page boundaries aren't predictable in advance (e.g. page 4 spans letters J–M) — a single page returning no match rules out only that page, it tells you nothing about the other 7, so never guess-jump to "the right page" and stop there. Track your progress explicitly as you go, e.g. by literally writing out `[x] page 1  [ ] page 2  [ ] page 3 ...` and updating it after each fetch, so you can't lose track or convince yourself you're "probably done" after one or two pages:

```
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/1
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/2
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/3
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/4
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/5
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/6
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/7
[ ] https://r.jina.ai/https://onlineshopping.flysas.com/nb-NO/alle-butikker/8
```

The only valid reason to stop early is finding an actual name match — check it off and stop. Finishing all 8 with no match is what unlocks Step 2b; it is not itself a valid stopping point for the whole shop lookup.

**Trying a different locale's page 1 (e.g. `en-NO/all-shops/1`) is NOT a substitute for finishing the `nb-NO` pagination.** It's a different, separately-paginated listing — fetching its page 1 only checks its page 1, it does not retroactively cover `nb-NO` pages 2–8. If you're tempted to switch locale after a miss on page 1, that's a sign you're looking for a shortcut around the checklist, not a valid alternative to it. Finish all 8 `nb-NO` pages first.

**Do not ask the fetch tool a yes/no question like "is Kitchn on this page?".** If your fetch tool takes a prompt/instruction argument, that prompt runs its own internal extraction pass _before_ you ever see the result — it will do a literal string match against exactly what you typed, so it inherits the same apostrophe/punctuation problem this skill is trying to avoid, except now it's hidden inside a tool call you can't see. Instead, always prompt the fetch tool to **transcribe every shop name and its reward line on the page, verbatim, in full** (e.g. "list every shop name and the poeng/percentage line beneath it on this page"). Do the actual name-matching yourself, in your own reasoning, against that verbatim list.

- **Match names loosely, not literally, yourself.** Shop names on this site can use typographic punctuation the user won't type — e.g. the display name is `Kitch’n` with a curly apostrophe (`’`), not `Kitchn`. When you compare the transcribed list against the target shop name, normalize both sides: lowercase, strip/normalize apostrophes (`'`/`’`/`` ` ``), strip extra whitespace and punctuation. Also try common variants (with/without spaces, `&`/`and`, `.no`/`.com` suffixes).
- Most shops earn a flat **X poeng per 100 kr** — this is already in EB, no conversion needed.
- Some shops instead show a **fixed reward** (e.g. `Tjen 250 poeng`, `Tjen 1 000 poeng`) regardless of purchase size — these aren't proportionally comparable to a percentage rate. Report the flat amount as-is and flag it as non-proportional rather than forcing a per-100-NOK comparison.
- "Doble poeng" / "Ekstra poeng" badges are time-limited promos — mention them but don't assume they're permanent.

### Step 2b — Mandatory fallback if no match was found (do not skip this)

If you scanned all 8 pages (through the `r.jina.ai/` proxy) with verbatim transcription + loose matching and still found no hit, **you are not done and must not yet report "not available through SAS."** This step is required, not optional, every single time Step 2a comes up empty:

1. Run a web search for `site:onlineshopping.flysas.com <shop name>` (also try `<shop name> flysas onlineshopping`).
2. Search results will usually surface an `en-NO` (or other `en-*`) locale URL like `https://onlineshopping.flysas.com/en-NO/shops/<slug>/<id>`. Fetch it **through the proxy** (`https://r.jina.ai/<that URL>`) — this detail page is also client-rendered, so an unproxied fetch will silently return only cookie-banner boilerplate, which looks like an empty/404 page but isn't. Note also that the URL _path segment_ is locale-dependent: `en-*` locales use `/shops/<slug>/<id>`, but `nb-NO` uses `/butikker/<slug>/<id>` for the identical page — swapping `shops`→`butikker` when you convert an `en-NO` search hit to `nb-NO` (or vice versa) avoids a false 404.
3. Only after this search has _also_ turned up nothing may you report "not available through SAS Online Shopping." State explicitly in your answer that you checked all 8 listing pages (via the rendering proxy) and ran a site-search fallback, so the user can see the negative result was verified, not just a page miss.

## Step 3 — Convert to a common basis and compare

```
SAS EB per 100 NOK   = poeng value shown (already EB)
Trumf EB-equivalent  = trumf_percentage × 13.5   (Trumf-kroner → EB conversion rate)
```

Whichever number is higher per 100 NOK wins. If the user wants the NOK value too, apply the standard EB-value assumption (1 EB ≈ 0.10 NOK, or 0.20 NOK with a 2-for-1 Companion Ticket) from the grocery/EuroBonus reference docs — but the primary answer is the EB-per-100-NOK comparison, since that's currency-neutral between the two portals.

If the shop only exists on one portal, recommend that one directly and skip the comparison math. If it exists on neither, say so plainly — don't guess a rate.

## Step 4 — Present the result

**Before writing anything below, verify you actually made a WebFetch call to the Trumf URL and a WebFetch call to at least one SAS URL in this turn, for this shop.** If you cannot point to both tool calls having happened, you are not ready to write a final answer — go back and make the missing call(s) now.

Follow Slack formatting rules: no markdown tables, no `##` headings — bold text and bullets.

Example shape (illustrative format only — "ExampleShop", "X"/"Y" are placeholders, not real data; never reuse specific numbers from this template for an actual shop):

```
*ExampleShop — affiliate comparison*

• SAS Online Shopping: X EB per 100 kr
• Trumf Netthandel: Y % Trumf-bonus → Y × 13.5 = Z EB per 100 kr

*<Portal> wins — <higher> EB vs <lower> EB per 100 kr (≈<ratio>x more).*
```

## Rules

- Never invent a rate for a shop you didn't actually find on the page — report "not found" instead.
- Never skip the Trumf lookup (Step 1) because the SAS lookup (Step 2) took a lot of effort. Both are mandatory every time, independent of how hard the other one was. A one-sided "comparison" (only SAS or only Trumf actually fetched) must not be presented as if it were a real comparison — say plainly which side you couldn't verify.
- Never reuse a specific rate/percentage/EB figure from a previous turn, from memory, or from this skill's own examples for a _different_ shop than the one it was originally fetched for. Every number in a final answer must trace back to a tool call made in the current lookup for that exact shop.
- Never report a shop as "not found on SAS Online Shopping" after checking fewer than all 8 `nb-NO/alle-butikker` pages. Checking 1 page, or checking page 1 of a different locale instead, is not a substitute and has caused false negatives before — finish all 8 first, every time.
- Never report a shop as "not available on SAS Online Shopping" without having completed Step 2b (the site-search fallback). An 8-page scan alone is not sufficient grounds for a negative result — fetch-tool summarization and punctuation mismatches have caused false negatives before.
- Always show the conversion math (Trumf % × 13.5), not just the conclusion, so the user can sanity-check it.
- Flag "Opptil" (up to) rates and fixed-point rewards as non-standard rather than comparing them at face value.
- If both portals list the shop at genuinely equal EB value, say so — don't force a winner.
