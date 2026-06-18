# Trumf → EuroBonus Shop Analysis — with SAS Amex Premium Stacking

> Compiled 2026-06-18. Builds on the base [Trumf-EuroBonus-Shop-Analysis.md](./Trumf-EuroBonus-Shop-Analysis.md) document, adding the **SAS Amex Premium** card earnings (15 EB/100 NOK on all purchases).

---

## Methodology & Formulas

### Stacking strategy

When you shop via Trumf Netthandel AND pay with SAS Amex Premium, you earn points from **both** sources simultaneously:

```
Trumf EB  = (NOK spent × Trumf bonus rate) × 13.5
Amex EB   = NOK spent × 0.15  (15 EB per 100 NOK)
Total EB  = Trumf EB + Amex EB
```

### Standard redemption scenario

```
Step 1: Trumf-kroner    = Amount × Trumf rate (%)
Step 2: Trumf → EB      = Trumf-kroner × 13.5
Step 3: Amex Premium EB = Amount × 15 / 100
Step 4: Total EB        = Trumf EB + Amex EB
Step 5: NOK savings     = Total EB × 0.10  (1 EB ≈ 0.10 NOK in economy)
Step 6: Effective cost  = Amount − NOK savings
```

### 2-for-1 (Companion Ticket) scenario

With a companion ticket, EB point value doubles (2 tickets for the points of 1):

```
Step 5 (2-for-1): NOK savings = Total EB × 0.20
```

### EB point value assumption

**1 EB ≈ 0.10 NOK** for economy redemptions (typical 30,000 pts ≈ 3,000 NOK round-trip Europe). Conservative estimate.

---

## Shop Analysis

### 1. Blivakker — 3.1% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 3.1% | 3.10 Trumf-kroner |
| Trumf → EB | 3.10 × 13.5 | 41.85 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 41.85 + 15.00 | **56.85 EB** |
| Savings (standard) | 56.85 × 0.10 | 5.69 NOK |
| **Effective cost (standard)** | 100 − 5.69 | **94.31 NOK** |
| Savings (2-for-1) | 56.85 × 0.20 | 11.37 NOK |
| **Effective cost (2-for-1)** | 100 − 11.37 | **88.63 NOK** |

### 2. Proshop — Opptil 3.7% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 3.7% | 3.70 Trumf-kroner |
| Trumf → EB | 3.70 × 13.5 | 49.95 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 49.95 + 15.00 | **64.95 EB** |
| Savings (standard) | 64.95 × 0.10 | 6.50 NOK |
| **Effective cost (standard)** | 100 − 6.50 | **93.50 NOK** |
| Savings (2-for-1) | 64.95 × 0.20 | 12.99 NOK |
| **Effective cost (2-for-1)** | 100 − 12.99 | **87.01 NOK** |

### 3. Vita — 4.0% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 4.0% | 4.00 Trumf-kroner |
| Trumf → EB | 4.00 × 13.5 | 54.00 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 54.00 + 15.00 | **69.00 EB** |
| Savings (standard) | 69.00 × 0.10 | 6.90 NOK |
| **Effective cost (standard)** | 100 − 6.90 | **93.10 NOK** |
| Savings (2-for-1) | 69.00 × 0.20 | 13.80 NOK |
| **Effective cost (2-for-1)** | 100 − 13.80 | **86.20 NOK** |

### 4. Scandic Hotels — 3.1% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 3.1% | 3.10 Trumf-kroner |
| Trumf → EB | 3.10 × 13.5 | 41.85 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 41.85 + 15.00 | **56.85 EB** |
| Savings (standard) | 56.85 × 0.10 | 5.69 NOK |
| **Effective cost (standard)** | 100 − 5.69 | **94.31 NOK** |
| Savings (2-for-1) | 56.85 × 0.20 | 11.37 NOK |
| **Effective cost (2-for-1)** | 100 − 11.37 | **88.63 NOK** |

**Note:** Also earn 500 EB/night directly from Scandic — the Trumf + Amex is *on top*.

