---
name: eb-monitor
description: Set up recurring checks on EuroBonus partner award availability for a watchlist of routes. Use when the user wants to monitor specific routes/destinations over time (e.g., "ping me when there's business-class award space OSL→NRT in October"). Pairs with `eb-asia-routes` (reference) and `eb-bonus-travel` (live-search procedure).
allowed-tools: Bash(agent-browser:*), Bash(curl:*), Bash(echo:*), WebFetch
---

# EB Monitor — Recurring Watchlist

Procedure for setting up recurring award-availability checks on a user-defined watchlist of EB routes. Always load `eb-asia-routes` for cached reference data and `eb-bonus-travel` for the live-search procedure.

## Watchlist structure

The watchlist is a JSON object stored in the agent's memory (e.g., `eb-watchlist.json` in workspace). Schema:

```json
{
  "name": "Asia Q4 2026",
  "created": "2026-07-04",
  "owner": "Mathias",
  "routes": [
    {
      "id": "osl-nrt-nov-biz",
      "origin": "OSL",
      "destination": "NRT",
      "date_range": {"start": "2026-11-01", "end": "2026-11-30"},
      "cabin": "business",
      "party_size": 1,
      "max_points": 110000,
      "preferred_carriers": ["KE", "KL", "AF"],
      "preferred_hubs": ["AMS", "CDG", "ICN"]
    }
  ],
  "check_frequency": "weekly",
  "notify_only_when": "availability_found",
  "last_checked": null,
  "last_alerted": null
}
```

Field rules:
- `date_range.start` / `end` — inclusive; the check samples 3–5 dates within the window
- `max_points` — only alert if award cost ≤ this
- `preferred_carriers` — filter results (empty = any SkyTeam)
- `preferred_hubs` — preference (empty = any)
- `check_frequency` — `daily`, `weekly` (recommended), `biweekly`, or cron-style
- `notify_only_when` — `availability_found` (default — quiet when nothing's there) or `always`

## How to use this skill

When the user invokes `eb-monitor`:

1. **First-time setup:**
   - Ask the user for watchlist criteria (origins, destinations, dates, cabins, max points)
   - Confirm the schedule cadence (weekly recommended; daily eats API credits and rate-limits sources)
   - Write the JSON to `/workspace/agent/eb-watchlist.json` (or similar)
   - Set up the schedule via the platform's scheduling tool (e.g., `schedule_task`)

2. **Each scheduled run:**
   - Load the watchlist
   - For each route entry, run the `eb-bonus-travel` search procedure (with retry wrapper)
   - Collect findings
   - Apply the notify policy:
     - `availability_found` → only send message if any route has award space ≤ max_points
     - `always` → send a weekly digest regardless
   - Update `last_checked` in the watchlist
   - Include: routes checked, sites queried, what was/wasn't accessible, results found, next check ETA

3. **Modifying the watchlist:**
   - Add/remove routes
   - Change max_points
   - Pause/resume
   - Cancel entirely

All three modifications can be done via `schedule_task` companion (e.g., `update_task`, `pause_task`, `cancel_task`).

## Wake conditions — when to alert the user

To minimize noise, only alert when:
- Award space was found within the user's `max_points` budget
- The route matches the user's `preferred_carriers` (if set)
- The dates are within the user's `date_range`
- It's the first time that specific (route, date, cabin) combination has been seen (dedupe across runs)

If nothing matches, just update `last_checked` and stay silent.

## Sleep / cadence guidance

- **Weekly** (Mondays) is the right default for award monitoring — award space changes are slow
- **Daily** is too noisy — most sites rate-limit after a few requests
- **Biweekly** is fine if the user is flexible on dates
- **Monthly** is too slow for short windows (e.g., "next month's flights")

Avoid more than a few checks per day — most APIs have rate limits, and frequent checks add no value (award space doesn't update that often).

## How to actually set up the schedule

When the user approves a watchlist, use `schedule_task`:

```
schedule_task({
  prompt: "Run eb-monitor check on the watchlist. For each route, use eb-bonus-travel to search award availability. Apply the notify_only_when policy. Update last_checked in eb-watchlist.json. Send findings via send_message with final: true.",
  recurrence: "0 8 * * 1",  // weekly Monday 08:00 user-local
  script: "<optional pre-check script>"  // see below
})
```

For pre-check scripts (saves API credits by only waking the agent when there's something to report):

```bash
# Example: only wake if Roame's free status API says a watched route changed
# (Roame doesn't expose a free status API, so this is illustrative)
bash -c '
  changed=$(curl -s "https://api.example.com/watched-routes" | jq ".changed")
  echo "{\"wakeAgent\": $changed, \"data\": ...}"
'
```

If a suitable pre-check script isn't available, just use the prompt directly — the agent can run the full check. Note that running the agent weekly is fine but daily is costly.

## First-run checklist

When a user first invokes `eb-monitor`:

- [ ] Confirm watchlist routes with the user
- [ ] Confirm cadence (default: weekly)
- [ ] Confirm notify policy (default: only on availability)
- [ ] Confirm point budget per route
- [ ] Write watchlist to `/workspace/agent/eb-watchlist.json`
- [ ] Note watchlist path + schedule in `CLAUDE.local.md` (memory)
- [ ] Set up `schedule_task`
- [ ] Send the user a confirmation message with the schedule ID and first check ETA

## Memory / persistence

When the watchlist is created or modified, append a note to `CLAUDE.local.md`:

```
## EB Watchlist
- Path: /workspace/agent/eb-watchlist.json
- Schedule ID: <from schedule_task>
- Cadence: <e.g. weekly Mondays 08:00>
- Notify policy: <availability_found | always>
```

This survives across sessions — the next time the user invokes `eb-monitor` or asks about EB travel, the agent knows about the watchlist.

## Container constraints reminder

Same as `eb-bonus-travel` — `sas.no`, `klm.com`, `seats.aero` search, and major search engines are flaky from this container. Always have Wayback / Wikipedia / Roame / point.me as fallbacks.

If most sites fail in a given week, fall back to:
1. Run the search on whatever sites work (Roame, point.me, FlightConnections)
2. If nothing found, send a brief "checked N routes, sites flaky this week, retrying next week" message
3. Don't burn retries fighting Cloudflare — let next week's run try again
