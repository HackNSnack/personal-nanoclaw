# Bill Kill Feasibility Analysis — Final Settlement

> Compiled 2026-07-04. Source: <https://billkill.no/en/pricing>, <https://billkill.no/en/faq>.
> Compares Bill Kill Master-tier fees against EuroBonus earnings on SAS Amex Premium.

---

## 1. Assumptions

| Parameter | Value | Source |
|-----------|-------|--------|
| Bill Kill Master subscription | 99 kr/month × 12 = **1,188 kr/year** | billkill.no/en/pricing ("Fra 99 kr") |
| Bill Kill invoice fee (Master) | **2.2 %** on Amex | billkill.no/en/pricing |
| Invoice volume per year (hypothetical) | **150,000 NOK** | Mathias's brief |
| Card charge on Amex (invoice × 1.022) | **153,300 NOK** | derived |
| Amex Premium earning rate | **15 EB per 100 NOK** | EuroBonus Optimization Norway.md |
| EB value — standard economy | 0.10 NOK/EB | EuroBonus Best Case Value doc |
| EB value — 2-for-1 CT (Europe) | 0.20 NOK/EB | same |
| EB value — 2-for-1 CT (Asia, baseline) | 0.27 NOK/EB | same (90,000 EB ÷ 2 = 45,000 EB/pers) |
| EB value — best case (sale + CT Asia) | 0.33 NOK/EB | same |
| Amex Premium CT threshold | **150,000 NOK** card spend | EuroBonus Optimization Norway.md |
| Asia RT cash price (base case) | **13,500 NOK** | Mathias's brief (range 10–17k) |
| Asia RT economy award (SkyTeam) | **90,000 EB** standard | SAS EuroBonus & SkyTeam Analysis.md |

**Note on subscription payment method:** Bill Kill subscriptions can *only* be paid with Visa or Mastercard (FAQ). The 1,188 kr subscription therefore does **not** earn EuroBonus. Invoice fees paid via Amex do earn EB.

**Note on Amex category restrictions:** Bill Kill's Amex-eligible invoice categories exclude clothing, food, electronics, hotels, flights, car rentals, and other merchant goods. Only utilities, insurance, rent, telecom, medical, schools, taxes, and similar service-type invoices qualify. The 150k hypothetical assumes all qualifying invoices.

---

## 2. Bill Kill Pricing Recap

| Tier | Subscription | Visa/MC fee | Amex fee | Notes |
|------|--------------|-------------|----------|-------|
| Ninja | Free | 2.7 % | **3.2 %** | Free, but worst Amex rate |
| **Master** | **99 kr/month** | **2.2 %** | **2.2 %** | Lowest fees, priority support |
| +Biz | 469 kr/month | 2.5 % | 2.5 % | B2B focus, expanded recipient list |

Master is the cheapest path to Amex-paying at 2.2 %. (Note: Ninja is free but charges 3.2 % on Amex — see §6 for comparison.)

---

## 3. Scenario A — Pure Cashback Value (Ignore CT)

Direct comparison: Bill Kill fees paid vs. EB earned (as if points are redeemed at face value).

### 3a. Cost calculation per 100 NOK invoice

| Step | Calculation | Result |
|------|-------------|--------|
| Invoice amount | — | 100.00 NOK |
| Bill Kill fee (2.2 %) | 100 × 0.022 | 2.20 NOK |
| Card charge to Amex | 100 × 1.022 | 102.20 NOK |
| Subscription amortized* | 1,188 ÷ (150,000/100) | 0.79 NOK |
| **Total Bill Kill cost per 100 NOK invoice** | | **2.99 NOK** |
| EB earned (Amex Premium) | 102.20 × 0.15 | 15.33 EB |

\* Subscription cost spread across the hypothetical 1,500 invoice-units.

### 3b. Pure cashback net per 100 NOK invoice

| EB redemption value | EB value | EB worth | Net (EB − cost) |
|---------------------|----------|----------|------------------|
| Standard economy (0.10) | 15.33 × 0.10 | 1.53 kr | **−1.46 kr** |
| CT Europe (0.20) | 15.33 × 0.20 | 3.07 kr | **+0.07 kr** |
| CT Asia (0.27) | 15.33 × 0.27 | 4.14 kr | **+1.15 kr** |
| Best case (0.33) | 15.33 × 0.33 | 5.06 kr | **+2.07 kr** |

