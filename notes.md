# Notes

## Assumptions
- The user wants a research and execution-support dashboard, not an exchange-connected execution bot.
- Public data is acceptable for v2 even though it is noisier than premium feeds.
- Local browser persistence is enough for trade journal v1/v2.

## Risks
- Binance or CoinGecko public endpoints may rate-limit.
- Frontend-only fetching can hit CORS or network policy issues in some environments.
- Strategy scoring is heuristic, not statistically validated.

## Open questions
- Should v3 add a small backend cache/proxy layer?
- Should journal entries sync to SQLite/Postgres instead of localStorage?
- Should sector rotation be defined by manual watchlists or live CoinGecko categories?