### 5. Kitchn — 3.1% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 3.1% | 3.10 Trumf-kroner |
| Trumf → EB | 3.10 × 13.5 | 41.85 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 41.85 + 15.00 | **56.85 EB** |
| Savings (standard) | 56.85 × 0.10 | 5.69 NOK |
| **Effective cost (standard)** | 100 − 5.69 | **94.31 NOK** |
| Savings (2-for-1) | 56.85 × 0.20 | 11.37 NOK |
| **Effective cost (2-for-1)** | 100 − 11.37 | **88.63 NOK** |

### 6. NordicFeel — 4.6% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 4.6% | 4.60 Trumf-kroner |
| Trumf → EB | 4.60 × 13.5 | 62.10 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 62.10 + 15.00 | **77.10 EB** |
| Savings (standard) | 77.10 × 0.10 | 7.71 NOK |
| **Effective cost (standard)** | 100 − 7.71 | **92.29 NOK** |
| Savings (2-for-1) | 77.10 × 0.20 | 15.42 NOK |
| **Effective cost (2-for-1)** | 100 − 15.42 | **84.58 NOK** |

### 7. Bakeren og Kokken — 3.1% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 3.1% | 3.10 Trumf-kroner |
| Trumf → EB | 3.10 × 13.5 | 41.85 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 41.85 + 15.00 | **56.85 EB** |
| Savings (standard) | 56.85 × 0.10 | 5.69 NOK |
| **Effective cost (standard)** | 100 − 5.69 | **94.31 NOK** |
| Savings (2-for-1) | 56.85 × 0.20 | 11.37 NOK |
| **Effective cost (2-for-1)** | 100 − 11.37 | **88.63 NOK** |

### 8. VY Express — 2.7% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 2.7% | 2.70 Trumf-kroner |
| Trumf → EB | 2.70 × 13.5 | 36.45 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 36.45 + 15.00 | **51.45 EB** |
| Savings (standard) | 51.45 × 0.10 | 5.15 NOK |
| **Effective cost (standard)** | 100 − 5.15 | **94.85 NOK** |
| Savings (2-for-1) | 51.45 × 0.20 | 10.29 NOK |
| **Effective cost (2-for-1)** | 100 − 10.29 | **89.71 NOK** |

### 9. Tilbords — 3.1% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 3.1% | 3.10 Trumf-kroner |
| Trumf → EB | 3.10 × 13.5 | 41.85 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 41.85 + 15.00 | **56.85 EB** |
| Savings (standard) | 56.85 × 0.10 | 5.69 NOK |
| **Effective cost (standard)** | 100 − 5.69 | **94.31 NOK** |
| Savings (2-for-1) | 56.85 × 0.20 | 11.37 NOK |
| **Effective cost (2-for-1)** | 100 − 11.37 | **88.63 NOK** |

### 10. Babyshop.no — 4.6% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 4.6% | 4.60 Trumf-kroner |
| Trumf → EB | 4.60 × 13.5 | 62.10 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 62.10 + 15.00 | **77.10 EB** |
| Savings (standard) | 77.10 × 0.10 | 7.71 NOK |
| **Effective cost (standard)** | 100 − 7.71 | **92.29 NOK** |
| Savings (2-for-1) | 77.10 × 0.20 | 15.42 NOK |
| **Effective cost (2-for-1)** | 100 − 15.42 | **84.58 NOK** |

### 11. Stormberg — 6.2% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 6.2% | 6.20 Trumf-kroner |
| Trumf → EB | 6.20 × 13.5 | 83.70 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 83.70 + 15.00 | **98.70 EB** |
| Savings (standard) | 98.70 × 0.10 | 9.87 NOK |
| **Effective cost (standard)** | 100 − 9.87 | **90.13 NOK** |
| Savings (2-for-1) | 98.70 × 0.20 | 19.74 NOK |
| **Effective cost (2-for-1)** | 100 − 19.74 | **80.26 NOK** |

### 12. Vertical Playground / VPG — Opptil 6.2% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 6.2% | 6.20 Trumf-kroner |
| Trumf → EB | 6.20 × 13.5 | 83.70 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 83.70 + 15.00 | **98.70 EB** |
| Savings (standard) | 98.70 × 0.10 | 9.87 NOK |
| **Effective cost (standard)** | 100 − 9.87 | **90.13 NOK** |
| Savings (2-for-1) | 98.70 × 0.20 | 19.74 NOK |
| **Effective cost (2-for-1)** | 100 − 19.74 | **80.26 NOK** |

