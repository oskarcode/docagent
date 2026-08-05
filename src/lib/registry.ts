// This allowlist is the only set of Workers AI models that the public UI and API accept.
export const MODEL_REGISTRY = [
  {
    id: 'kimi-k2-6',
    name: 'Kimi K2.6',
    provider: 'Moonshot AI',
    specifier: 'cloudflare/@cf/moonshotai/kimi-k2.6',
    description: 'General-purpose agentic research with reasoning, vision, and long context.',
    capabilities: ['Reasoning', 'Tools', 'Vision'],
  },
  {
    id: 'kimi-k2-7-code',
    name: 'Kimi K2.7 Code',
    provider: 'Moonshot AI',
    specifier: 'cloudflare/@cf/moonshotai/kimi-k2.7-code',
    description: 'Code-focused research and long-horizon technical analysis.',
    capabilities: ['Reasoning', 'Tools', 'Vision', 'Paid plan'],
  },
  {
    id: 'glm-5-2',
    name: 'GLM-5.2',
    provider: 'Z.ai',
    specifier: 'cloudflare/@cf/zai-org/glm-5.2',
    description: 'Large-context reasoning for complex technical and coding questions.',
    capabilities: ['Reasoning', 'Tools', 'Large context'],
  },
  {
    id: 'glm-4-7-flash',
    name: 'GLM-4.7 Flash',
    provider: 'Z.ai',
    specifier: 'cloudflare/@cf/zai-org/glm-4.7-flash',
    description: 'Fast multilingual research with efficient multi-turn tool use.',
    capabilities: ['Reasoning', 'Tools', 'Fast'],
  },
  {
    id: 'gemma-4-26b',
    name: 'Gemma 4 26B',
    provider: 'Google',
    specifier: 'cloudflare/@cf/google/gemma-4-26b-a4b-it',
    description: 'Efficient multimodal research with reasoning and tool calling.',
    capabilities: ['Reasoning', 'Tools', 'Vision'],
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS 120B',
    provider: 'OpenAI',
    specifier: 'cloudflare/@cf/openai/gpt-oss-120b',
    description: 'Open-weight general-purpose reasoning for production research.',
    capabilities: ['Reasoning', 'Tools'],
  },
] as const;

export type ModelId = (typeof MODEL_REGISTRY)[number]['id'];
export const DEFAULT_MODEL_ID: ModelId = 'glm-5-2';

// Each source receives one bit so source selection fits safely inside the signed conversation ID.
export const MCP_REGISTRY = [
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare Docs',
    shortLabel: 'CF',
    description: 'Official Cloudflare product documentation.',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    bit: 1,
    defaultEnabled: true,
  },
  {
    id: 'aws-knowledge',
    name: 'AWS Knowledge',
    shortLabel: 'AWS',
    description: 'Official AWS product documentation and availability data.',
    url: 'https://knowledge-mcp.global.api.aws',
    bit: 2,
    defaultEnabled: true,
  },
] as const;

export type McpServerId = (typeof MCP_REGISTRY)[number]['id'];
// New conversations begin with every source explicitly marked as enabled by the registry.
export const DEFAULT_MCP_SERVER_IDS: McpServerId[] = MCP_REGISTRY
  .filter((server) => server.defaultEnabled)
  .map((server) => server.id);

const knownMcpMask = MCP_REGISTRY.reduce((mask, server) => mask | server.bit, 0);

/**
 * Input:
 * - An untrusted value, commonly from JSON or local storage.
 *
 * Output:
 * - True when the value is an approved model ID, with TypeScript narrowing.
 *
 * What this function does:
 * - Enforces the model allowlist at runtime; TypeScript types alone cannot validate external input.
 */
export function isModelId(value: unknown): value is ModelId {
  return MODEL_REGISTRY.some((model) => model.id === value);
}

/**
 * Input:
 * - An already validated model ID.
 *
 * Output:
 * - The complete model registry entry.
 *
 * What this function does:
 * - Converts the compact stored ID into the provider specifier and display metadata.
 */
export function modelById(id: ModelId) {
  return MODEL_REGISTRY.find((model) => model.id === id) ?? MODEL_REGISTRY[0];
}

/**
 * Input:
 * - An untrusted value.
 *
 * Output:
 * - True when the value names an approved MCP server.
 *
 * What this function does:
 * - Narrows external source IDs to the registry's finite union type.
 */
export function isMcpServerId(value: unknown): value is McpServerId {
  return MCP_REGISTRY.some((server) => server.id === value);
}

/**
 * Input:
 * - An untrusted source selection.
 *
 * Output:
 * - True for a non-empty, duplicate-free array of approved MCP server IDs.
 *
 * What this function does:
 * - Prevents empty, unknown, and duplicate source configurations from reaching a conversation.
 */
export function isMcpServerIdArray(value: unknown): value is McpServerId[] {
  return Array.isArray(value)
    && value.length > 0
    && new Set(value).size === value.length
    && value.every(isMcpServerId);
}

/**
 * Input:
 * - Approved MCP server IDs.
 *
 * Output:
 * - A compact base-36 bitmask string.
 *
 * What this function does:
 * - Encodes source selection in stable registry order for the signed conversation token.
 */
export function encodeMcpMask(ids: readonly McpServerId[]): string {
  return MCP_REGISTRY
    .filter((server) => ids.includes(server.id))
    .reduce((mask, server) => mask | server.bit, 0)
    .toString(36);
}

/**
 * Input:
 * - An untrusted base-36 bitmask string.
 *
 * Output:
 * - Approved source IDs, or null when the mask is malformed or contains unknown bits.
 *
 * What this function does:
 * - Reverses the compact token encoding while failing closed on future or invalid flags.
 */
export function decodeMcpMask(value: string): McpServerId[] | null {
  if (!/^[0-9a-z]+$/.test(value)) return null;
  const mask = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(mask) || mask < 0 || (mask & ~knownMcpMask) !== 0) return null;
  return MCP_REGISTRY.filter((server) => (mask & server.bit) !== 0).map((server) => server.id);
}

/**
 * Input:
 * - A signed-token-shaped conversation ID.
 *
 * Output:
 * - The validated model and source configuration encoded at the start of the ID.
 *
 * What this function does:
 * - Gives the agent and browser one shared parser for immutable thread configuration.
 */
export function conversationConfigFromId(id: string): { model: ModelId; mcpServerIds: McpServerId[] } {
  const [model, mask] = id.split('.', 2);
  const mcpServerIds = decodeMcpMask(mask ?? '');
  if (!isModelId(model) || !mcpServerIds) throw new Error('Invalid conversation configuration.');
  return { model, mcpServerIds };
}
