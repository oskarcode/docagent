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
    url: url || server.url,
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

  useModel(model.specifier, { thinkingLevel: 'medium' });
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

For every substantive documentation request, your first tool call MUST be \`activate_skill\` with the skill name \`research-planning\`. Do not call an MCP documentation tool before activating that skill. After activation, follow the skill and answer directly with current official evidence.
  `.trim();
}

ResearchAgent.agentName = 'research-agent';
ResearchAgent.durability = { maxAttempts: 5, timeoutMs: 15 * 60 * 1000 };
