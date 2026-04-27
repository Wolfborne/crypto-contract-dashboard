# crypto-contract-dashboard workspace

This repository currently contains the working tree for **Crypto Contract Dashboard MVP**.

## Primary project

The main app lives here:

- `products/crypto-contract-dashboard`

Project README:

- `products/crypto-contract-dashboard/README.md`

## What it is

A human-assisted crypto contract trading cockpit:

- market data → signals → readiness → risk filter → Feishu alerts → human decision
- designed for **manual review and small-size discretionary execution**
- not an auto-trading engine

## Local run

```bash
cd products/crypto-contract-dashboard
npm install
npm run dev
```

Default ports:

- web: `4173`
- local server: `4174`

## Secrets

Do not commit real secrets.

Use:

- `products/crypto-contract-dashboard/.env.example`
- local `.env`
- deployment environment variables

Webhook-related secrets such as `FEISHU_WEBHOOK_URL` / `LARK_WEBHOOK_URL` should never be committed in plaintext.

## Notes

This repo may also contain workspace-level files and adjacent experiments during development.
If you only care about the dashboard app, start from `products/crypto-contract-dashboard`.
