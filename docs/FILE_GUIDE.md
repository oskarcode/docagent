# File Guide

Risk means how broadly a mistake can affect the running application.

## Critical Entrypoints

### `src/app.ts`

- Role: configures Workers AI, defines Hono routes/security, verifies conversation ownership, mounts Flue, and serves assets.
- Django/Python equivalent: `asgi.py`, middleware, `urls.py`, and small views.
- Called by: the Flue/Cloudflare generated Worker entrypoint.
- Calls into: `ResearchAgent`, registry guards, session helpers, Flue router, and `ASSETS`.
- Risk: High; mistakes can expose history or break every request.
- Edit when: changing API routes, headers, ownership policy, provider settings, or asset fallback.
- If this breaks: check `/api/health`, Worker logs, bindings, then middleware path parsing.

### `src/agents/research-agent.ts`

- Role: defines the only durable agent, selected model, mounted research policy, enabled MCP connections, and response metadata.
- Django/Python equivalent: a stateful async service/orchestrator.
- Called by: Flue's generated Durable Object router.
- Calls into: registry parsing and Flue hooks.
- Risk: High; hook order and MCP/model configuration affect every answer.
- Edit when: changing research behavior, MCP setup, model options, durability, or metadata.
- If this breaks: inspect the signed ID, Flue build output, agent logs, and MCP activity trace.

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

- Role: central allowlists for models and MCP sources plus compact source-mask encoding.
- Django/Python equivalent: settings constants plus Pydantic-style runtime guards.
- Called by: Worker, agent, frontend, activity labels, and tests.
- Calls into: no application modules.
- Risk: High; IDs are persisted in signed tokens and browser storage.
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

### `frontend/src/styles.css`

- Role: global visual tokens, desktop layout, history rail, controls, transcript, composer, and responsive behavior.
- Django/Python equivalent: static CSS served with templates.
- Called by: `frontend/src/main.tsx`.
- Risk: Medium; layout rules are shared across the single page.
- Edit when: changing appearance or mobile behavior.
- If this breaks: test widths above 900px, 621-900px, and at/below 620px.

### `src/agents/AGENT.md`

- Role: always-mounted behavior for direct, source-grounded research.
- Django/Python equivalent: versioned service policy/configuration.
- Called by: `useInstruction()` in `ResearchAgent`.
- Calls into: the mounted `research-planning` skill by instruction.
- Risk: High; prompt changes can alter tool order and citation quality.
- Edit when: changing stable agent behavior, not one-off user requests.
- If this breaks: verify the first substantive tool call is `activate_skill`.

### `src/skills/research-planning/SKILL.md`

- Role: progressive research workflow, search limits, and citation checks.
- Django/Python equivalent: a reusable service procedure loaded on demand.
- Called by: `useSkill()` and the model's `activate_skill` tool.
- Calls into: `SOURCE_POLICY.md` for comparisons/security/architecture/best practices.
- Risk: High; it controls evidence collection.
- Edit when: changing research budgets or evidence procedure.
- If this breaks: inspect skill activation and resource-read activity.

### `src/skills/research-planning/SOURCE_POLICY.md`

- Role: first-party evidence and cross-vendor comparison rules.
- Django/Python equivalent: a policy resource read by the service workflow.
- Called by: the activated skill when the question requires it.
- Risk: Medium.
- Edit when: changing evidence quality or comparison requirements.
- If this breaks: check that the resource path returned by skill activation is read exactly.

## Infra/Config Files

- `wrangler.jsonc`: `settings.py` plus deployment manifest; changes affect bindings, variables, assets, Durable Object migrations, and observability. Risk: High.
- `vite.config.ts`: Worker bundler config; Flue scanning must precede Cloudflare snapshotting. Risk: High.
- `frontend/vite.config.ts`: React build root/output and local API proxy. Risk: Medium.
- `scripts/prepare-deploy.mjs`: patches the generated Wrangler snapshot with frontend assets. Risk: High for deploys.
- `package.json`: dependencies and canonical run/check/deploy commands. Risk: Medium.
- `package-lock.json`: exact dependency graph; update through npm, not by hand.
- `tsconfig.json`: strict TypeScript checking for Worker, frontend, tests, and configs. Risk: Medium.
- `vitest.config.ts`: Node-based unit test discovery. Risk: Low.
- `test/*.test.ts`: focused regression tests for registry, sessions, and activity safety. Risk: Low.

## Generated/Downloaded Files

- `node_modules/`: downloaded npm packages; safe to delete, regenerate with `npm install`.
- `.wrangler/`: local Wrangler cache/state; usually safe to delete, regenerated by Wrangler/Vite commands.
- `dist/`: Worker build and generated deployment snapshot; safe to delete, regenerate with `npm run build` and `npm run prepare:deploy`.
- `dist-web/`: frontend assets; safe to delete, regenerate with `npm run build:web`.

Do not edit generated output to fix source behavior. Make the change in application/config source and rebuild.
