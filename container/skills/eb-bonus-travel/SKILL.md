---
name: eb-bonus-travel
description: Search live EuroBonus partner award availability + cash price comparison for arbitrary origin/dest routes (supports multi-city, natural-language input). Use when the user gives a travel request like "find me Tokyo in November business class" or "OSL → NRT → SGN → OSL, October, business, 2 ppl". Always pair with `eb-asia-routes` for reference data.
allowed-tools: Bash(agent-browser:*), Bash(curl:*), Bash(echo:*), WebFetch
---

# EB Bonus Travel — Live Search

Live-search procedure for finding EuroBonus partner award availability on SkyTeam flights, with cash cost comparison and savings calculation.

**Always load `eb-asia-routes` first** for cached reference data (partners, hubs, chart, routing patterns, container constraints).

## Input parsing (natural language)

Extract these fields from the user's message. Ask the user to clarify if any required field is ambiguous.

| Field | Required | Default | Examples |
|---|---|---|---|
| Origin(s) | Yes | OSL | "Oslo", "OSL", "from CPH", "starting ARN" |
| Destination(s) | Yes | — | "Tokyo", "NRT, HND, KIX", "Bangkok and Bali" |
| Multi-city | No | No | "OSL → NRT → SGN → OSL", "Oslo to Tokyo, then Hanoi, back to Oslo" |
| Date(s) | Yes (or "flexible") | — | "Nov 15", "mid-November", "around Christmas", "next March" |
| Cabin | No | Economy | "economy", "premium economy", "business", "biz", "first" |
| Party size | No | 1 | "2 ppl", "me and my partner", "family of 4" |
| One-way vs round-trip | No | Round-trip | "one-way", "return", "RT" |

**Multi-city rules:**
- Treat each leg as a separate segment with its own origin/destination
- Allow 1–5 segments (more than that gets unwieldy — push back)
- "Back to OSL" means return to the first origin
- Within-Asia detours are fine (e.g., OSL → NRT, then NRT → SGN, then SGN → OSL)