**Conclusion A:** Pure cashback is **only barely positive** at best-case EB valuation, and **negative** under standard economy redemption. The cashback alone does not justify Bill Kill — the CT is what flips the equation.

---

## 4. Scenario B — Companion Ticket + Asia RT

The real value of routing 150k through Bill Kill is the **Companion Ticket** earned from the 150k Amex Premium spend threshold.

### 4a. CT mechanics

- Amex Premium gives **1 global CT** when card spend ≥ 150,000 NOK/year.
- Primary ticket: pay full award (90,000 EB for Asia economy RT).
- Companion ticket: **0 EB** (just pay taxes/fees).
- Total: **2 tickets for 90,000 EB** → **45,000 EB per person**.

### 4b. Standalone value of the CT (per Asia RT)

| Asia RT cash price | 1 ticket pays cash | Other ticket (CT) | CT value |
|--------------------|--------------------|-------------------|----------|
| 10,000 NOK | 10,000 kr | 0 kr | **10,000 kr** |
| **13,500 NOK (base)** | **13,500 kr** | **0 kr** | **13,500 kr** |
| 17,000 NOK | 17,000 kr | 0 kr | **17,000 kr** |

The CT alone is worth the cost of one full Asia RT ticket.

### 4c. Does Bill Kill alone fund 90,000 EB?

Bill Kill earns **22,995 EB** on the 150k hypothetical (see §5 below).

| Target | EB needed | Bill Kill contribution | Gap |
|--------|-----------|------------------------|-----|
| 1 full Asia RT standard award (1 person, no CT) | 90,000 EB | 22,995 EB (25.6 %) | 67,005 EB |
| CT: 2 tickets total | 90,000 EB | 22,995 EB (25.6 %) | 67,005 EB |
| **CT: 1 person's share** | **45,000 EB** | **22,995 EB (51.1 %)** | **22,005 EB** |
| 1 short-haul Europe RT (CT, 1 pers) | 15,000 EB | 22,995 EB (153 %) | fully funded ✅ |

So Bill Kill + Amex Premium covers ~half of one person's Asia ticket via points alone, with the CT providing the other half (one free ticket). The remaining 22,005 EB gap requires other EB sources (Trumf, Trumf Netthandel, SAS Shopping portal, or paying for non-Bill-Kill purchases with the Amex Premium).

---

## 5. Final Settlement — 150k Bill Kill Year

### 5a. Total costs

| Line item | Calculation | Cost |
|-----------|-------------|------|
| Bill Kill Master subscription | 99 × 12 | **1,188 kr** |
| Bill Kill invoice fees (Amex) | 150,000 × 0.022 | **3,300 kr** |
| **Total Bill Kill cost (year)** | | **4,488 kr** |

### 5b. Total EB earned

| Line item | Calculation | EB |
|-----------|-------------|----|
| Card spend on Amex Premium | 150,000 × 1.022 | 153,300 NOK |
| **EB earned** | 153,300 × 0.15 / 100 | **22,995 EB** |

(The 22,995 EB counts toward the Amex Premium CT qualification as part of the 153.3k Amex spend — it is *additional* to the CT.)

### 5c. EB value at different redemption rates

| Redemption scenario | Rate | EB value |
|---------------------|------|----------|
| Standard economy | 0.10 | **2,299.50 kr** |
| CT Europe | 0.20 | **4,599.00 kr** |
| CT Asia (baseline) | 0.27 | **6,208.65 kr** |
| Best case (sale + CT Asia) | 0.33 | **7,588.35 kr** |

### 5d. Net position — cashback alone (no CT counted)

| Scenario | EB value | Bill Kill cost | **Net** |
|----------|----------|----------------|---------|
| Standard economy | 2,299.50 kr | −4,488 kr | **−2,188.50 kr** |
| CT Europe | 4,599.00 kr | −4,488 kr | **+111.00 kr** |
| CT Asia baseline | 6,208.65 kr | −4,488 kr | **+1,720.65 kr** |
| Best case Asia | 7,588.35 kr | −4,488 kr | **+3,100.35 kr** |