### 13. Gullfunn — 5.4% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 5.4% | 5.40 Trumf-kroner |
| Trumf → EB | 5.40 × 13.5 | 72.90 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 72.90 + 15.00 | **87.90 EB** |
| Savings (standard) | 87.90 × 0.10 | 8.79 NOK |
| **Effective cost (standard)** | 100 − 8.79 | **91.21 NOK** |
| Savings (2-for-1) | 87.90 × 0.20 | 17.58 NOK |
| **Effective cost (2-for-1)** | 100 − 17.58 | **82.42 NOK** |

### 14. Lampegiganten — 10.1% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 10.1% | 10.10 Trumf-kroner |
| Trumf → EB | 10.10 × 13.5 | 136.35 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 136.35 + 15.00 | **151.35 EB** |
| Savings (standard) | 151.35 × 0.10 | 15.14 NOK |
| **Effective cost (standard)** | 100 − 15.14 | **84.86 NOK** |
| Savings (2-for-1) | 151.35 × 0.20 | 30.27 NOK |
| **Effective cost (2-for-1)** | 100 − 30.27 | **69.73 NOK** |

### 15. Helly Hansen — Opptil 6.2% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 6.2% | 6.20 Trumf-kroner |
| Trumf → EB | 6.20 × 13.5 | 83.70 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 83.70 + 15.00 | **98.70 EB** |
| Savings (standard) | 98.70 × 0.10 | 9.87 NOK |
| **Effective cost (standard)** | 100 − 9.87 | **90.13 NOK** |
| Savings (2-for-1) | 98.70 × 0.20 | 19.74 NOK |
| **Effective cost (2-for-1)** | 100 − 19.74 | **80.26 NOK** |

### 16. LEGO — 2.3% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 2.3% | 2.30 Trumf-kroner |
| Trumf → EB | 2.30 × 13.5 | 31.05 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 31.05 + 15.00 | **46.05 EB** |
| Savings (standard) | 46.05 × 0.10 | 4.61 NOK |
| **Effective cost (standard)** | 100 − 4.61 | **95.39 NOK** |
| Savings (2-for-1) | 46.05 × 0.20 | 9.21 NOK |
| **Effective cost (2-for-1)** | 100 − 9.21 | **90.79 NOK** |

### 17. Brilleland — 4.6% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 4.6% | 4.60 Trumf-kroner |
| Trumf → EB | 4.60 × 13.5 | 62.10 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 62.10 + 15.00 | **77.10 EB** |
| Savings (standard) | 77.10 × 0.10 | 7.71 NOK |
| **Effective cost (standard)** | 100 − 7.71 | **92.29 NOK** |
| Savings (2-for-1) | 77.10 × 0.20 | 15.42 NOK |
| **Effective cost (2-for-1)** | 100 − 15.42 | **84.58 NOK** |

### 18. eBay — 1.0% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 1.0% | 1.00 Trumf-kroner |
| Trumf → EB | 1.00 × 13.5 | 13.50 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 13.50 + 15.00 | **28.50 EB** |
| Savings (standard) | 28.50 × 0.10 | 2.85 NOK |
| **Effective cost (standard)** | 100 − 2.85 | **97.15 NOK** |
| Savings (2-for-1) | 28.50 × 0.20 | 5.70 NOK |
| **Effective cost (2-for-1)** | 100 − 5.70 | **94.30 NOK** |

### 19. Devold — 6.2% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 6.2% | 6.20 Trumf-kroner |
| Trumf → EB | 6.20 × 13.5 | 83.70 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 83.70 + 15.00 | **98.70 EB** |
| Savings (standard) | 98.70 × 0.10 | 9.87 NOK |
| **Effective cost (standard)** | 100 − 9.87 | **90.13 NOK** |
| Savings (2-for-1) | 98.70 × 0.20 | 19.74 NOK |
| **Effective cost (2-for-1)** | 100 − 19.74 | **80.26 NOK** |

### 20. SillySanta — 9.3% Trumf