**Date ambiguity:**
- "Around [month]" = search a 7-day window centered on the middle of that month
- "Flexible [month]" = search the entire month
- "Next [month]" = same month next year
- No date = ask user (don't guess)

## Search procedure

Execute in this order. Stop early if you get enough info.

### Step 1: Sanity-check the route

Consult `eb-asia-routes` for:
- Is the origin–destination pair physically reachable via SkyTeam partners?
- What are the typical hub routings? (CPH–AMS–ICN, OSL–CDG–NRT, etc.)
- What's the approximate EB award cost?

If the route is implausible (e.g., nonstop to a non-existent city), tell the user before searching.

### Step 2: Routing discovery (FlightConnections)

```bash
agent-browser open "https://www.flightconnections.com/from-{ORIGIN_LOWERCASE}-airport"
agent-browser snapshot -i
```

Look for direct routes from origin to destination and via 1-stop hubs. Note the airlines serving each segment.

### Step 3: Award availability — try in order (max 2 retries per site)

For each site, use the retry wrapper (see "Retry wrapper" below). If a site fails after retries, move on.

1. **Roame (`roame.travel`)** — usually accessible, has program selector. Try EuroBonus program.
2. **point.me (`point.me/search`)** — accessibility varies; mostly for inspiration / pricing reference.
3. **seats.aero** — *if accessible*, the best direct EB availability search. Often Cloudflare-blocked from this container — expect failures.
4. **Wayback Machine + sas.no snapshots** — fallback when live sites fail:
   ```bash
   curl -s "https://web.archive.org/web/2025/https://www.sas.no/eurobonus/use-points/book-bonus-trips/"
   ```
5. **Flying Blue search (KLM)** — backup for SkyTeam availability:
   ```bash
   curl -s "https://www.klm.com/home/nl/en/flights/book-a-flight/award-tickets" -I
   # Likely fails from this container; use Wayback for cached FB pages if needed
   ```

### Step 4: Cash price comparison

For the same routing found in step 3, get a cash alternative:

1. **FlightConnections** often shows cash prices for routing context
2. **Wikipedia** for typical seasonal cash ranges (e.g., "Tokyo in November from Scandinavia typically €600–1,200 economy / €1,800–3,500 business")
3. **User lookup** — if all else fails, ask the user to check Google Flights and paste the price

### Step 5: Calculate savings

```
savings_eur = cash_price_eur - (eb_points * 0.01)
# i.e., if 1 EB point ≈ 1 cent (rough benchmark)
value_per_point = cash_price_eur / eb_points
```

Compare `value_per_point` against the typical 0.5–1.5 cent-per-point range. Sweet spot = >1.0 cent/point.

## Retry wrapper

Use this Bash function for any agent-browser call that might be flaky. Max 2 retries (3 total attempts).

```bash
browser_with_retry() {
  local cmd="$1"
  local max_attempts=3
  for attempt in $(seq 1 $max_attempts); do
    result=$(eval "$cmd" 2>&1)
    if [[ $? -eq 0 ]] && \
       [[ ! "$result" =~ "ERROR" ]] && \
       [[ ! "$result" =~ "Error" ]] && \
       [[ ! "$result" =~ "denied" ]] && \
       [[ ! "$result" =~ "Captcha" ]] && \
       [[ ! "$result" =~ "HTTP2" ]]; then
      echo "$result"
      return 0
    fi
    echo "Attempt $attempt failed for: $cmd" >&2
    sleep 2
  done
  echo "All $max_attempts attempts failed for: $cmd" >&2
  return 1
}
```

Use as:
```bash
browser_with_retry "agent-browser open 'https://www.flightconnections.com/from-oslo-airport'"
```

## Output format

Return findings in this structure. Adapt detail level based on what you found.

```
*EB Bonus Travel Search — {origin} → {destination} ({dates}, {cabin})*

*Routes found:*
• {Carrier1} {flight#}: {origin} → {hub1} → {dest} — {depart}-{arrive}, {points} EB pts
• {Carrier2} {flight#}: {origin} → {hub1} → {dest} (alternative)

*Cost comparison:*
| | Award (EB) | Cash | Savings |
|---|---|---|---|
| Economy | {pts} pts | ~€{cash} | ~€{savings} |
| Business | {pts} pts | ~€{cash} | ~€{savings} |

*Point value:*
• Economy: {value} cent/point
• Business: {value} cent/point (sweet spot if >1.0)

*Booking flow:*
1. Search sas.no → if partner award visible, book online
2. If not visible → call SAS EuroBonus service center and ticket the specific flight(s) at the EB chart

*Alternative dates / routes:*
• {notes on flexibility, what other dates/carriers worked}

*Sources consulted:*
• {list of sites actually checked, with notes on which were blocked/failed}
```

If you found nothing:
- Tell the user which sites you tried
- Suggest the user try sas.no directly (since it's blocked from this container)
- Offer to set up `eb-monitor` for the route

## Common pitfalls

- **SAS award chart pricing varies** — always quote a range, not a single number
- **Fuel surcharges** — partner awards often include €200–600 in fuel surcharges per long-haul segment; include these in your comparison
- **Mixed-carrier awards** — EB allows mixing SkyTeam carriers on one ticket, but routing rules apply; multi-city works but watch for the "backtracking" penalty (some routes charge extra)
- **One-way vs round-trip** — sometimes two one-ways cost less than a round-trip, especially for off-peak dates; check both
- **Promo pricing** — SAS runs 30–50% off promos; check sas.no or your EB dashboard before paying full price
- **Lead time** — partner award availability is best 9–11 months out for premium cabins; last-minute often only economy or no award space

## Container access reminders

Sites that are commonly blocked from this container:
- `sas.no` / `flysas.com` (CloudFront 403)
- `klm.com` (HTTP/2 protocol errors)
- `seats.aero` search (Cloudflare challenge)
- `google.com` / `bing.com` (captcha)

Sites that work reliably:
- `flightconnections.com`, `point.me`, `roame.travel`
- `en.wikipedia.org`
- `web.archive.org`
- `duckduckgo.com/html`

If a search fails, use Wayback Machine for cached content, or ask the user to verify on sas.no themselves.