### 5e. Net position — CT + EB value combined

This is the realistic case: assume you use the CT on the Asia RT, and redeem the 22,995 EB at Asia-CT rates.

| Asia cash price | EB value (CT Asia, 0.27) | CT value | Total benefit | Bill Kill cost | **Net** |
|------------------|---------------------------|----------|----------------|----------------|---------|
| 10,000 NOK | 6,208.65 kr | 10,000 kr | 16,208.65 kr | −4,488 kr | **+11,720.65 kr** |
| **13,500 NOK** | **6,208.65 kr** | **13,500 kr** | **19,708.65 kr** | **−4,488 kr** | **+15,220.65 kr** |
| 17,000 NOK | 6,208.65 kr | 17,000 kr | 23,208.65 kr | −4,488 kr | **+18,720.65 kr** |

Even at the **low Asia price (10k NOK)**, the strategy nets **+11,720 kr** per year. At the base case (13.5k NOK), **+15,220 kr**.

### 5f. Headline summary

> **Bill Kill Master + Amex Premium, 150k invoice volume/year → net benefit of ~+15,200 NOK** in a baseline Asia-CT scenario, dominated by the Companion Ticket value (~13.5k NOK) and supplemented by ~6.2k NOK in EB value (22,995 EB at CT-Asia rate).

---

## 6. Sensitivity & Comparison

### 6a. Bill Kill tier comparison (same 150k volume, Amex Premium)

| Tier | Subscription | Amex fee | Annual cost | EB earned | Net (CT Asia baseline) |
|------|--------------|----------|-------------|-----------|------------------------|
| Ninja | 0 kr | 3.2 % | 4,800 kr | 154,800 × 0.15 = 23,220 EB | **+15,011 kr** |
| **Master** | **1,188 kr** | **2.2 %** | **4,488 kr** | **22,995 EB** | **+15,221 kr** ✅ |
| +Biz | 5,628 kr | 2.5 % | 9,378 kr | 153,750 × 0.15 = 23,063 EB | **+9,853 kr** |

Master is the cheapest *and* the highest-net by a small margin. Ninja is very close but the higher 3.2 % Amex fee erases the subscription saving.

### 6b. Amex card comparison (Master tier, 150k volume)

| Card | Annual fee | Earning rate | EB earned | Net (CT Asia, fees incl.) |
|------|-----------|--------------|-----------|---------------------------|
| Amex Premium | 1,620 kr | 15 EB/100 kr | 22,995 EB | **+15,221 kr** (baseline) |
| Amex Elite | ~5,400 kr | 20 EB/100 kr | 30,660 EB | **+19,498 kr** |

**Elite would yield ~4,300 kr more per year** at the cost of an extra ~3,800 kr in card fees — net positive by ~500 kr, plus the second CT (at 300k threshold) and Priority Pass unlimited. Worth modelling if Mathias already spends 300k+/year on the card. (Premium modelling is the base case per the brief.)

### 6c. Invoice volume sensitivity (Master + Amex Premium)

| Invoice volume | Fees | EB earned | CT unlocked? | Net (CT Asia, 13.5k trip) |
|----------------|------|-----------|---------------|---------------------------|
| 50,000 kr | 1,100 + 1,188 = 2,288 kr | 7,665 EB | ❌ (only 51.1k card spend) | **+2,282 kr** (cashback only) |
| 100,000 kr | 2,200 + 1,188 = 3,388 kr | 15,330 EB | ❌ (102.2k) | **+5,251 kr** (cashback only) |
| **150,000 kr** | **3,300 + 1,188 = 4,488 kr** | **22,995 EB** | ✅ | **+15,221 kr** (CT + EB) |
| 200,000 kr | 4,400 + 1,188 = 5,588 kr | 30,660 EB | ✅ | **+16,121 kr** |
| 300,000 kr | 6,600 + 1,188 = 7,788 kr | 45,990 EB | ✅ (2× CT on Elite only) | **+17,021 kr** |

The CT is the cliff — going from 100k → 150k volume unlocks +9,970 kr of value at zero extra fee per kr. Going beyond 150k has diminishing returns.

