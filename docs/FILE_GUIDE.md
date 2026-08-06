# File Guide

Risk means how broadly a mistake can affect the running application.

## Critical Entrypoints

### `src/app.ts`

- Role: configures Workers AI, defines the small Hono API, verifies conversation ownership, and mounts Flue.
- Django/Python equivalent: `asgi.py`, middleware, `urls.py`, and small views.
- Called by: the Flue/Cloudflare generated Worker entrypoint.
- Calls into: `ResearchAgent`, registry guards, session helpers, and the Flue router.
- Risk: High; mistakes can expose history or break every request.
- Edit when: changing API routes, ownership policy, or provider settings.
- If this breaks: check `/api/health`, Worker logs, bindings, then middleware path parsing.

### `src/agents/research-agent.ts`

- Role: defines the only durable agent, per-prompt model, consolidated research skill, enabled MCP connections, and response metadata.
- Django/Python equivalent: a stateful async service/orchestrator.
- Called by: Flue's generated Durable Object router.
- Calls into: registry parsing and Flue hooks.
- Risk: High; hook order and MCP/model configuration affect every answer.
- Edit when: changing research behavior, MCP setup, model options, durability, or metadata.
- If this breaks: inspect the prompt envelope, signed-ID fallback, Flue build output, agent logs, and MCP activity trace.

### `frontend/src/App.tsx`

- Role: owns the complete research desk, local thread index, configuration controls, Flue connection, transcript, and composer.
- Django/Python equivalent: template, view context, and JavaScript controller combined.
- Called by: `frontend/src/main.tsx`.
- Calls into: `/api/conversations`, Flue React/SDK, registry helpers, and activity projection.
- Risk: High; state transitions affect restoration and message submission.
- Edit when: changing user flows, conversation history, model/source controls, or transcript layout.
- If this breaks: inspect browser console/network, local storage, and `agent.status` handling.

## Feature/Domain Files

### `src/lib/session.ts`

- Role: creates anonymous cookies and signs/verifies conversation ownership tokens.
- Django/Python equivalent: signed-cookie/session middleware and a token utility.
- Called by: `src/app.ts` and session tests.
- Calls into: Web Crypto and registry mask/model validation.
- Risk: High; this is the main security boundary.
- Edit when: changing session lifetime, token format, or ownership rules.
- If this breaks: run `test/session.test.ts` and inspect cookie/token components.

### `src/lib/registry.ts`

- Role: central allowlists, generic MCP runtime metadata, compact legacy masks, and per-prompt configuration encoding.
- Django/Python equivalent: settings constants plus Pydantic-style runtime guards.
- Called by: Worker, agent, frontend, activity labels, and tests.
- Calls into: no application modules.
- Risk: High; IDs and prompt configuration are persisted in signed tokens, browser storage, and Flue history.
- Edit when: adding/removing a supported model or official source.
- If this breaks: run `test/registry.test.ts`; avoid changing existing source bit values.

### `frontend/src/activity.ts`

- Role: turns Flue message parts into answer text and safe activity rows.
- Django/Python equivalent: serializer/presenter for template context.
- Called by: `App.tsx` and activity tests.
- Calls into: the MCP registry for labels.
- Risk: Medium; raw tool data must not leak into the trace.
- Edit when: Flue changes part shapes or the UI needs another safe activity label.
- If this breaks: run `test/activity.test.ts` and inspect a persisted message part.

### `frontend/src/conversation-lock.ts`

- Role: prevents two same-origin tabs from submitting concurrently to one Flue conversation.
- Django/Python equivalent: a browser-side per-session mutex held through task completion.
- Called by: `App.tsx` during prompt admission and settlement waiting.
- Risk: High; without it Flue may join a prompt whose model/MCP configuration differs from the active submission.
- Edit when: changing submission concurrency or supported browser behavior.
- If this breaks: run `test/conversation-lock.test.ts` and test two tabs on the same conversation.

### `frontend/src/styles.css`

- Role: global visual tokens, desktop layout, history rail, controls, transcript, composer, and responsive behavior.
- Django/Python equivalent: static CSS served with templates.
- Called by: `frontend/src/main.tsx`.
- Risk: Medium; layout rules are shared across the single page.
- Edit when: changing appearance or mobile behavior.
- If this breaks: test widths above 900px, 621-900px, and at/below 620px.

### `src/skills/research-planning/SKILL.md`

- Role: the single research workflow and evidence-policy document, including search limits and citation checks.
- Django/Python equivalent: a reusable service procedure loaded on demand.
- Called by: `useSkill()` and the model's `activate_skill` tool.
- Risk: High; it controls evidence collection.
- Edit when: changing research budgets or evidence procedure.
- If this breaks: verify the first substantive tool call is `activate_skill` and inspect subsequent MCP activity.

## Infra/Config Files

- `wrangler.jsonc`: `settings.py` plus deployment manifest; changes affect bindings, variables, assets, Durable Object migrations, and observability. Risk: High.
- `vite.config.ts`: Worker bundler config; Flue scanning must precede Cloudflare snapshotting. Risk: High.
- `frontend/vite.config.ts`: React build root/output and local API proxy. Risk: Medium.
- `frontend/public/_headers`: security headers applied by Workers Static Assets without invoking Hono. Risk: Medium.
- `scripts/prepare-deploy.mjs`: patches the generated Wrangler snapshot with frontend assets. Risk: High for deploys.
- `package.json`: dependencies and canonical run/check/deploy commands. Risk: Medium.
- `package-lock.json`: exact dependency graph; update through npm, not by hand.
- `tsconfig.json`: strict TypeScript checking for Worker, frontend, tests, and configs. Risk: Medium.
- `vitest.config.ts`: Node-based unit test discovery. Risk: Low.
- `test/*.test.ts`: focused regression tests for registry, sessions, activity safety, and cross-tab submission locking. Risk: Low.

## Generated/Downloaded Files

- `node_modules/`: downloaded npm packages; safe to delete, regenerate with `npm install`.
- `.wrangler/`: local Wrangler cache/state; usually safe to delete, regenerated by Wrangler/Vite commands.
- `dist/`: Worker build and generated deployment snapshot; safe to delete, regenerate with `npm run build` and `npm run prepare:deploy`.
- `dist-web/`: frontend assets; safe to delete, regenerate with `npm run build:web`.

Do not edit generated output to fix source behavior. Make the change in application/config source and rebuild.
