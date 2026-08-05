'use agent';

// Flue hooks configure the durable agent's model, instructions, skills, MCP tools, and response metadata.
import {
  type AgentProps,
  useMcpConnection,
  useInstruction,
  useModel,
  useResponseFinish,
  useResponseStart,
  useSkill,
} from '@flue/runtime';

// Packaged Markdown gives the model its stable behavior and progressive research workflow.
import agentContext from './AGENT.md';
import researchPlanning from '../skills/research-planning/SKILL.md';

// The shared registry validates the model and source choices encoded in each conversation ID.
import {
  conversationConfigFromId,
  MCP_REGISTRY,
  modelById,
  type McpServerId,
} from '../lib/registry.ts';

/**
 * Input:
 * - One approved MCP server ID.
 *
 * Output:
 * - Its optional environment URL and bearer token overrides.
 *
 * What this function does:
 * - Keeps secrets and environment-specific endpoints out of the public source registry.
 */
function mcpRuntimeConfig(id: McpServerId): { url?: string; auth?: string } {
  if (id === 'cloudflare-docs') {
    return {
      url: process.env.CF_DOCS_VECTORIZE_MCP_URL?.trim(),
      auth: process.env.CF_DOCS_VECTORIZE_MCP_TOKEN?.trim(),
    };
  }
  return {
    url: process.env.AWS_KNOWLEDGE_MCP_URL?.trim(),
    auth: process.env.AWS_KNOWLEDGE_MCP_TOKEN?.trim(),
  };
}

/**
 * Input:
 * - Flue's durable conversation ID and runtime agent properties.
 *
 * Output:
 * - The system prompt for one configured, durable research agent.
 *
 * What this function does:
 * - Selects the pinned model, mounts the research skill, connects approved MCP sources, and records response metadata.
 */
export function ResearchAgent({ id }: AgentProps) {
  // The signed ID is the source of truth so a restored thread cannot silently change model or sources.
  const { model: modelId, mcpServerIds } = conversationConfigFromId(id);
  const model = modelById(modelId);
  const startedAt = Date.now();

  useModel(model.specifier, { thinkingLevel: 'medium' });
  useSkill(researchPlanning);
  useInstruction(agentContext);

  // Connections are mounted in registry order for predictable tool names and source ordering.
  for (const server of MCP_REGISTRY) {
    if (!mcpServerIds.includes(server.id)) continue;
    const runtime = mcpRuntimeConfig(server.id);
    useMcpConnection({
      name: server.id,
      url: runtime.url || server.url,
      auth: runtime.auth || undefined,
      optional: true,
    });
  }

  /**
   * Input:
   * - The start of one model response.
   *
   * Output:
   * - Immutable model/source metadata and a timing baseline.
   *
   * What this function does:
   * - Attaches diagnostic context before Flue begins streaming.
   */
  useResponseStart(() => ({ model: modelId, startedAt, mcpServerIds }));
  /**
   * Input:
   * - Flue's completed response and the metadata captured at response start.
   *
   * Output:
   * - Model/source identifiers, elapsed time, and provider usage.
   *
   * What this function does:
   * - Produces compact completion diagnostics without exposing tool output.
   */
  useResponseFinish(({ metadata, response }) => ({
    model: modelId,
    mcpServerIds,
    elapsedMs: Date.now() - (typeof metadata.startedAt === 'number' ? metadata.startedAt : startedAt),
    usage: response.usage,
  }));

  return `
You are a cross-vendor technical documentation search agent.

For every substantive Cloudflare or AWS documentation request, your first tool call MUST be \`activate_skill\` with the skill name \`research-planning\`. Do not call an MCP documentation tool before activating that skill. After activation, follow the skill instructions, including reading any required supporting resource, then answer the user directly with current official evidence.
  `.trim();
}

ResearchAgent.agentName = 'research-agent';
ResearchAgent.durability = { maxAttempts: 5, timeoutMs: 15 * 60 * 1000 };
