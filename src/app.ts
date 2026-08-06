// Cloudflare exposes runtime bindings through this module-level environment object.
import { env as workerEnv } from 'cloudflare:workers';

// Flue supplies the AI provider adapter and durable conversation routes.
import { setProvider } from '@flue/runtime';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import { createAgentRouter } from '@flue/runtime/routing';

// Hono is the small API router used to protect and mount Flue conversations.
import { Hono } from 'hono';

// Application modules own the research agent, approved configuration, and browser-session security.
import { ResearchAgent } from './agents/research-agent.ts';
import { isMcpServerIdArray, isModelId } from './lib/registry.ts';
import {
  createConversationToken,
  getExistingSession,
  getOrCreateSession,
  verifyConversationToken,
} from './lib/session.ts';

// Bindings are Cloudflare-provided dependencies, similar to configured services injected through Django settings.
type Bindings = {
  AI: Ai;
  AI_GATEWAY_ID: string;
};

// Flue hooks run outside Hono handlers, so they read bindings from Cloudflare's module environment.
const bindings = workerEnv as unknown as Bindings;

// All model requests use the same Workers AI binding and named AI Gateway.
setProvider(cloudflareBindingProvider({
  binding: bindings.AI,
  gateway: { id: bindings.AI_GATEWAY_ID || 'default' },
  streamIdleTimeoutMs: 5 * 60 * 1000,
}));

// This router owns session isolation before handing approved requests to Flue.
const app = new Hono<{ Bindings: Bindings }>();

// Static Assets applies the same policy from `frontend/public/_headers`; API responses run here.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

/**
 * Input:
 * - A GET request to the health endpoint.
 *
 * Output:
 * - A small JSON readiness response.
 *
 * What this function does:
 * - Confirms that the Worker router is reachable without invoking a model.
 */
app.get('/api/health', (c) => c.json({ ok: true, agent: 'research-agent', framework: 'flue' }));

/**
 * Input:
 * - JSON containing an approved `model` alias.
 *
 * Output:
 * - HTTP 201 with a signed conversation ID, or HTTP 400 for invalid input.
 *
 * What this function does:
 * - Creates or reuses an anonymous browser session and issues a session-bound conversation token.
 */
app.post('/api/conversations', async (c) => {
  const body: { model?: unknown; mcpServerIds?: unknown } = await c.req.json<{
    model?: unknown;
    mcpServerIds?: unknown;
  }>().catch(() => ({}));
  if (!isModelId(body.model)) return c.json({ error: 'Select a supported model.' }, 400);
  if (!isMcpServerIdArray(body.mcpServerIds)) return c.json({ error: 'Select supported documentation sources.' }, 400);

  const session = getOrCreateSession(c.req.raw);
  const conversationId = await createConversationToken(session.id, body.model, body.mcpServerIds);
  if (session.cookie) c.header('Set-Cookie', session.cookie);
  return c.json({ conversationId, model: body.model, mcpServerIds: body.mcpServerIds }, 201);
});

/**
 * Input:
 * - Any request targeting one durable research conversation.
 *
 * Output:
 * - The Flue response or HTTP 401 for invalid ownership.
 *
 * What this function does:
 * - Verifies session ownership before Flue sees the request.
 */
app.use('/api/agents/research/*', async (c, next) => {
  const sessionId = getExistingSession(c.req.raw);
  const relativePath = c.req.path.slice('/api/agents/research/'.length);
  const conversationId = relativePath.split('/', 1)[0];

  // Ownership is checked before Flue can read history, stream output, accept input, or cancel work.
  if (!sessionId || !conversationId || !(await verifyConversationToken(sessionId, conversationId))) {
    return c.json({ error: 'This conversation does not belong to the current browser session.' }, 401);
  }

  await next();
});

// Flue owns streaming, persistence, cancellation, and history beneath this route prefix.
app.route('/api/agents/research', createAgentRouter(ResearchAgent));

export default app;
