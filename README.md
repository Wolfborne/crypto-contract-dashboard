# Crypto Contract Dashboard

A human-assisted crypto contract trading cockpit for signal review, readiness checks, risk filtering, and Feishu alert delivery.

## What this project is

This project is designed as an **assisted trading dashboard**, not an auto-trading engine.

Its job is to compress the following workflow into one place:

> market data → signal generation → readiness evaluation → risk filtering → Feishu alerts → human review

The goal is to help an operator quickly decide:

- whether new risk can be added
- which opportunities deserve attention first
- whether a setup is observation-only, paper-only, small-size, or ready for manual execution
- what the suggested entry / stop / TP / risk budget looks like

## Core capabilities

- signal shortlist and top candidates
- readiness classification and explanation
- risk mode (`NORMAL / RISK_OFF / HARD_STOP`)
- suggested risk budget and notional sizing
- Feishu webhook notifications
- Moonshot radar for high-momentum candidates
- alert queue / retry / digest visibility
- paper-trading support for observation and review

## What this project is not

This repository does **not** aim to provide:

- automatic order execution
- exchange API trading bots
- unattended live trading
- a complete research platform for every workflow

This is a **human-in-the-loop decision cockpit**.

## Tech stack

- React
- TypeScript
- Vite
- Express

## Local development

Install dependencies:

```bash
npm install
```

Start web app + local server:

```bash
npm run dev
```

Default ports:

- web: `4173`
- local server: `4174`

Start only the local server:

```bash
npm run start:server
```

## Environment variables

Feishu notifier uses environment variables:

- `FEISHU_WEBHOOK_URL`
- or `LARK_WEBHOOK_URL`

Recommended setup:

1. copy `.env.example` to `.env`
2. put real webhook values only in local `.env` or deployment env vars
3. never commit real secrets into git

## Repository hygiene

This repository intentionally excludes:

- local runtime data
- personal workspace metadata
- local secrets
- private automation context

If you run the app locally, runtime files will stay local and should not be committed.

## Operational note

This project should be treated as a **decision aid**, not a source of blind execution.

Even when the dashboard shows strong candidates, final action should still be confirmed by a human reviewing:

- structure
- risk/reward
- market context
- account risk limits

## Status

This repository is currently focused on the MVP / cockpit workflow and may continue to evolve as the operator workflow gets refined.