| Step | Calculation | Result |
|------|------------|--------|
| Spend | 100 NOK | 100 NOK |
| Trumf bonus | 100 × 9.3% | 9.30 Trumf-kroner |
| Trumf → EB | 9.30 × 13.5 | 125.55 EB |
| Amex Premium EB | 100 × 0.15 | 15.00 EB |
| **Total EB** | 125.55 + 15.00 | **140.55 EB** |
| Savings (standard) | 140.55 × 0.10 | 14.06 NOK |
| **Effective cost (standard)** | 100 − 14.06 | **85.94 NOK** |
| Savings (2-for-1) | 140.55 × 0.20 | 28.11 NOK |
| **Effective cost (2-for-1)** | 100 − 28.11 | **71.89 NOK** |

---

## Summary: Ranked by Effective Cost

### Standard redemption

| Rank | Shop | Trumf % | Trumf EB | Amex EB | Total EB | Eff. Cost |
|------|------|---------|----------|---------|----------|-----------|
| 1 | Lampegiganten | 10.1% | 136.35 | 15.00 | 151.35 | **84.86 kr** |
| 2 | SillySanta | 9.3% | 125.55 | 15.00 | 140.55 | **85.94 kr** |
| 3 | Stormberg | 6.2% | 83.70 | 15.00 | 98.70 | **90.13 kr** |
| 4 | VPG | 6.2% | 83.70 | 15.00 | 98.70 | **90.13 kr** |
| 5 | Helly Hansen | 6.2% | 83.70 | 15.00 | 98.70 | **90.13 kr** |
| 6 | Devold | 6.2% | 83.70 | 15.00 | 98.70 | **90.13 kr** |
| 7 | Gullfunn | 5.4% | 72.90 | 15.00 | 87.90 | **91.21 kr** |
| 8 | NordicFeel | 4.6% | 62.10 | 15.00 | 77.10 | **92.29 kr** |
| 9 | Babyshop | 4.6% | 62.10 | 15.00 | 77.10 | **92.29 kr** |
| 10 | Brilleland | 4.6% | 62.10 | 15.00 | 77.10 | **92.29 kr** |
| 11 | Vita | 4.0% | 54.00 | 15.00 | 69.00 | **93.10 kr** |
| 12 | Proshop | 3.7% | 49.95 | 15.00 | 64.95 | **93.50 kr** |
| 13 | Blivakker | 3.1% | 41.85 | 15.00 | 56.85 | **94.31 kr** |
| 14 | Scandic | 3.1% | 41.85 | 15.00 | 56.85 | **94.31 kr** |
| 15 | Kitchn | 3.1% | 41.85 | 15.00 | 56.85 | **94.31 kr** |
| 16 | Bakeren og Kokken | 3.1% | 41.85 | 15.00 | 56.85 | **94.31 kr** |
| 17 | Tilbords | 3.1% | 41.85 | 15.00 | 56.85 | **94.31 kr** |
| 18 | VY Express | 2.7% | 36.45 | 15.00 | 51.45 | **94.85 kr** |
| 19 | LEGO | 2.3% | 31.05 | 15.00 | 46.05 | **95.39 kr** |
| 20 | eBay | 1.0% | 13.50 | 15.00 | 28.50 | **97.15 kr** |

### 2-for-1 Companion Ticket

