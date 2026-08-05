# DocAgent

<img src="frontend/public/logo.svg" alt="DocAgent logo" width="96" />

A single durable Flue agent that answers Cloudflare and AWS technical questions from current official documentation. The application is a React frontend and Hono API deployed together on Cloudflare Workers.

Production: https://docagent.oskarcode.com

Public source: https://github.com/oskarcode/docagent

## Start Here (Python/Django Mental Model)

> **Why this comparison exists:** I am more familiar with Python and Django, so I use their concepts as a personal learning bridge for this TypeScript project. The comparisons below are approximate mental models, not claims that the frameworks behave identically.

| This project | Django/Python equivalent |
|---|---|
| `src/app.ts` Worker entrypoint | `asgi.py` plus `urls.py`, middleware, and small views |
| Hono route handler | Django view or FastAPI endpoint function |
| `ResearchAgent` | A durable async service/orchestrator |
| Flue Durable Object history | A session-scoped persistent service; not a Django ORM model |
| `frontend/src/App.tsx` | A Django template plus browser-side view state; React stays active in the browser |
| TypeScript `type` | Python type hint or `TypedDict` intent; it does not validate network input |
| `package.json` | `pyproject.toml` dependencies plus command aliases |
| `package-lock.json` | A pinned Python dependency lockfile |
| `wrangler.jsonc` | `settings.py` plus the hosting manifest |
| `test/*.test.ts` | pytest test modules |

## What You Actually Maintain

1. `src/agents/`: agent behavior, mounted instructions, MCP connections, and durability policy.
2. `src/lib/`: model/source allowlists and anonymous session security.
3. `frontend/src/`: conversation UI, safe activity projection, and responsive styling.
4. `src/skills/research-planning/`: research procedure and evidence policy.
5. `src/app.ts` and `wrangler.jsonc`: API boundary and Cloudflare runtime configuration.

Usually do not edit `node_modules/`, `.wrangler/`, `dist/`, or `dist-web/`. They are downloaded or generated. Do not rewrite an applied migration tag in `wrangler.jsonc`; add a new migration instead.

## What This Project Does

- Creates an anonymous HttpOnly browser session and signs each conversation ID for that session (`src/lib/session.ts`).
- Pins one curated Workers AI model and one or more approved documentation sources to each thread (`src/lib/registry.ts`).
- Runs one `ResearchAgent` that activates a research skill and directly queries enabled Cloudflare/AWS MCP tools (`src/agents/research-agent.ts`).
- Streams answers, reasoning status, and sanitized tool labels to React without displaying raw tool output (`frontend/src/activity.ts`).
- Stores messages durably through Flue while the browser stores up to 30 thread pointers in `localStorage` (`frontend/src/App.tsx`).

## Architecture At A Glance

```text
React browser
  | POST /api/conversations
  | /api/agents/research/:signedConversationId/*
  v
Hono Worker: validation + anonymous ownership check
  v
Flue ResearchAgent Durable Object
  +--> Workers AI binding --> AI Gateway --> selected model
  +--> Cloudflare Docs MCP (when enabled/relevant)
  +--> AWS Knowledge MCP (when enabled/relevant)
  v
Durable streamed response and history --> React transcript
```

There are no vendor specialist agents or delegation layer. Evidence: `src/agents/research-agent.ts` exports only `ResearchAgent`; migration `v4` in `wrangler.jsonc` removes the retired specialist Durable Object classes.

## Traffic Flow (Input -> Output)

1. `frontend/src/App.tsx` restores a valid local conversation pointer or calls `POST /api/conversations`.
2. `src/app.ts` validates the model/source selection and `src/lib/session.ts` creates a signed ID bound to the HttpOnly browser session.
3. Ownership middleware verifies every request below `/api/agents/research/:id` before handing it to Flue.
4. `ResearchAgent` decodes immutable model/source choices, mounts `research-planning`, and connects only selected MCP servers.
5. Flue invokes Workers AI and relevant official-documentation tools, persists message parts, and streams the response.
6. React renders answer text separately from sanitized reasoning/tool activity.

## Hosting and Deployment

- Runtime: Cloudflare Workers (`src/app.ts`).
- Durable storage: Flue-generated SQLite Durable Object binding (`wrangler.jsonc`).
- Static frontend: Cloudflare Workers Static Assets from `dist-web/`.
- AI: Workers AI through AI Gateway ID `tech-docs-langgraph-worker`.
- Observability: Worker logs and traces enabled in `wrangler.jsonc`.
- Full validation: `npm run check`.
- Deploy: `npm run deploy`.
- Environments: local Vite development and the production Worker URL above.

`npm run deploy` validates both applications, builds them, updates the generated deployment snapshot through `scripts/prepare-deploy.mjs`, then runs Wrangler.

## Security Model

- Auth boundary: anonymous browser-session isolation, not login-based user authentication (`src/lib/session.ts`).
- Ownership: HMAC-signed conversation IDs are valid only with the browser session that created them.
- Cookie: HttpOnly, `SameSite=Strict`, 30-day lifetime, and `Secure` on HTTPS.
- Allowlists: external JSON and local-storage values must match `MODEL_REGISTRY` and `MCP_REGISTRY`.
- Optional secrets: `CF_DOCS_VECTORIZE_MCP_TOKEN` and `AWS_KNOWLEDGE_MCP_TOKEN`; store values as Worker secrets, never in source.
- Public endpoint overrides: `CF_DOCS_VECTORIZE_MCP_URL` and `AWS_KNOWLEDGE_MCP_URL` in `wrangler.jsonc`.
- Important limit: anyone using the same browser session can reopen its locally indexed conversations.

## APIs and Interfaces

- `GET /api/health`: confirms the Worker router is reachable without invoking AI.
- `POST /api/conversations`: accepts `{ model, mcpServerIds }` and returns a signed conversation ID.
- `/api/agents/research/:conversationId/*`: Flue-managed message, history, stream, cancel, and durable-agent routes protected by ownership middleware.
- Non-API `GET`/`HEAD`: serves frontend assets with SPA fallback.

## Frontend Overview

- `App.tsx` owns the current model/sources, local conversation index, Flue connection, transcript, and composer.
- Changing the model or sources creates a new thread because configuration is encoded in its signed ID.
- Deleting a conversation removes its browser pointer, not Flue's durable messages.
- `activity.ts` intentionally exposes tool names and selected input details, never raw tool responses.

## Quick Start

```bash
npm install
npm run dev
```

In a second terminal, start the frontend development server:

```bash
npm run dev:web
```

Open the frontend URL printed by Vite, normally `http://localhost:5174`. Run all checks with:

```bash
npm run check
```

## Troubleshooting Jump Table

- If thread creation returns `400`, inspect request validation in `src/app.ts` and registry values in `src/lib/registry.ts`.
- If a restored thread returns `401`, inspect the session cookie and token verification in `src/lib/session.ts`.
- If a model works locally but not after deployment, inspect Workers AI/AI Gateway bindings and Worker logs.
- If official sources are absent, inspect enabled source IDs, MCP environment values, and the activity trace.
- If the page is blank or API requests hit the SPA, inspect `frontend/vite.config.ts`, `wrangler.jsonc`, and `scripts/prepare-deploy.mjs`.
- See `docs/TROUBLESHOOTING.md` for detailed checks.

## License

MIT. See `LICENSE`.
