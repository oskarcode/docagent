// Flue's type keeps the fixture aligned with persisted production message parts.
import type { FlueConversationMessage } from '@flue/react';

// Vitest supplies test grouping and assertions.
import { describe, expect, it } from 'vitest';

// The projection helpers are tested independently from React rendering.
import { messageText, messageTrace } from '../frontend/src/activity.ts';

// This representative message includes reasoning, skill actions, MCP calls, and final text.
const message: FlueConversationMessage = {
  id: 'assistant-1',
  role: 'assistant',
  purpose: 'assistant',
  display: 'visible',
  parts: [
    { type: 'reasoning', text: 'I should verify the current API behavior.', state: 'done' },
    {
      type: 'dynamic-tool',
      toolName: 'activate_skill',
      toolCallId: 'skill-1',
      state: 'output-available',
      input: { name: 'research-planning' },
      output: 'Raw skill instructions must not enter the trace.',
      durationMs: 15,
    },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__cloudflare-docs__search_cloudflare_documentation',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { query: 'Durable Objects alarms' },
      output: 'Raw MCP output must not enter the trace.',
      durationMs: 125,
    },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__aws-knowledge__search_documentation',
      toolCallId: 'tool-2',
      state: 'input-available',
      input: { search_phrase: 'Lambda regional availability' },
    },
    { type: 'text', text: 'Sourced answer', state: 'done' },
  ],
};

describe('per-response research trace', () => {
  /**
   * Input:
   * - A representative assistant message containing private tool output.
   *
   * Output:
   * - Assertions for readable labels, lifecycle state, timing, and output redaction.
   *
   * What this function does:
   * - Prevents internal MCP/skill responses from leaking into the browser trace.
   */
  it('projects reasoning and sanitized MCP activity without tool output', () => {
    expect(messageTrace(message)).toEqual([
      {
        id: 'assistant-1:reasoning:0',
        kind: 'reasoning',
        label: 'Model reasoning',
        detail: 'I should verify the current API behavior.',
        state: 'complete',
      },
      {
        id: 'skill-1',
        kind: 'tool',
        label: 'Activate skill',
        detail: 'research-planning',
        state: 'complete',
        durationMs: 15,
      },
      {
        id: 'tool-1',
        kind: 'tool',
        label: 'Cloudflare Docs: search cloudflare documentation',
        detail: 'Durable Objects alarms',
        state: 'complete',
        durationMs: 125,
      },
      {
        id: 'tool-2',
        kind: 'tool',
        label: 'AWS Knowledge: search documentation',
        detail: 'Lambda regional availability',
        state: 'running',
        durationMs: undefined,
      },
    ]);
    expect(JSON.stringify(messageTrace(message))).not.toContain('Raw MCP output');
  });

  /**
   * Input:
   * - A multipart assistant response.
   *
   * Output:
   * - An assertion that only final answer text enters the transcript.
   *
   * What this function does:
   * - Protects the separation between visible answers and diagnostic activity.
   */
  it('extracts only answer text for the transcript', () => {
    expect(messageText(message)).toBe('Sourced answer');
  });
});
