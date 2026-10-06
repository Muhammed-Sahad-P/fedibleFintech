# Task 9: AI Financial Assistant — Privacy & Security Architecture

## 1. Overview & Data Minimisation Framework
The `POST /api/v1/financial-assistant` endpoint provides real-time financial health diagnostics and actionable recommendations using an LLM (Google Gemini) backed by a deterministic heuristic fallback engine.

In financial applications, **privacy and security are non-negotiable**. The AI pipeline enforces **strict data minimisation**:

```
[User Request]
  { income: 120000, expenses: 60000, savings: 300000, debt: 150000, goals: ["EMERGENCY_FUND"] }
      │
      ▼
1. Strict Schema Validation (Zod)
   - Accepts ONLY numbers and predefined enum goals.
   - Rejects arbitrary free-text notes or unstructured input fields.
      │
      ▼
2. Zero Identifier Transmission
   - User names, emails, user IDs, IP addresses, and bank account numbers are NEVER sent to the LLM.
   - The LLM receives solely an anonymized financial vector (income, expenses, debt, liquidity).
      │
      ▼
3. Zero Raw Financial Input Logging
   - Raw financial input amounts are suppressed from application log files (avoiding accidental disk/CloudWatch leakage).
      │
      ▼
4. Transmission & Storage Controls
   - TLS 1.3 encryption in transit.
   - Enterprise API terms: Customer data transmitted via the API is not used to train or fine-tune public foundation models.
      │
      ▼
5. Structured JSON Output Parsing & Fallback Engine
   - Output schema strictly enforced.
   - If the third-party LLM is unavailable or times out, the local deterministic engine generates the exact analysis seamlessly.
```

---

## 2. API Request & Response Specification

### Request (`POST /api/v1/financial-assistant`):
```json
{
  "income": 120000,
  "expenses": 60000,
  "savings": 300000,
  "debt": 150000,
  "currency": "INR",
  "financialGoals": ["EMERGENCY_FUND", "HOME_PURCHASE"]
}
```

### Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "financialHealthScore": 75,
    "riskTier": "GOOD",
    "metrics": {
      "monthlySurplus": 60000,
      "savingsRatePercentage": 50,
      "debtToIncomePercentage": 10.4,
      "emergencyFundMonths": 5
    },
    "keyInsights": [
      "Strong savings rate of 50.0%, providing excellent capital for long-term compounding.",
      "Liquid reserve of 5 months is near the recommended 6-month safety threshold."
    ],
    "actionableRecommendations": [
      "Target saving INR 60,000 in high-yield liquid instruments to complete your emergency buffer.",
      "Allocate structured monthly capital into low-volatility fixed-income instruments to lock in your future home down-payment."
    ],
    "budgetingAllocation": {
      "necessitiesPercentage": 50,
      "savingsInvestmentPercentage": 30,
      "discretionaryPercentage": 20
    },
    "dataPrivacyNotice": "Data minimisation enforced. Zero personal identifiers transmitted. TLS in transit and encryption at rest applied."
  }
}
```
