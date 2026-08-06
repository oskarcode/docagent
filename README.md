# DocAgent

DocAgent is a durable documentation-research chat application built with React, Flue, Hono, and Cloudflare Workers. Each prompt can choose one curated Workers AI model and one or more official documentation MCP servers. Flue persists the conversation and streams structured reasoning, tool activity, and final answer parts back to the browser.

Production: https://docagent.oskarcode.com

## Mental Model

For Python or Django developers:

| This project | Python/Django analogy |
| --- | --- |
| `src/app.ts` | `urls.py` plus middleware and lightweight views |
| `src/agents/research-agent.ts` | A service class or durable Celery task definition |
| `src/lib/registry.ts` | Typed settings, allowlists, and request serializers |
| `frontend/src/App.tsx` | A browser-side template, form controller, and SSE consumer |
| Flue Durable Object | A per-conversation database record plus durable worker |
| MCP server | A remote, model-callable documentation adapter |
| `wrangler.jsonc` | Deployment settings and infrastructure bindings |

The important difference from a normal request/response application is that prompt execution outlives the initiating HTTP request. The browser submits work, Flue durably runs it, and the UI observes persisted conversation state.

## Runtime Flow

1. The browser creates an anonymous conversation through `POST /api/conversations`.
2. The Worker validates the model and documentation-source selection.
3. The Worker signs `<model>.<mcp-mask>.<uuid>` with `CONVERSATION_SIGNING_KEY` and returns the opaque ID.
4. The browser wraps each visible prompt in a validated `<docagent-config>` envelope containing that prompt's model and source choices.
5. `submitWithConversationLock` acquires a same-origin Web Lock, records an idempotency marker, and submits through the Flue SDK.
6. `ResearchAgent` decodes the envelope, mounts only the selected MCP clients, and invokes the selected Workers AI model.
7. Flue persists and streams structured message parts.
8. The UI shows reasoning and tool calls inside **Events** and renders only post-tool final text as the answer.

## Project Layout

```text
frontend/
  index.html                 Browser HTML shell
  public/                    Static manifest, icon, and asset security headers
  src/App.tsx                Chat UI, direct Flue observation, optimistic prompts
  src/activity.ts            Answer/reasoning/tool projection
  src/conversation-lock.ts   Cross-tab admission and replay protection
  src/styles.css             Responsive application styling
src/
  app.ts                     Hono API, security headers, signed ownership
  agents/research-agent.ts   Durable research agent and MCP/model routing
  lib/registry.ts            Shared model/MCP registries and prompt envelope
  skills/                    Agent planning guidance
scripts/prepare-deploy.mjs   Copies static assets beside Flue build output
test/                        Vitest unit and route tests
wrangler.jsonc               Cloudflare bindings, migrations, assets, observability
```

See `docs/CODEBASE_OVERVIEW.md`, `docs/FILE_GUIDE.md`, and `docs/TROUBLESHOOTING.md` for deeper maintenance guidance.

Hono does not proxy frontend files through an `ASSETS` binding or catch-all route. Cloudflare Static Assets owns file delivery and SPA fallback. The remaining Hono middleware is limited to API response headers and signed-conversation ownership checks; the deleted rate-limiter Durable Object remains only in append-only Wrangler migration history.

## Local Development

Requirements:

- Node.js 22 or compatible current runtime
- npm
- A Cloudflare account with Workers AI access
- A secret `CONVERSATION_SIGNING_KEY` of at least 32 characters

Install and validate:

```bash
npm install
npm run check
```

Run the integrated Worker development server:

```bash
npm run dev
```

Run only the frontend development server when working on browser rendering:

```bash
npm run dev:web
```

Useful checks:

```bash
npm run check:types
npm test
npm run build:web
npm run build
```

## Configuration

Non-secret defaults live in `wrangler.jsonc`:

- `AI_GATEWAY_ID`
- `CF_DOCS_VECTORIZE_MCP_URL`
- `AWS_KNOWLEDGE_MCP_URL`

Required production secret:

```bash
npx wrangler secret put CONVERSATION_SIGNING_KEY
```

Optional endpoint overrides are `CF_DOCS_VECTORIZE_MCP_URL` and `AWS_KNOWLEDGE_MCP_URL`. Do not commit `.dev.vars` or secret values.

The current model allowlist is defined once in `src/lib/registry.ts`:

- Kimi K2.6
- Kimi K2.7 Code
- GLM-5.2, the fresh-browser default
- GLM-4.7 Flash
- Gemma 4 26B
- GPT-OSS 120B

The documentation-source registry currently exposes official Cloudflare and AWS MCP endpoints. Add or remove sources through the registry rather than introducing route-specific conditionals.

## Deployment

Authenticate Wrangler, set the signing secret, then run:

```bash
npm run deploy
```

The deployment command runs all checks, prepares the generated Flue/asset layout, and deploys the generated Wrangler configuration. `dist/`, `dist-web/`, `.flue-vite/`, `.wrangler/`, `.flue-vite.wrangler.jsonc`, and `worker-configuration.d.ts` are generated or machine-local artifacts and must not be edited by hand.

Cloudflare Durable Object migration tags are append-only production history. Never rename or rewrite an applied tag; add a new migration when durable classes change.

## Security And Reliability

- Conversation IDs are signed and ownership middleware rejects forged or malformed IDs.
- Model and MCP values are allowlisted before they reach agent configuration.
- Per-prompt metadata is validated from a strict envelope, retained for durable replay, and explicitly identified to the model as routing metadata rather than user instructions.
- Web Locks serialize submissions across same-origin tabs.
- Local idempotency markers replay uncertain admissions with the original body and key.
- Flue `idempotencyKey` handling prevents duplicate durable jobs.
- Browser and Worker responses carry restrictive security headers.
- Tool output is sanitized before display.
- All selected MCP URLs must use HTTPS.
- Agent attempts and execution time are bounded.

## Maintenance Rules

- Preserve structured Flue part types; do not flatten reasoning, tool calls, and answers into one text blob.
- Keep pre-tool narration out of the final answer by retaining the final-tool boundary in `messageText`.
- Keep optimistic UI reconciliation in render-time derivation; setting state on every streamed snapshot can cause React error `#185`.
- Keep the initialization ref that protects conversation creation under React StrictMode.
- Do not remove lockfiles, Durable Object migrations, deployment bindings, or signed-ID parsing without an explicit migration plan.
- Add focused regression tests when changing parsing, admission recovery, security validation, or message ownership.

## Public Source

https://github.com/oskarcode/docagent
