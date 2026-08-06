# File Guide

## Runtime Source

| File | Responsibility | Called by | Change risk |
| --- | --- | --- | --- |
| `src/app.ts` | Hono routes, API security headers, signed conversation creation, ownership middleware | Generated Worker entrypoint | High: affects auth and every request |
| `src/agents/research-agent.ts` | Decodes per-prompt config, mounts MCP clients, runs the selected model | Flue durable delivery | High: affects durable execution and research behavior |
| `src/lib/registry.ts` | Model/MCP allowlists, masks, prompt envelope codecs | Worker, agent, frontend, tests | High: shared protocol and trust boundary |
| `src/env.ts` | Worker binding types | Runtime TypeScript compilation | Medium: must match Wrangler/generated bindings |
| `src/index.ts` | Exports the Hono app to Flue/Vite | Generated Worker build | Low unless entrypoint behavior changes |
| `src/skills/research-planning/SKILL.md` | Gives the agent a bounded documentation-research workflow | `ResearchAgent` through `skill()` | Medium: changes model behavior without changing TypeScript |

## Frontend Source

| File | Responsibility | Called by | Change risk |
| --- | --- | --- | --- |
| `frontend/src/main.tsx` | Creates the React root under StrictMode | Browser entrypoint | Low |
| `frontend/src/App.tsx` | Conversation lifecycle, controls, optimistic prompts, direct Flue observation, rendering | `main.tsx` | High: central UI and state flow |
| `frontend/src/activity.ts` | Projects structured message parts into answer text and Events | `App.tsx` | High: subtle model/tool ownership rules |
| `frontend/src/conversation-lock.ts` | Web Lock admission, marker validation, idempotent replay, settlement | `App.tsx` | High: duplicate-prevention and recovery logic |
| `frontend/src/styles.css` | Responsive visual system and component states | `main.tsx` | Medium: broad selector changes can affect mobile and accessibility |
| `frontend/index.html` | HTML shell, install metadata, social metadata | Frontend Vite build | Low |
| `frontend/public/_headers` | Static-asset browser security policy | Cloudflare Static Assets | High when changing CSP |
| `frontend/public/manifest.webmanifest` | Installable application metadata | Browser | Low |
| `frontend/public/icon.svg` | Application icon | HTML and manifest | Low |
| `frontend/vite.config.ts` | React frontend build output | `npm run build:web` | Medium |

Frontend assets are not served by custom Hono middleware or a catch-all route. `wrangler.jsonc` delegates them to Cloudflare Static Assets, and `_headers` owns the static-response header policy.

## Configuration And Build

| File | Responsibility | Important rule |
| --- | --- | --- |
| `wrangler.jsonc` | Worker identity, vars, AI/assets/DO bindings, migrations, observability | Migration tags are append-only |
| `vite.config.ts` | Flue plus Cloudflare Worker build | Keep `flue()` before `cloudflare()` |
| `vitest.config.ts` | Test discovery and environment | Keep tests isolated from generated output |
| `tsconfig.json` | TypeScript safety and path scope | Run `npm run check:types` after source changes |
| `package.json` | Scripts and dependency graph | `npm run check` is the release gate |
| `package-lock.json` | Reproducible dependency resolution | Commit dependency changes with this file |
| `scripts/prepare-deploy.mjs` | Places frontend assets in generated Flue deployment output | Run only after successful builds |
| `.gitignore` | Excludes downloaded/generated/local artifacts | Do not ignore source or lockfiles |

## Tests

| File | Protected behavior |
| --- | --- |
| `test/activity.test.ts` | Reasoning ownership, Kimi fallback tags, tool display, final-tool answer boundary |
| `test/conversation-lock.test.ts` | Cross-tab exclusion, marker replay, definitive rejection, settlement uncertainty |
| `test/registry.test.ts` | Model/source allowlists, source masks, prompt envelope validation |
| `test/security.test.ts` | Conversation signatures, ownership middleware, route validation, response headers |

Prefer unit tests at these policy boundaries. Browser screenshots are useful for visual review but do not replace deterministic parsing, recovery, and security tests.

## Documentation

| File | Audience |
| --- | --- |
| `README.md` | Operators and first-time contributors |
| `docs/CODEBASE_OVERVIEW.md` | Engineers learning architecture and runtime flow |
| `docs/FILE_GUIDE.md` | Maintainers deciding where to make a change |
| `docs/TROUBLESHOOTING.md` | Developers diagnosing symptoms |

## Generated Or Machine-Local Artifacts

Do not edit these paths directly:

- `node_modules/`: downloaded dependencies
- `dist/`: generated Flue/Worker deployment output
- `dist-web/`: generated React assets
- `.wrangler/`: local Wrangler state
- `.flue-vite/`: generated Flue build state
- `.flue-vite.wrangler.jsonc`: generated local Wrangler configuration
- `worker-configuration.d.ts`: generated Wrangler binding declarations
- `.dev.vars`: local secrets
- `*.log`: local command output
- `.claude/`, `.codex/`, `.opencode/`, and `skills/`: local AI/session tooling ignored through `.git/info/exclude`

If generated output looks wrong, fix the owning source or configuration and regenerate it. Do not patch the generated copy.

## Common Change Paths

### Add a model

Edit `MODEL_REGISTRY` in `src/lib/registry.ts`, update registry tests, then verify structured reasoning/answer behavior with that provider.

### Add an MCP source

Edit `MCP_REGISTRY`, assign a unique power-of-two bit, require HTTPS, add an optional environment override only if needed, and extend registry tests.

### Change chat rendering

Start in `frontend/src/activity.ts` for ownership/projection rules. Change `App.tsx` only for presentation and interaction. Add regressions before modifying provider fallbacks.

### Change submission reliability

Start in `frontend/src/conversation-lock.ts`. Preserve the exact payload and idempotency key during uncertain admission, hold the Web Lock through settlement, and clear only owned markers.

### Change API security

Start in `src/app.ts` and `frontend/public/_headers`. Verify Worker API headers and static-asset CSP independently.

### Change durable infrastructure

Update source/bindings, append a new Wrangler migration, build with Flue generation, and inspect the generated configuration before deployment.
