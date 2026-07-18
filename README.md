# JetDeck

Flight operations and charter sales platform for Part 135 charter operators.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Prisma + PostgreSQL (Neon)
- Clerk (multi-tenant auth)
- Resend (outbound email) / Postmark (inbound email parsing)
- Anthropic Claude API (AI email triage, extraction, opportunity scoring)
- Stripe (card holds)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in keys as each integration step is reached
npm run dev
```

## Project status

Phase 1, Step 1 (project scaffold) complete. See the build brief for the full
Phase 1 build order and data model.
