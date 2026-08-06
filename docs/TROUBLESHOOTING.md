# Troubleshooting

Start with the symptom, reproduce it with the smallest relevant command, and inspect source before generated output.

## Validation Commands

```bash
npm run check:types
npm test
npm run build:web
npm run build
```

`npm run check` runs all four in release order. `npm run deploy` adds generated-output preparation and Wrangler deployment after they pass.

## React Error #185 Or Maximum Update Depth

Symptoms:

- The production UI crashes after streaming begins.
- The console reports minified React error `#185` or a maximum update-depth loop.
- Re-rendering accelerates as new Flue parts arrive.

Checks:

- Confirm `App.tsx` renders `agent.messages` directly.
- Look for an effect that depends on streamed messages and calls `setState` on every snapshot.
- Confirm optimistic prompts are reconciled during render rather than copied into another message-state array.
- Confirm conversation initialization uses the `initializationStarted` ref so React StrictMode does not create two conversations.

Why:

SSE updates produce frequent new snapshots. Mirroring each snapshot into React state creates a second update source and can repeatedly retrigger the effect.

## Prompt Appears Twice

Checks:

- Inspect the persisted Flue messages for matching `submissionId` metadata.
- Inspect `localStorage` for `docagent_active_submission:<conversationId>`.
- Confirm `submitWithConversationLock` sends and replays with the same idempotency key.
- Confirm the Web Lock is held until `client.wait(admission)` settles.

Do not fix duplicate display by deleting durable history or removing replay. First determine whether the duplicate is persisted or only optimistic presentation.

## Prompt Disappears While Sending

Checks:

- Confirm `onAdmitted` assigns the Flue `submissionId` to the optimistic prompt.
- Confirm `OptimisticUserMessage` is rendered when durable history has not caught up.
- Confirm reconciliation finds the matching `submissionId` on the durable user message.
- Confirm the prompt is not removed by an effect tied to every message snapshot.

## Another Tab Reports A Busy Conversation

This is expected while another same-origin tab holds the conversation Web Lock through durable settlement. Wait for the active prompt to finish.

If no tab is active:

- Close stale tabs and retry.
- Check whether the browser implements `navigator.locks`.
- Inspect the active marker in `localStorage`.
- Do not manually delete a marker while a request may still be settling; retry logic uses it to avoid duplicate jobs.

## Admission Failed But Work May Still Be Running

HTTP 408 and 5xx errors are intentionally treated as uncertain. The next locked submission replays the original body with the original idempotency key, allowing Flue to return the existing admission instead of starting duplicate work.

A non-timeout 4xx response is definitive and clears the owned marker. If this classification changes, update `conversation-lock.ts` and its regression tests together.

## Reasoning Is Missing From Events

Checks:

- Inspect the Flue message parts for `reasoning` entries.
- Confirm `messageTrace` handles the provider's structured part type.
- For Kimi only, check whether explicit `<think>` tags arrived inside an assistant `text` part.
- Do not add broad tag parsing for every model; literal tags from non-Kimi models are valid answer content.

Provider reasoning should be displayed in **Events**, not appended to the final answer.

## Pre-Tool Narration Appears In The Final Answer

Checks:

- Inspect the assistant part order.
- Confirm `messageText` finds the final `tool-call` or `tool-result` boundary.
- Confirm only text parts after that boundary are projected when tools were used.
- Run `test/activity.test.ts` after changing projection logic.

When no tools run, all assistant text parts remain part of the answer.

## Tool Events Leak Raw Or Oversized Data

`messageTrace` should display only safe status summaries and sanitized error messages. Do not render arbitrary tool arguments or raw MCP results into the browser. Add an explicit formatter for any new tool part shape.

## Conversation Creation Returns 400

Checks:

- Ensure `model` exactly matches a `MODEL_REGISTRY` ID.
- Ensure `mcpServerIds` is a non-empty array of known source IDs.
- Check JSON syntax and `Content-Type: application/json`.
- Run `test/registry.test.ts` and `test/security.test.ts`.

## Conversation Routes Return 401

The conversation ID is absent, malformed, or has an invalid signature.

Checks:

- Confirm `CONVERSATION_SIGNING_KEY` is configured and at least 32 characters.
- Do not alter the signed ID stored by the browser.
- If the signing key was rotated, existing browser IDs are no longer valid; start a new conversation.
- Confirm the route is under `/api/agents/research/:conversationId`.

## Model Or MCP Request Fails

Checks:

- Verify the model/source IDs through `src/lib/registry.ts`.
- Verify `AI_GATEWAY_ID` and Workers AI binding configuration.
- Verify MCP endpoints resolve over HTTPS.
- Check optional endpoint overrides for typos.
- Inspect Worker logs and traces for Flue attempt details.
- Confirm the agent's three-minute timeout is appropriate for the query.

Do not bypass allowlists by accepting arbitrary client-provided model aliases or MCP URLs.

## Frontend Loads But API Routes Return The SPA

Checks:

- Confirm `wrangler.jsonc` has `run_worker_first: ["/api/*"]`.
- Confirm frontend output exists at `dist-web/` before deployment preparation.
- Confirm `scripts/prepare-deploy.mjs` copied assets into the generated Flue tree.
- Inspect the generated Wrangler file, but fix root configuration rather than editing generated output.

## Build Or Deployment Uses Stale Generated Files

Remove only reproducible generated output after confirming no local source is stored there, then rebuild. Safe candidates are `dist/`, `dist-web/`, `.flue-vite/`, and `.wrangler/`; never remove source, lockfiles, `.dev.vars`, or migration history as routine cleanup.

Use the project script instead of manually invoking generated entrypoints:

```bash
npm run deploy
```

## Durable Object Migration Error

Checks:

- Compare class bindings with Flue-generated class names.
- Verify every new durable class has a new migration tag.
- Never rename, reorder, or rewrite an already-applied migration.
- Historical deleted classes in older tags are expected production history.

## Useful Production Checks

- Open `https://docagent.oskarcode.com/api/health` and expect `{"ok":true}`.
- Verify the HTML references the latest hashed frontend assets after deployment.
- Use Wrangler logs/traces to correlate a failed prompt with its durable attempt.
- Reproduce provider-specific rendering with the focused Vitest files before changing shared projection code.
