// Vitest provides the pytest-like test structure and assertions.
import { describe, expect, it } from 'vitest';

// Registry units are tested directly without starting a Worker or browser.
import {
  conversationConfigFromId,
  decodeMcpMask,
  encodeMcpMask,
  isMcpServerIdArray,
  isModelId,
  modelById,
  MODEL_REGISTRY,
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
   * - Protects the compact source configuration embedded in signed IDs.
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
});
