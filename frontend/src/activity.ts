// Flue supplies the persisted message-part shape rendered by the frontend.
import type { FlueConversationMessage } from '@flue/react';

// Registry labels turn internal MCP tool prefixes into readable vendor names.
import { MCP_REGISTRY } from '../../src/lib/registry.ts';

// A trace item is the safe, display-only projection of reasoning or tool activity.
export type ResearchTraceItem = {
  id: string;
  kind: 'reasoning' | 'tool';
  label: string;
  detail: string;
  state: 'running' | 'complete' | 'error';
  durationMs?: number;
};

/**
 * Input:
 * - Untrusted tool-call input from a persisted Flue message part.
 *
 * Output:
 * - One short, safe detail string or an empty string.
 *
 * What this function does:
 * - Extracts only useful request fields and never exposes raw tool output in the UI.
 */
function detailFromInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of ['query', 'search_phrase', 'keywords', 'url', 'name', 'path', 'resource', 'task']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 180);
  }
  return '';
}

/**
 * Input:
 * - Flue's internal tool name.
 *
 * Output:
 * - A readable activity label.
 *
 * What this function does:
 * - Names skill operations directly and maps MCP prefixes to approved registry labels.
 */
function describeTool(toolName: string): string {
  if (toolName === 'activate_skill') return 'Activate skill';
  if (toolName === 'read_skill_resource') return 'Read skill resource';
  const match = /^mcp__([^_]+)__(.+)$/.exec(toolName);
  if (!match) return toolName.replaceAll('_', ' ');
  const server = MCP_REGISTRY.find((candidate) => candidate.id === match[1]);
  const operation = match[2].replaceAll('_', ' ');
  return `${server?.name ?? match[1]}: ${operation}`;
}

/**
 * Input:
 * - One persisted Flue conversation message.
 *
 * Output:
 * - Sanitized reasoning and tool steps for the collapsible activity panel.
 *
 * What this function does:
 * - Projects only display-safe fields while preserving running, complete, and error states.
 */
export function messageTrace(message: FlueConversationMessage): ResearchTraceItem[] {
  /**
   * Input:
   * - One message part and its stable position.
   *
   * Output:
   * - Zero or one safe trace rows.
   *
   * What this function does:
   * - Converts only reasoning and dynamic-tool parts while discarding all other part types.
   */
  return message.parts.flatMap<ResearchTraceItem>((part, index) => {
    if (part.type === 'reasoning' && part.text.trim()) {
      return [{
        id: `${message.id}:reasoning:${index}`,
        kind: 'reasoning' as const,
        label: 'Model reasoning',
        detail: part.text,
        state: part.state === 'streaming' ? 'running' as const : 'complete' as const,
      }];
    }
    if (part.type === 'dynamic-tool') {
      return [{
        id: part.toolCallId,
        kind: 'tool' as const,
        label: describeTool(part.toolName),
        detail: detailFromInput(part.input),
        state: part.state === 'input-available'
          ? 'running' as const
          : part.state === 'output-error'
            ? 'error' as const
            : 'complete' as const,
        durationMs: part.state === 'input-available' ? undefined : part.durationMs,
      }];
    }
    return [];
  });
}

/**
 * Input:
 * - One persisted Flue conversation message.
 *
 * Output:
 * - Its visible text parts joined in stream order.
 *
 * What this function does:
 * - Separates final answer text from reasoning and tool activity.
 */
export function messageText(message: FlueConversationMessage): string {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
