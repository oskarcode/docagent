# Codebase Overview

## Purpose

DocAgent answers documentation questions with source-grounded research. It combines a React browser application, a Hono Worker API, one Flue durable agent, Workers AI models, and official Cloudflare/AWS MCP documentation servers.

The repository deliberately keeps policy in a few shared places:

- `src/lib/registry.ts` owns approved models, approved MCP sources, compact source masks, and the per-prompt envelope.
- `src/app.ts` owns HTTP routing, response security headers, anonymous signed conversation creation, and conversation ownership checks.
- `src/agents/research-agent.ts` owns durable model execution and selected MCP mounting.
- `frontend/src/activity.ts` owns the boundary between answer text, reasoning, and tool activity.
- `frontend/src/conversation-lock.ts` owns cross-tab submission serialization and uncertain-admission recovery.

## Architecture

```text
Browser / React
  |  POST /api/conversations
  |  Flue submit + observe
  v
Cloudflare Worker / Hono
  |  signed conversation ownership
  |  generated Flue route handling
  v
Flue Durable Object: one logical conversation
  |  ResearchAgent delivery
  |  Workers AI through AI Gateway binding
  +------> Cloudflare Docs MCP
  +------> AWS Knowledge MCP
```

Static React assets and API routes share the same Worker deployment. `run_worker_first` sends `/api/*` through Worker code before asset lookup, while other unknown paths receive the SPA shell.

### Removed routing layers

- The manual Hono `ASSETS` binding and non-API catch-all handler were removed. Cloudflare Static Assets now serves files and performs SPA fallback directly.
- The old `ResearchRateLimiter` Durable Object is no longer bound or called. Its `v1` creation and `v2` deletion entries remain because Wrangler migration history is append-only.
- Hono still applies API security headers and verifies signed conversation ownership before Flue handles conversation routes. Those middleware layers were not removed.

## Request Lifecycle

### Conversation creation

`App.tsx` restores the most recent signed ID from `localStorage` or calls `POST /api/conversations`. `src/app.ts` validates the requested initial model/source choices, generates a UUID, and signs the unsigned ID with HMAC-SHA-256. The browser never receives the signing key.

The model and MCP mask in the ID preserve compatibility with the conversation's initial configuration. Current prompt routing does not require a new conversation when the user changes the controls.

### Prompt admission

The browser creates a visible prompt plus a hidden `<docagent-config>` JSON envelope. `ResearchAgent` validates the envelope, uses it for routing, and explicitly tells the model to treat the retained first line as system-generated metadata rather than user instructions.

`submitWithConversationLock` then:

1. Requires browser Web Locks support.
2. Acquires an exclusive lock named for the conversation.
3. Reads any prior local recovery marker.
4. Replays uncertain admission with the original payload and idempotency key.
5. Waits for durable settlement before releasing the lock.
6. Clears only the marker owned by that operation.

HTTP 408 and 5xx admission errors remain recoverable because the server may already have accepted the request. Definitive non-timeout 4xx errors can safely clear the marker.

### Durable execution

Flue invokes `ResearchAgent.handleDelivery`. The agent decodes prompt metadata, selects a model from the registry, mounts only selected MCP clients, and constructs a request-scoped system prompt listing the available sources. A bounded `createAgent` call executes the research.

The agent is configured for at most five durable attempts and a three-minute timeout. The Flue Durable Object stores conversation history and emits message parts through its generated routes.

### Browser observation

`useFlueAgent` supplies direct `agent.messages` snapshots. The UI does not copy streamed messages into component state. Optimistic user prompts are derived alongside the persisted transcript and disappear when their submission ID appears on the durable user message.

This design matters under React StrictMode and frequent SSE updates. A previous effect that called `setState` for every streamed snapshot produced React error `#185` through a maximum-update loop.

### Message ownership

Flue structured parts are authoritative:

- `reasoning` parts belong in the expandable **Events** panel.
- `tool-call` and `tool-result` parts belong in **Events**.
- Assistant `text` parts after the last tool boundary form the answer.
- When no tools ran, all assistant text parts form the answer.

Kimi can emit an explicit leading `<think>` block in otherwise unstructured assistant text. `activity.ts` applies a narrow fallback parser only at the start of Kimi assistant text. Tags inside answers and all literal tags from other models remain answer content.

## State And Storage

Cloudflare stores durable conversation state inside the Flue Durable Object. The browser stores only presentation and recovery metadata:

- Recent signed conversation IDs
- The latest selected model
- The latest selected MCP sources
- Active submission replay markers

Signed IDs are opaque authorization tokens, not secrets. They should still be treated as unguessable capabilities and validated on every conversation-specific API route.

## Security Boundaries

- HMAC signing prevents clients from inventing conversation ownership.
- Registry checks reject arbitrary model aliases and MCP endpoints.
- Prompt envelopes reject malformed versions or empty/unknown source selections.
- HTTPS checks protect remote MCP mounting.
- Security headers limit MIME sniffing, referrer detail, and access to unused browser capabilities.
- Rendered Markdown permits ordinary links but not arbitrary HTML.
- Tool data is reduced to safe, human-readable summaries before browser display.
- Full observability is enabled in `wrangler.jsonc`; avoid placing secrets in prompts or logs.

## Deployment Shape

The root Vite build uses `@flue/vite` before `@cloudflare/vite-plugin`; ordering is required so Flue discovers the agent and generates bindings before Cloudflare snapshots configuration. The frontend has a separate Vite build in `frontend/vite.config.ts`.

`scripts/prepare-deploy.mjs` copies the frontend build into the generated Flue deployment tree and adjusts the generated asset path. `npm run deploy` always runs the complete validation chain before generation and deployment.

Durable Object migration entries in `wrangler.jsonc` include historical classes that were later deleted. They document already-applied production migrations and are not dead code.

## TypeScript And React Notes

- `type` declarations disappear at runtime; they constrain data during compilation.
- `as const` preserves literal IDs so TypeScript can derive safe unions from registry data.
- Valibot performs runtime validation where external data crosses a trust boundary.
- React state holds user-editable controls and ephemeral submission status.
- Refs hold mutable coordination values that should not trigger rendering, such as StrictMode initialization guards.
- Flue messages are external streamed state and should be rendered directly rather than mirrored through an effect.
- Callback closures can capture stale values; request-specific payloads should be constructed immediately before submission.

## Extension Points

To add a model, add one `MODEL_REGISTRY` entry and tests. Confirm that its Flue model specifier and reasoning-part behavior are supported.

To add a documentation source, add one `MCP_REGISTRY` entry with a unique power-of-two bit, an HTTPS URL, optional environment override, and tests.

To change answer projection, update `activity.ts` and add model-specific multipart/tool-boundary regressions before touching JSX.

To alter durable storage classes, append a Wrangler migration and verify the generated Flue binding name. Never rewrite existing tags.