### 6d. Subscription frequency sensitivity

If "Fra 99 kr" is interpreted as **annual** instead of monthly:

| Interpretation | Annual subscription | Total cost | Net (CT Asia baseline) |
|----------------|---------------------|------------|------------------------|
| Monthly (assumed) | 1,188 kr | 4,488 kr | **+15,221 kr** |
| Annual | 99 kr | 3,399 kr | **+16,310 kr** |

The 99 kr/month assumption is the conservative one — Bill Kill's app-store competitors are all monthly subscriptions, and the FAQ phrasing ("as Master you unlock curated offers") suggests recurring. If the FAQ turns out to mean annual, the math is even more favourable. Worth confirming in-app before committing.

---

## 7. Risks & Caveats

1. **Amex category restrictions.** Bill Kill's Amex merchant list excludes food, clothing, electronics, hotels, flights, cars, etc. To hit 150k/year on Amex-eligible invoices alone, Mathias needs to have substantial spend on utilities, insurance, rent, telecom, medical, schools, taxes, memberships, etc. Typical Norwegian household eligible spend is probably 60–100k/year — hitting 150k may require deliberate effort or routing borderline invoices through Visa/MC at higher fee tiers.
2. **Subscription must be paid with Visa/MC.** The 1,188 kr subscription doesn't earn EB. If a Visa/MC with EB earning is used (e.g., SAS Mastercard Premium at 15 EB/100 kr domestic), an extra ~178 EB/year partially offsets this.
3. **Zen points offset.** Bill Kill Master earns Zen points convertible to fee credit (rate not quantified in FAQ — would need in-app confirmation). Could reduce effective fee by 5–15 %.
4. **Cash-flow timing.** Bill Kill charges the card on the invoice due date; the recipient is paid 1–3 business days later. No cash-flow advantage over direct debit, but no disadvantage either.
5. **Award availability.** CT must be redeemed against actual award seat availability — Asia RT in peak season may require booking 330+ days ahead. Same constraint as any award booking.
6. **Status points.** Amex Premium does *not* earn status points from card spend (only Amex Elite does — 6 nivåpoeng per 100 kr). Bill Kill volume therefore doesn't help reach SAS Gold/Diamond status. Worth noting if Mathias is working toward status.
7. **CT eligibility vs existing spend.** If Mathias already spends ≥ 150k/year on the Amex Premium naturally (groceries, gas, etc.), the CT is happening anyway — Bill Kill is purely *additional* EB on top, not the CT catalyst. In that case, the relevant comparison is just §5d (cashback without counting the CT): +111 kr (CT Europe) to +3,100 kr (best case Asia) per year. Still slightly positive, but a much thinner justification.

---

## 8. Verdict

**Bill Kill Master + Amex Premium is a clear win at 150k invoice volume/year**, with net benefit ranging from **+11,720 kr** (low Asia price) to **+18,720 kr** (high Asia price) in the base case where the Companion Ticket is used for an Asia round-trip.

The strategy is most powerful when:
- Mathias would *not* otherwise hit the 150k Amex Premium spend threshold (Bill Kill becomes the CT catalyst — high value).
- He has a realistic 150k of Amex-eligible invoices (utilities, insurance, rent, telecom, medical, schools, taxes).
- He's actually planning to use the CT for an Asia trip (or any other long-haul where the cash price is high).

If the 150k threshold is already met without Bill Kill, the standalone cashback math is break-even (CT Europe rate) to modestly positive (CT Asia / best case), and the value proposition is much thinner — likely not worth the hassle unless the Zen-points offset is material.

**Recommended next step:** Confirm in-app whether the 99 kr Master subscription is monthly or annual (impacts ~1,089 kr/year), and audit what fraction of typical annual invoice volume is Amex-eligible per Bill Kill's category list.

---

*See also: [EuroBonus Optimization Norway.md](./EuroBonus%20Optimization%20Norway.md) for card and partner reference; [EuroBonus Best Case Value — Sale Awards + Companion Ticket.md](./EuroBonus%20Best%20Case%20Value%20%E2%80%94%20Sale%20Awards%20+%20Companion%20Ticket.md) for the EB point-value framework used here.*