| Rank | Shop | Trumf % | Trumf EB | Amex EB | Total EB | Eff. Cost |
|------|------|---------|----------|---------|----------|-----------|
| 1 | Lampegiganten | 10.1% | 136.35 | 15.00 | 151.35 | **69.73 kr** |
| 2 | SillySanta | 9.3% | 125.55 | 15.00 | 140.55 | **71.89 kr** |
| 3 | Stormberg | 6.2% | 83.70 | 15.00 | 98.70 | **80.26 kr** |
| 4 | VPG | 6.2% | 83.70 | 15.00 | 98.70 | **80.26 kr** |
| 5 | Helly Hansen | 6.2% | 83.70 | 15.00 | 98.70 | **80.26 kr** |
| 6 | Devold | 6.2% | 83.70 | 15.00 | 98.70 | **80.26 kr** |
| 7 | Gullfunn | 5.4% | 72.90 | 15.00 | 87.90 | **82.42 kr** |
| 8 | NordicFeel | 4.6% | 62.10 | 15.00 | 77.10 | **84.58 kr** |
| 9 | Babyshop | 4.6% | 62.10 | 15.00 | 77.10 | **84.58 kr** |
| 10 | Brilleland | 4.6% | 62.10 | 15.00 | 77.10 | **84.58 kr** |
| 11 | Vita | 4.0% | 54.00 | 15.00 | 69.00 | **86.20 kr** |
| 12 | Proshop | 3.7% | 49.95 | 15.00 | 64.95 | **87.01 kr** |
| 13 | Blivakker | 3.1% | 41.85 | 15.00 | 56.85 | **88.63 kr** |
| 14 | Scandic | 3.1% | 41.85 | 15.00 | 56.85 | **88.63 kr** |
| 15 | Kitchn | 3.1% | 41.85 | 15.00 | 56.85 | **88.63 kr** |
| 16 | Bakeren og Kokken | 3.1% | 41.85 | 15.00 | 56.85 | **88.63 kr** |
| 17 | Tilbords | 3.1% | 41.85 | 15.00 | 56.85 | **88.63 kr** |
| 18 | VY Express | 2.7% | 36.45 | 15.00 | 51.45 | **89.71 kr** |
| 19 | LEGO | 2.3% | 31.05 | 15.00 | 46.05 | **90.79 kr** |
| 20 | eBay | 1.0% | 13.50 | 15.00 | 28.50 | **94.30 kr** |

---

## Comparison: With vs Without Amex Premium

### How much does Amex Premium add?

The 15 EB/100 NOK from Amex Premium is a **flat addition** across all shops — the variation comes from the Trumf rate:

| Scenario | Best shop (Lampegiganten) | Worst shop (eBay) | Average shop (3.1%) |
|----------|--------------------------|-------------------|---------------------|
| Trumf only (standard) | 86.36 kr | 98.65 kr | 95.81 kr |
| + Amex Premium (standard) | 84.86 kr | 97.15 kr | 94.31 kr |
| **Improvement** | **−1.50 kr** | **−1.50 kr** | **−1.50 kr** |
| Trumf only (2-for-1) | 72.73 kr | 97.30 kr | 91.63 kr |
| + Amex Premium (2-for-1) | 69.73 kr | 94.30 kr | 88.63 kr |
| **Improvement (2-for-1)** | **−3.00 kr** | **−3.00 kr** | **−3.00 kr** |

Amex Premium always adds exactly **1.50 kr savings per 100 kr spent** (standard) or **3.00 kr** (2-for-1), since 15 EB × 0.10 = 1.50 NOK and 15 EB × 0.20 = 3.00 NOK.

### Value of Amex Premium alone (no Trumf)

If you don't shop via Trumf Netthandel but still pay with Amex Premium:
- **Standard:** 100 kr → 15 EB → 1.50 kr saved → **98.50 kr effective**
- **2-for-1:** 100 kr → 15 EB → 3.00 kr saved → **97.00 kr effective**

---

## Key Takeaways

1. **Lampegiganten (10.1% + Amex)** is the king: **84.86 kr** effective (standard) or **69.73 kr** (2-for-1) — that's a ~30% effective discount.

2. **SillySanta (9.3% + Amex)** is close behind: **85.94 kr** / **71.89 kr**.

3. **The 6.2% cluster** (Stormberg, VPG, Helly Hansen, Devold) all land at **90.13 kr** / **80.26 kr** — solid returns for outdoor/sport gear.

4. **Adding Amex Premium is always worth it** — it adds 1.50 kr savings per 100 kr flat (3 kr with 2-for-1). No downside, Amex Premium has 1,620 kr/year fee, so spending ~108,000 kr/year via Amex Premium covers the fee from EB value alone (before counting Trumf earnings, insurance, Companion Ticket, etc.).

5. **Max stack for these shops:** Trumf Netthandel click-through + SAS Amex Premium payment = Trumf EB + 15 EB/100 kr.

---

*See also: [Trumf-EuroBonus-Shop-Analysis.md](./Trumf-EuroBonus-Shop-Analysis.md) for the base analysis without Amex, and [EuroBonus Optimization Norway.md](./EuroBonus%20Optimization%20Norway.md) for the full reference guide.*
