# Troubleshooting

Start with `npm run check`. It type-checks, runs unit tests, builds React, and builds the Worker (`package.json`). For production-only failures, inspect Cloudflare Worker logs/traces because observability is enabled in `wrangler.jsonc`.

## Symptom -> First Checks

| Symptom | First checks |
|---|---|
| Blank page | Browser console, `frontend/src/main.tsx`, `frontend/src/App.tsx`, and `dist-web/` build |
| `/api/*` returns the SPA HTML | `wrangler.jsonc` `run_worker_first`, frontend proxy, and `scripts/prepare-deploy.mjs` |
| `POST /api/conversations` returns `400` | Request JSON plus `isModelId()` and `isMcpServerIdArray()` in `src/lib/registry.ts` |
| Agent route returns `401` | HttpOnly cookie, signed ID, and `verifyConversationToken()` in `src/lib/session.ts` |
| History does not restore | Browser local-storage pointer, `useFlueAgent` URL, ownership response, and `agent.historyReady` |
| Wrong model/source after reopening | Current local metadata, prompt envelope parsing, and assistant response metadata |
| Another tab cannot submit | The active conversation lock is intentionally held until the first submission settles; inspect `conversation-lock.ts` only if no work is active |
| Model request fails | Workers AI binding, `AI_GATEWAY_ID`, model specifier, account limits, and Worker logs |
| Cloudflare evidence is missing | Source checkbox, `cloudflare-docs` MCP connection, skill activation, and activity trace |
| AWS evidence is missing | Source checkbox, `aws-knowledge` MCP connection, skill activation, and activity trace |
| Raw tool output appears in UI | `frontend/src/activity.ts` projection and `test/activity.test.ts` |
| Deploy cannot locate assets | Run `npm run check`, then inspect `dist-web/` and generated `dist/.../wrangler.json` after `npm run prepare:deploy` |
| Mobile layout clips controls | Test `frontend/src/styles.css` at/below 620px and between 621-900px |

## Common Failure Modes

### Auth/access failures

- This app has no user login. A `401` means the browser session cookie does not validate the signed conversation ID.
- Confirm the cookie name is `tech_docs_flue_session` and that HTTPS responses set `Secure`.
- Confirm the conversation ID has four dot-separated segments: model, source mask, UUID, signature.
- Do not weaken verification to recover old malformed pointers; clear the stale browser pointer and create a new thread.
- Relevant files: `src/lib/session.ts`, `src/app.ts`, and `test/session.test.ts`.

### Deployment/config drift

- The Worker and frontend are separate Vite builds.
- `npm run deploy` must run `check`, `prepare:deploy`, then Wrangler using the generated config.
- `scripts/prepare-deploy.mjs` is required because Flue's Worker snapshot does not include the separately built React assets.
- Never edit `dist/.../wrangler.json` manually; rebuild and patch it through scripts.
- Keep applied Durable Object migration tags unchanged.

### MCP connection or evidence failures

- Confirm the requested vendor source is enabled in the current thread.
- Confirm public URLs in `MCP_REGISTRY` or their environment overrides.
- If authentication is required, confirm Worker secrets `CF_DOCS_VECTORIZE_MCP_TOKEN` or `AWS_KNOWLEDGE_MCP_TOKEN` without printing values.
- Confirm the trace starts with `Activate skill` before an MCP documentation search.
- MCP connections are optional, so connection failure may produce an evidence-gap answer rather than a Worker crash.

### Model and AI Gateway failures

- Confirm the model ID exists in `MODEL_REGISTRY` and its specifier starts with `cloudflare/@cf/`.
- Confirm the `AI` binding and `AI_GATEWAY_ID` are present in the deployed config.
- Check Cloudflare account model availability, limits, gateway policies, and Worker logs.
- Model changes apply to the next prompt. Confirm its user/assistant badges and `useDelivery()` parsing if the old model remains active.
- Flue reads model and MCP hooks once per submission, so the frontend rejects a second same-conversation prompt instead of allowing a turn-boundary join.
- If a tab closes or loses the admission response, the next submit replays the persisted prompt with the same Flue idempotency key and waits for that settlement before sending new work.

### Browser history surprises

- Local storage contains pointers and labels, not message content.
- Flue Durable Objects contain message history.
- Deleting a row removes only the pointer from that browser.
- Clearing browser storage loses the convenient index but does not issue server-side deletion.
- Changing model or sources updates local metadata and the next prompt while preserving the current conversation ID.
- Disabled sources are unavailable to future prompts, but their earlier tool results remain part of the durable history.

### Build or test failures

Run the failing layer separately:

```bash
npm run check:types
npm test
npm run build:web
npm run build
```

- Registry failures: inspect `src/lib/registry.ts` and `test/registry.test.ts`.
- Session failures: inspect Web Crypto/token format and `test/session.test.ts`.
- Activity failures: inspect Flue message-part assumptions and `test/activity.test.ts`.
- Conversation-lock failures: inspect Web Locks support and `test/conversation-lock.test.ts`.
- React build failures: inspect browser imports and JSX in `frontend/src/`.
- Worker build failures: inspect Flue hooks, `vite.config.ts`, and `wrangler.jsonc`.

## Ask-This-Question Prompts

- "Which function validates the model and source JSON for conversation creation?"
- "Which middleware owns the signed conversation check before Flue routing?"
- "Which functions encode and decode per-prompt model and MCP configuration?"
- "Which component saves browser conversation pointers, and where are messages actually stored?"
- "Which function prevents raw MCP output from appearing in the activity trace?"
- "Which function prevents concurrent tabs from joining differently configured prompts?"
- "Which build creates `dist-web`, and which script attaches it to the generated Worker config?"
- "Which Wrangler migration removed the retired specialist Durable Object classes?"
