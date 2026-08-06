// Vitest provides the pytest-like test structure and assertions.
import { describe, expect, it } from 'vitest';

// Registry units are tested directly without starting a Worker or browser.
import {
  conversationConfigFromId,
  decodeConfiguredPrompt,
  DEFAULT_MODEL_ID,
  decodeMcpMask,
  encodeConfiguredPrompt,
  encodeMcpMask,
  isMcpServerIdArray,
  isModelId,
  MCP_REGISTRY,
  modelById,
  MODEL_REGISTRY,
  resolveMcpServerUrl,
} from '../src/lib/registry.ts';

describe('research registries', () => {
  /**
   * Input:
   * - Curated and arbitrary model identifiers.
   *
   * Output:
   * - Assertions that only approved Workers AI aliases resolve.
   *
   * What this function does:
   * - Protects the runtime model allowlist and provider specifiers from drift.
   */
  it('accepts only curated Workers AI model aliases', () => {
    expect(DEFAULT_MODEL_ID).toBe('glm-5-2');
    expect(MODEL_REGISTRY[0].id).toBe(DEFAULT_MODEL_ID);
    expect(isModelId('kimi-k2-6')).toBe(true);
    expect(isModelId('gpt-oss-120b')).toBe(true);
    expect(isModelId('@cf/arbitrary/model')).toBe(false);
    expect(MODEL_REGISTRY.every((model) => model.specifier.startsWith('cloudflare/@cf/'))).toBe(true);
    expect(modelById('glm-5-2').specifier).toBe('cloudflare/@cf/zai-org/glm-5.2');
  });

  /**
   * Input:
   * - Approved, unknown, empty, and encoded MCP source selections.
   *
   * Output:
   * - Assertions for mask round-tripping and invalid-input rejection.
   *
   * What this function does:
   * - Protects the compact legacy source configuration embedded in signed IDs.
   */
  it('round-trips approved MCP selections through a compact mask', () => {
    const selected = ['cloudflare-docs', 'aws-knowledge'] as const;
    const mask = encodeMcpMask(selected);
    expect(decodeMcpMask(mask)).toEqual(selected);
    expect(decodeMcpMask('z')).toBeNull();
    expect(isMcpServerIdArray([])).toBe(false);
    expect(isMcpServerIdArray(['cloudflare-docs', 'unknown'])).toBe(false);
    expect(conversationConfigFromId(`kimi-k2-6.${mask}.conversation.signature`)).toEqual({
      model: 'kimi-k2-6',
      mcpServerIds: selected,
    });
  });

  /**
   * Input:
   * - One visible prompt plus approved per-submission model and source choices.
   *
   * Output:
   * - Assertions for exact routing-metadata round trips and malformed-input rejection.
   *
   * What this function does:
   * - Prevents model/source switches from changing or leaking into the visible prompt text.
   */
  it('round-trips per-prompt configuration in one durable conversation', () => {
    const encoded = encodeConfiguredPrompt(
      'Compare the two answers.',
      'glm-5-2',
      ['cloudflare-docs'],
    );
    expect(decodeConfiguredPrompt(encoded)).toEqual({
      prompt: 'Compare the two answers.',
      model: 'glm-5-2',
      mcpServerIds: ['cloudflare-docs'],
    });
    expect(decodeConfiguredPrompt('An ordinary legacy prompt.')).toBeNull();
    expect(decodeConfiguredPrompt('<docagent-config>{"v":1,"model":"unknown","mcpServerIds":[]}</docagent-config>\nQuestion')).toBeNull();
  });

  /**
   * Input:
   * - The complete compile-time MCP registry.
   *
   * Output:
   * - Assertions for unique IDs, unique bit assignments, and deployable HTTPS endpoints.
   *
   * What this function does:
   * - Keeps adding a public MCP server to one validated registry entry instead of new runtime branches.
   */
  it('keeps MCP definitions safe for data-driven mounting', () => {
    expect(new Set(MCP_REGISTRY.map((server) => server.id)).size).toBe(MCP_REGISTRY.length);
    expect(MCP_REGISTRY.every((server) => /^[a-z0-9-]+$/.test(server.id))).toBe(true);
    expect(new Set(MCP_REGISTRY.map((server) => server.bit)).size).toBe(MCP_REGISTRY.length);
    expect(MCP_REGISTRY.every((server) => server.bit > 0 && (server.bit & (server.bit - 1)) === 0)).toBe(true);
    expect(MCP_REGISTRY.every((server) => new URL(server.url).protocol === 'https:')).toBe(true);
  });

  /**
   * Input:
   * - The Cloudflare source definition plus secure, plaintext, and malformed overrides.
   *
   * Output:
   * - The secure endpoint and assertions that unsafe overrides are rejected.
   *
   * What this function does:
   * - Prevents environment configuration from bypassing the registry's HTTPS trust boundary.
   */
  it('accepts only valid HTTPS MCP endpoint overrides', () => {
    const server = MCP_REGISTRY[0];
    expect(resolveMcpServerUrl(server, 'https://docs.example.com/mcp')).toBe('https://docs.example.com/mcp');
    expect(() => resolveMcpServerUrl(server, 'http://docs.example.com/mcp')).toThrow('must use HTTPS');
    expect(() => resolveMcpServerUrl(server, 'not a URL')).toThrow();
  });
});
