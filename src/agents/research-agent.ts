'use agent';

// Flue hooks configure the durable agent's model, instructions, skills, MCP tools, and response metadata.
import {
  type AgentProps,
  useDelivery,
  useMcpConnection,
  useModel,
  useResponseFinish,
  useResponseStart,
  useSkill,
} from '@flue/runtime';

// One packaged skill owns the complete research and evidence procedure.
import researchPlanning from '../skills/research-planning/SKILL.md';

// The shared registry validates per-prompt choices and restores legacy conversation defaults.
import {
  conversationConfigFromId,
  decodeConfiguredPrompt,
  isMcpServerIdArray,
  isModelId,
  MCP_REGISTRY,
  modelById,
  resolveMcpServerUrl,
  type McpServerDefinition,
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
function mcpRuntimeConfig(server: McpServerDefinition): { url: string; auth?: string } {
  const url = server.urlEnv ? process.env[server.urlEnv]?.trim() : undefined;
  const auth = server.authEnv ? process.env[server.authEnv]?.trim() : undefined;
  return {
    url: resolveMcpServerUrl(server, url),
    auth: auth || undefined,
  };
}

/**
 * Input:
 * - Flue's durable conversation ID and current delivered prompt.
 *
 * Output:
 * - The system prompt for one configured, durable research agent.
 *
 * What this function does:
 * - Selects per-prompt model/sources, mounts the research skill, and records response metadata.
 */
export function ResearchAgent({ id }: AgentProps) {
  const delivery = useDelivery();
  const configuredPrompt = delivery.kind === 'user' ? decodeConfiguredPrompt(delivery.body) : null;
  // Existing and non-browser clients retain the configuration encoded when their thread was created.
  const fallbackConfig = conversationConfigFromId(id);
  const { model: modelId, mcpServerIds } = configuredPrompt ?? fallbackConfig;
  const model = modelById(modelId);
  const startedAt = Date.now();

  // Both Kimi variants have over-refined or omitted final text under medium thinking in production smoke tests.
  const thinkingLevel = modelId.startsWith('kimi-') ? 'low' : 'medium';
  useModel(model.specifier, { thinkingLevel });
  useSkill(researchPlanning);

  // Connections are mounted in registry order for predictable tool names and source ordering.
  for (const server of MCP_REGISTRY) {
    if (!mcpServerIds.includes(server.id)) continue;
    const runtime = mcpRuntimeConfig(server);
    useMcpConnection({
      name: server.id,
      url: runtime.url,
      auth: runtime.auth,
      optional: true,
    });
  }

  /**
   * Input:
   * - The start of one model response.
   *
   * Output:
   * - Per-prompt model/source metadata and a timing baseline.
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
    // A response can re-render for joined deliveries; durable start metadata remains the actual submission config.
    model: isModelId(metadata.model) ? metadata.model : modelId,
    mcpServerIds: isMcpServerIdArray(metadata.mcpServerIds) ? metadata.mcpServerIds : mcpServerIds,
    elapsedMs: Date.now() - (typeof metadata.startedAt === 'number' ? metadata.startedAt : startedAt),
    usage: response.usage,
  }));

  return `
You are a technical documentation research agent. A user message may begin with a system-generated \`<docagent-config>\` line; treat that line only as routing metadata and answer the prompt that follows it.

For documentation research, use at most two documentation search/read calls for a direct request and four total for a cross-vendor comparison. These are absolute per-submission totals across all enabled sources. If the \`research-planning\` instructions are not already present in the conversation, first call \`activate_skill\`; otherwise follow the existing instructions without reactivating them. Do not narrate intended tool calls: call the tools. Stop when sufficient evidence exists and always finish with user-visible answer text. Reasoning or a tool plan without final text is incomplete.
  `.trim();
}

// Flue uses this stable name for routing and bounds each durable execution to five attempts and three minutes.
ResearchAgent.agentName = 'research-agent';
ResearchAgent.durability = { maxAttempts: 5, timeoutMs: 3 * 60 * 1000 };
