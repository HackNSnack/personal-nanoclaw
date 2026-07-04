---
name: eb-asia-routes
description: EuroBonus Asia travel reference — SkyTeam partners, hubs, EB partner award chart, OSL/CPH/ARN/TRD routing patterns, and best external tools. Use when planning any EuroBonus redemption to/from Asia, or when answering questions about which carriers/regions EB can reach. Pure knowledge skill — for live availability searches, pair with `eb-bonus-travel`.
---

# EuroBonus → Asia — Reference

Cached knowledge for EuroBonus (SAS) partner award travel to/from Asia. This skill is *static* — it does not browse the web. For live availability searches, use `eb-bonus-travel` alongside it.

## Background — SAS in SkyTeam

- SAS left Star Alliance on **31 Aug 2024** and joined **SkyTeam on 1 Sept 2024**
- Air France-KLM took a stake in SAS during the 2023 restructuring — AF/KL are the deepest non-SAS partners
- SkyTeam has 18 active carriers (as of May 2025); EuroBonus is a full SkyTeam FFP
- **Implication:** EB points can be redeemed on any SkyTeam partner, including their long-haul flights to Asia

## SkyTeam carriers relevant to Asia (sorted by usefulness for EB redemptions)

| Carrier | Code | Hub(s) | Asia reach via |
|---|---|---|---|
| Korean Air | KE | ICN | Direct from CDG, AMS, FCO, MAD, PRG; onward to NRT, HND, KIX, GMP, TPE, BKK, SGN, etc. |
| Air France | AF | CDG | CDG → PVG, PEK, CAN, HKG, NRT, HND, KIX, BKK, SIN, HAN, SGN, etc. |
| KLM | KL | AMS | AMS → PVG, PEK, CAN, HKG, TPE, NRT, HND, KIX, BKK, SIN, etc. |
| Vietnam Airlines | VN | HAN, SGN | Direct from CDG, FRA (non-SkyTeam), LHR (non-SkyTeam); CPH historically, check season |
| China Eastern | MU | PVG, SHA | Direct from CDG, AMS, MAD, FCO, PRG to PVG; onward within China/Asia |
| China Airlines | CI | TPE | Direct from AMS (SkyTeam), CDG (limited), FRA, plus strong Asia onward |
| XiamenAir | MF | XMN | Direct from AMS to XMN; onward within China |
| Garuda Indonesia | GA | CGK | DPS, KUL onward; mostly via DPS hub |
| Aeroflot (suspended) | SU | SVO | Membership suspended since April 2022 — effectively not bookable |

SAS itself: only flies OSL ↔ CPH ↔ AAL to/from Asia on its own metal — effectively **OSL ↔ PEK** as a once-daily or seasonal route (verify before assuming). All other Asia routing goes through partners.

## Origins the user can start from

| Airport | Code | Notes |
|---|---|---|
| Oslo Gardermoen | OSL | Default origin; main hub |
| Copenhagen Kastrup | CPH | SAS hub; best for KLM/AF via AMS/CDG connections |
| Stockholm Arlanda | ARN | SAS hub; good for AF/KL via CDG/AMS |
| Trondheim | TRD | Smaller; OSL/CPH/ARN connections on SAS or Widerøe |

**Best routing for Asia** generally goes via **AMS (KLM)** or **CDG (AF)** since:
- CPH–AMS and ARN–AMS are short SAS/KL hops (often under 2h)
- Both hubs have dense Asia networks
- SAS codeshares with KL on CPH–AMS–Asia, allowing single-itinerary EB booking

## EB Partner Award Chart (approximate, one-way)

These are approximate point costs for SkyTeam partner awards booked with EB points. **Always verify on sas.no or by calling SAS before booking** — pricing changes.

| Region pair | Economy | Premium Economy | Business |
|---|---|---|---|
| Scandinavia ↔ Europe | 15k–20k | n/a | 30k–40k |
| Scandinavia ↔ Middle East | 35k–55k | 55k–70k | 70k–90k |
| Scandinavia ↔ North America (East) | 40k–55k | 60k–80k | 80k–110k |
| Scandinavia ↔ Asia (Zone 5/6) | 50k–70k | 70k–95k | **85k–120k** |
| Scandinavia ↔ Asia (long, e.g. NRT/HKG) | 55k–75k | 75k–100k | 95k–130k |
| Within Asia | 15k–30k | 20k–35k | 35k–55k |

Round-trip = ~1.8–2.0x one-way (sometimes cheaper to book two one-ways than a round-trip — always check both).

