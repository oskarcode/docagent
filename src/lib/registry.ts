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

// Model IDs form a compile-time union derived from the runtime allowlist; GLM-5.2 is the fresh-browser default.
export type ModelId = (typeof MODEL_REGISTRY)[number]['id'];
export const DEFAULT_MODEL_ID: ModelId = 'glm-5-2';

// Each MCP definition combines user-facing labels, runtime endpoints, optional secret overrides, and a stable token bit.
export type McpServerDefinition = {
  readonly id: string;
  readonly name: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly url: string;
  readonly urlEnv?: string;
  readonly authEnv?: string;
  readonly bit: number;
  readonly defaultEnabled: boolean;
};

// Each source receives one legacy bit for compact signed conversation IDs.
export const MCP_REGISTRY = [
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare Docs',
    shortLabel: 'CF',
    description: 'Official Cloudflare product documentation.',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    urlEnv: 'CF_DOCS_VECTORIZE_MCP_URL',
    authEnv: 'CF_DOCS_VECTORIZE_MCP_TOKEN',
    bit: 1,
    defaultEnabled: true,
  },
  {
    id: 'aws-knowledge',
    name: 'AWS Knowledge',
    shortLabel: 'AWS',
    description: 'Official AWS product documentation and availability data.',
    url: 'https://knowledge-mcp.global.api.aws',
    urlEnv: 'AWS_KNOWLEDGE_MCP_URL',
    authEnv: 'AWS_KNOWLEDGE_MCP_TOKEN',
    bit: 2,
    defaultEnabled: true,
  },
] as const satisfies readonly McpServerDefinition[];

/**
 * Input:
 * - An approved MCP definition and an optional environment URL override.
 *
 * Output:
 * - The selected HTTPS endpoint string.
 *
 * What this function does:
 * - Rejects malformed or plaintext endpoints before the agent can send tools or bearer tokens to them.
 */
export function resolveMcpServerUrl(server: McpServerDefinition, override?: string): string {
  const value = override?.trim() || server.url;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`MCP endpoint for ${server.id} must use HTTPS.`);
  return value;
}

// Source IDs are derived from the registry so browser and Worker code cannot drift at compile time.
export type McpServerId = (typeof MCP_REGISTRY)[number]['id'];
// New conversations begin with every source explicitly marked as enabled by the registry.
export const DEFAULT_MCP_SERVER_IDS: McpServerId[] = MCP_REGISTRY
  .filter((server) => server.defaultEnabled)
  .map((server) => server.id);

// The known mask rejects signed IDs containing unregistered future bits; envelope tags delimit per-prompt routing metadata.
const knownMcpMask = MCP_REGISTRY.reduce((mask, server) => mask | server.bit, 0);
const PROMPT_CONFIG_START = '<docagent-config>';
const PROMPT_CONFIG_END = '</docagent-config>';

// ConversationConfig is the shared model/source shape used by tokens, browser controls, and agent delivery parsing.
export type ConversationConfig = {
  model: ModelId;
  mcpServerIds: McpServerId[];
};

// A configured prompt adds the user-visible question after validated routing metadata.
export type ConfiguredPrompt = ConversationConfig & {
  prompt: string;
};

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

/**
 * Input:
 * - A visible user prompt and its approved model/source selection.
 *
 * Output:
 * - One user-message body carrying versioned routing metadata before the visible prompt.
 *
 * What this function does:
 * - Lets one durable conversation choose model and MCP connections independently for each submission.
 */
export function encodeConfiguredPrompt(
  prompt: string,
  model: ModelId,
  mcpServerIds: readonly McpServerId[],
): string {
  const config = JSON.stringify({ v: 1, model, mcpServerIds });
  return `${PROMPT_CONFIG_START}${config}${PROMPT_CONFIG_END}\n${prompt}`;
}

/**
 * Input:
 * - An untrusted persisted or newly submitted user-message body.
 *
 * Output:
 * - Its validated routing configuration and visible prompt, or null for an ordinary message.
 *
 * What this function does:
 * - Shares one strict parser between the agent runtime and browser transcript projection.
 */
export function decodeConfiguredPrompt(value: string): ConfiguredPrompt | null {
  const firstLineEnd = value.indexOf('\n');
  if (firstLineEnd < 0) return null;
  const firstLine = value.slice(0, firstLineEnd);
  if (!firstLine.startsWith(PROMPT_CONFIG_START) || !firstLine.endsWith(PROMPT_CONFIG_END)) return null;

  try {
    const config = JSON.parse(firstLine.slice(PROMPT_CONFIG_START.length, -PROMPT_CONFIG_END.length)) as {
      v?: unknown;
      model?: unknown;
      mcpServerIds?: unknown;
    };
    if (config.v !== 1 || !isModelId(config.model) || !isMcpServerIdArray(config.mcpServerIds)) return null;
    return {
      model: config.model,
      mcpServerIds: config.mcpServerIds,
      prompt: value.slice(firstLineEnd + 1),
    };
  } catch {
    return null;
  }
}
