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
    { type: 'reasoning', text: '<think>I should verify the current API behavior.</think>', state: 'done' },
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
  it('keeps sanitized reasoning in the event trace without exposing tool output', () => {
    expect(messageTrace(message)).toEqual([
      {
        id: 'assistant-1:reasoning:0',
        kind: 'reasoning',
        label: 'Reasoning',
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
    expect(JSON.stringify(messageTrace(message))).not.toContain('<think>');
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

  it('extracts tagged reasoning from answer text into the event trace', () => {
    const tagged = {
      ...message,
      metadata: { model: 'kimi-k2-6' },
      parts: [{ type: 'text', text: '<think>Check the source.</think>Final answer', state: 'done' }],
    } satisfies FlueConversationMessage;

    expect(messageText(tagged)).toBe('Final answer');
    expect(messageTrace(tagged)[0]?.detail).toBe('Check the source.');
  });

  it('withholds incomplete streamed reasoning from the answer', () => {
    const streaming = {
      ...message,
      metadata: { model: 'kimi-k2-6' },
      parts: [{ type: 'text', text: '<think>Still checking', state: 'streaming' }],
    } satisfies FlueConversationMessage;

    expect(messageText(streaming)).toBe('');
    expect(messageTrace(streaming)[0]).toMatchObject({ detail: 'Still checking', state: 'running' });
  });

  it('does not retroactively reclassify an orphan Kimi closing marker', () => {
    const orphanClosingMarker = {
      ...message,
      metadata: { model: 'kimi-k2-6' },
      parts: [{ type: 'text', text: 'Private reasoning</think>Visible answer', state: 'streaming' }],
    } satisfies FlueConversationMessage;

    expect(messageText(orphanClosingMarker)).toBe('Private reasoning</think>Visible answer');
    expect(messageTrace(orphanClosingMarker)).toEqual([]);
  });

  it('preserves literal thinking tags in user and non-Kimi text', () => {
    const user = {
      ...message,
      role: 'user',
      purpose: 'user',
      metadata: { model: 'kimi-k2-6' },
      parts: [{ type: 'text', text: 'Explain <think> as a literal tag.', state: 'done' }],
    } satisfies FlueConversationMessage;
    const nonKimi = {
      ...message,
      metadata: { model: 'glm-4.7' },
      parts: [{ type: 'text', text: 'Use <think>literal</think> markup.', state: 'done' }],
    } satisfies FlueConversationMessage;

    expect(messageText(user)).toBe('Explain <think> as a literal tag.');
    expect(messageText(nonKimi)).toBe('Use <think>literal</think> markup.');
    expect(messageTrace(user)).toEqual([]);
    expect(messageTrace(nonKimi)).toEqual([]);
  });

  it('preserves literal thinking tags inside a Kimi answer', () => {
    const kimiExample = {
      ...message,
      metadata: { model: 'kimi-k2-6' },
      parts: [{ type: 'text', text: 'Use `<think>literal</think>` in this example.', state: 'done' }],
    } satisfies FlueConversationMessage;

    expect(messageText(kimiExample)).toBe('Use `<think>literal</think>` in this example.');
    expect(messageTrace(kimiExample)).toEqual([]);
  });

  it('keeps structured Kimi text in the answer while reasoning stays in Events', () => {
    const structured = {
      ...message,
      metadata: { model: 'kimi-k2-7-code' },
      parts: [
        { type: 'reasoning', text: 'Check the source.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'mcp__cloudflare-docs__search_cloudflare_documentation',
          toolCallId: 'tool-3',
          state: 'output-available',
          input: { query: 'Workers limits' },
          output: 'private',
        },
        { type: 'text', text: 'Live final answer', state: 'streaming' },
      ],
    } satisfies FlueConversationMessage;

    expect(messageText(structured)).toBe('Live final answer');
    expect(messageTrace(structured).map((item) => item.kind)).toEqual(['reasoning', 'tool']);
  });

  it('keeps GLM reasoning in Events and excludes narration before the final tool', () => {
    const glm = {
      ...message,
      metadata: { model: 'glm-5-2' },
      parts: [
        { type: 'reasoning', text: 'Private draft that resembles a final answer.', state: 'done' },
        { type: 'text', text: 'Let me search one more source.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'mcp__aws-knowledge__search_documentation',
          toolCallId: 'tool-4',
          state: 'output-available',
          input: { search_phrase: 'Durable Functions' },
          output: 'private',
        },
        { type: 'reasoning', text: 'Another private answer draft.', state: 'done' },
        { type: 'text', text: 'Final sourced answer', state: 'done' },
      ],
    } satisfies FlueConversationMessage;

    expect(messageText(glm)).toBe('Final sourced answer');
    expect(messageTrace(glm)).toEqual([
      {
        id: 'assistant-1:reasoning:0',
        kind: 'reasoning',
        label: 'Reasoning',
        detail: 'Private draft that resembles a final answer.',
        state: 'complete',
      },
      {
        id: 'tool-4',
        kind: 'tool',
        label: 'AWS Knowledge: search documentation',
        detail: 'Durable Functions',
        state: 'complete',
        durationMs: undefined,
      },
      {
        id: 'assistant-1:reasoning:3',
        kind: 'reasoning',
        label: 'Reasoning',
        detail: 'Another private answer draft.',
        state: 'complete',
      },
    ]);
  });

  it('joins every final text part after the last tool boundary', () => {
    const multipart = {
      ...message,
      parts: [
        { type: 'text', text: 'Searching now.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'mcp__cloudflare-docs__search_cloudflare_documentation',
          toolCallId: 'tool-5',
          state: 'output-available',
          input: { query: 'Durable Objects' },
          output: 'private',
        },
        { type: 'text', text: 'Final ', state: 'done' },
        { type: 'text', text: 'answer', state: 'streaming' },
      ],
    } satisfies FlueConversationMessage;

    expect(messageText(multipart)).toBe('Final answer');
  });

  it('uses a failed tool as the final answer boundary', () => {
    const failedTool = {
      ...message,
      parts: [
        { type: 'text', text: 'Trying another source.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'mcp__aws-knowledge__search_documentation',
          toolCallId: 'tool-6',
          state: 'output-error',
          input: { search_phrase: 'Durable Functions' },
          errorText: 'Unavailable',
        },
        { type: 'text', text: 'Answer with the available evidence.', state: 'done' },
      ],
    } satisfies FlueConversationMessage;

    expect(messageText(failedTool)).toBe('Answer with the available evidence.');
  });

  it('preserves multipart text when no tool boundary exists', () => {
    const multipartUser = {
      ...message,
      role: 'user',
      purpose: 'user',
      parts: [
        { type: 'text', text: 'Compare ', state: 'done' },
        { type: 'text', text: 'these services.', state: 'done' },
      ],
    } satisfies FlueConversationMessage;

    expect(messageText(multipartUser)).toBe('Compare these services.');
  });
});