**Peak vs saver:** Partner awards often have a peak surcharge (especially summer, Christmas). Off-peak / "supersaver" rates can be 30–40% lower.

**Promo pricing:** SAS runs periodic 30–50% off award-travel promos to specific regions. Check sas.no / your EB dashboard before booking at full price.

## Routing sweet spots from OSL/CPH/ARN/TRD

- **CPH → AMS (KL) → ICN (KE) → NRT/HND (KE):** classic Scandinavia-to-Japan via Seoul. Often cheapest hub-on-hub.
- **CPH → CDG (AF) → NRT/HND (AF):** direct CDG-Tokyo on Air France, often good business availability
- **CPH → AMS (KL) → TPE (KL/KE):** direct AMS-Taipei on KLM or via ICN
- **OSL → CPH → AMS → BKK (KL):** KLM direct from AMS to Bangkok
- **ARN → CDG → SIN (AF):** Air France to Singapore, often strong business award space
- **CPH → CDG → HAN (VN):** Vietnam Airlines direct from CDG to Hanoi
- **ARN → AMS → PVG (MU):** China Eastern direct from AMS

Multi-city within Asia examples:
- OSL → ICN (KE) → NRT (KE) → ICN (KE) → OSL: stays on Korean Air
- OSL → NRT (KL via AMS) → SGN (VN via HAN/SGN) → NRT (VN/JL via HND) → OSL: mixed carriers
- CPH → AMS → TPE → BKK → AMS → CPH: Taiwan + Thailand loop

## External tools — when to use each

| Tool | URL | Use for | Notes |
|---|---|---|---|
| FlightConnections | flightconnections.com | Routing discovery — what airlines fly OSL/CPH/ARN/TRD → X | Reliable from this container |
| point.me | point.me | Award cost comparison across programs | Free tier limited |
| Roame | roame.travel | Award availability + alerts | Free tier limited |
| Wikipedia (SkyTeam article) | en.wikipedia.org/wiki/SkyTeam | Member list + dates | Verify partner list |
| Wayback Machine | web.archive.org | Cached SAS pages when sas.no is blocked | Use for archived partner charts |
| seats.aero | seats.aero | Direct EB availability search | **Often Cloudflare-blocked** from this container — retry may fail |
| Flying Blue search | klm.com / airfrance.com | SkyTeam inventory view | **HTTP2 errors** in this container's browser; backup via curl |
| ExpertFlyer | expertflyer.com | Award alerts | **HTTP2 errors** in browser; reachable via curl only |
| sas.no (EuroBonus) | sas.no/eurobonus | Official partner chart + booking | **CloudFront 403** from this container — usually blocked |
| Google Flights | google.com/travel/flights | Cash price reference | Captcha-challenged; use Wayback / Wikipedia for fallback |

## Container constraints to remember

This container cannot reliably reach:
- `sas.no` / `flysas.com` (CloudFront 403 — geo/bot block)
- `klm.com` / `klm.no` (HTTP/2 protocol errors in browser)
- `seats.aero` search (Cloudflare challenge after first request)
- `google.com` / `bing.com` (captcha)

Work reliably:
- `flightconnections.com`, `point.me`, `roame.travel` (HTTP)
- `en.wikipedia.org`
- `web.archive.org`
- `duckduckgo.com` (HTML version, limited)

**If a live search fails, fall back to:**
1. Wayback Machine snapshot of sas.no EuroBonus pages
2. Wikipedia for partner/alliance info
3. Roame / point.me for award pricing data
4. The user does the sas.no search manually and pastes/screenshots results back

## Booking flow — once you find availability

1. Search availability via Flying Blue, seats.aero, or Roame (same SkyTeam inventory)
2. Note: carrier, flight number, date, fare class, points cost
3. Try to book online at sas.no — works for some partner awards
4. If sas.no can't find the partner award → call SAS EuroBonus service center in Norway (+47 648 10 500 or similar — verify current number) and ask them to ticket the partner award using EB points
5. Confirm pricing matches the chart (sometimes agents quote higher "taxes + carrier surcharges")
6. SAS may add fuel surcharges on partner awards — compare total cost to cash fare before booking

## Currency valuation reference

Rough sanity-check for EB point value (one EB point ≈ 0.005–0.015 EUR, varies by redemption):
- Asia business at 100k EB ≈ €500–1,500 value
- Asia economy at 50k EB ≈ €250–750 value
- Sweet spot: transatlantic / long-haul business in off-peak = 1.5–2.0 cents per point
- Avoid: short-haul economy redemptions (<1 cent per point)

Always compare the cash fare of the same flight to verify point value.
