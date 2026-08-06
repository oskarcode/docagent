// React owns browser state, effects, deferred rendering, and event types.
import { useDeferredValue, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

// Flue restores durable messages and sends prompts to the selected agent URL.
import { useFlueAgent, type FlueConversationMessage } from '@flue/react';
import { createFlueClient } from '@flue/sdk';

// Markdown libraries render sourced answers with tables, links, and code blocks.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Shared runtime registries keep browser choices consistent with Worker validation.
import {
  decodeConfiguredPrompt,
  DEFAULT_MCP_SERVER_IDS,
  DEFAULT_MODEL_ID,
  encodeConfiguredPrompt,
  isMcpServerIdArray,
  isModelId,
  MCP_REGISTRY,
  MODEL_REGISTRY,
  modelById,
  type McpServerId,
  type ModelId,
} from '../../src/lib/registry.ts';

// Activity helpers separate final answer text from the sanitized reasoning/tool trace.
import { messageText, messageTrace } from './activity.ts';
import { submitWithConversationLock } from './conversation-lock.ts';

// Local-storage keys retain browser preferences and pointers to durable Flue conversations.
const STORAGE_KEY = 'tech_docs_flue_conversation';
const CONVERSATIONS_KEY = 'tech_docs_flue_conversations';
const MODEL_KEY = 'tech_docs_flue_model';
const MCP_KEY = 'tech_docs_flue_mcp_servers';
const DEFAULT_MODEL_VERSION_KEY = 'tech_docs_flue_default_model_version';
const UNTITLED_CONVERSATION = 'New research';
const MAX_SAVED_CONVERSATIONS = 30;

// Example prompts explain the supported research scope without auto-submitting a request.
const EXAMPLES = [
  'How should I design a production Worker with Durable Objects?',
  'What is the current AWS guidance for securing an S3 bucket?',
  'Compare Cloudflare Workers and AWS Lambda for an API backend.',
];

// The browser stores conversation metadata only; Flue persists the actual messages in Durable Objects.
type ConversationRecord = {
  id: string;
  model: ModelId;
  mcpServerIds: McpServerId[];
  title: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Input:
 * - Model and source values previously saved by this browser.
 *
 * Output:
 * - A validated preference pair with safe defaults.
 *
 * What this function does:
 * - Treats local storage as untrusted and rejects stale or malformed values.
 */
function storedPreferences(): Pick<ConversationRecord, 'model' | 'mcpServerIds'> {
  const modelValue = localStorage.getItem(MODEL_KEY);
  let mcpValue: unknown;
  try {
    mcpValue = JSON.parse(localStorage.getItem(MCP_KEY) ?? 'null');
  } catch {
    mcpValue = null;
  }
  return {
    model: isModelId(modelValue) ? modelValue : DEFAULT_MODEL_ID,
    mcpServerIds: isMcpServerIdArray(mcpValue) ? mcpValue : [...DEFAULT_MCP_SERVER_IDS],
  };
}

/**
 * Input:
 * - One untrusted local-storage value.
 *
 * Output:
 * - A normalized conversation pointer, or null.
 *
 * What this function does:
 * - Validates mutable browser metadata independently from the signed conversation ID.
 */
function parseConversation(value: unknown): ConversationRecord | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !isModelId(record.model) || !isMcpServerIdArray(record.mcpServerIds)) return null;
    const now = Date.now();
    return {
      id: record.id,
      model: record.model,
      mcpServerIds: record.mcpServerIds,
      title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : UNTITLED_CONVERSATION,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now,
    };
  } catch {
    return null;
  }
}

/**
 * Input:
 * - The current-conversation value in local storage.
 *
 * Output:
 * - A validated conversation pointer, or null.
 *
 * What this function does:
 * - Safely parses the browser's last-opened conversation.
 */
function storedConversation(): ConversationRecord | null {
  try {
    return parseConversation(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/**
 * Input:
 * - The validated current conversation, when one exists.
 *
 * Output:
 * - Up to 30 unique conversation pointers ordered by recent activity.
 *
 * What this function does:
 * - Repairs, deduplicates, sorts, and bounds the browser's conversation index.
 */
function storedConversations(current: ConversationRecord | null): ConversationRecord[] {
  let values: unknown[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) ?? '[]') as unknown;
    if (Array.isArray(stored)) values = stored;
  } catch {
    values = [];
  }
  const conversations = values.map(parseConversation).filter((value): value is ConversationRecord => value !== null);
  if (current && !conversations.some((conversation) => conversation.id === current.id)) conversations.push(current);
  return [...new Map(conversations.map((conversation) => [conversation.id, conversation])).values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SAVED_CONVERSATIONS);
}

/**
 * Input:
 * - The normalized browser conversation index.
 *
 * Output:
 * - No return value; local storage is updated.
 *
 * What this function does:
 * - Persists only durable-session pointers, not message content.
 */
function persistConversations(conversations: ConversationRecord[]) {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

/**
 * Input:
 * - The first prompt in a new conversation.
 *
 * Output:
 * - A compact one-line title.
 *
 * What this function does:
 * - Makes the history rail scannable while preserving short prompts verbatim.
 */
function conversationTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact;
}

/**
 * Input:
 * - One durable Flue message.
 *
 * Output:
 * - The validated model/source selection used for that message, when available.
 *
 * What this function does:
 * - Reads user configuration from the prompt envelope and assistant configuration from response metadata.
 */
function messageConfiguration(message: FlueConversationMessage) {
  if (message.role === 'user') return decodeConfiguredPrompt(messageText(message));
  const metadata = message.metadata;
  return metadata && isModelId(metadata.model) && isMcpServerIdArray(metadata.mcpServerIds)
    ? { model: metadata.model, mcpServerIds: metadata.mcpServerIds }
    : null;
}

/**
 * Input:
 * - An approved Workers AI model and non-empty MCP source selection.
 *
 * Output:
 * - A session-bound signed conversation ID from the Worker API.
 *
 * What this function does:
 * - Starts the server-side durable thread before the Flue React hook connects.
 */
async function requestConversation(model: ModelId, mcpServerIds: McpServerId[]): Promise<string> {
  const response = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, mcpServerIds }),
  });
  const body = await response.json() as { conversationId?: string; error?: string };
  if (!response.ok || !body.conversationId) throw new Error(body.error || 'Could not create a research conversation.');
  return body.conversationId;
}

/**
 * Input:
 * - One visible Flue message and its transcript position.
 *
 * Output:
 * - The user prompt or Markdown answer with an optional sanitized activity trace.
 *
 * What this function does:
 * - Keeps internal tool output separate from readable transcript content.
 */
function ConversationMessage({ message, index }: { message: FlueConversationMessage; index: number }) {
  const storedText = messageText(message);
  const configuration = messageConfiguration(message);
  const text = message.role === 'user' && configuration && 'prompt' in configuration
    ? configuration.prompt
    : storedText;
  const trace = messageTrace(message);
  if (!text && trace.length === 0 && message.role === 'assistant') return null;
  const traceRunning = trace.some((item) => item.state === 'running');

  return (
    <article className={`message ${message.role}`}>
      <div className="message-gutter">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <strong>{message.role === 'user' ? 'You' : 'Research'}</strong>
      </div>
      <div className="message-body">
        {configuration && (
          <p className="message-config">
            {modelById(configuration.model).name}
            {' / '}
            {configuration.mcpServerIds
              .map((id) => MCP_REGISTRY.find((server) => server.id === id)?.shortLabel ?? id)
              .join(' + ')}
          </p>
        )}
        {message.role === 'assistant' && trace.length > 0 && (
          <details className="response-trace">
            <summary>
              <span className={`trace-status ${traceRunning ? 'running' : ''}`} />
              Reasoning &amp; tools
              <small>{trace.length} {trace.length === 1 ? 'step' : 'steps'}</small>
            </summary>
            <div className="trace-list">
              {trace.map((item) => (
                <div className={`trace-item ${item.kind}`} key={item.id}>
                  <span className={`trace-mark ${item.state}`} />
                  <div>
                    <strong>{item.label}</strong>
                    {item.detail && (item.kind === 'reasoning'
                      ? <p>{item.detail}</p>
                      : <span>{item.detail}</span>)}
                  </div>
                  {item.durationMs !== undefined && <small>{(item.durationMs / 1000).toFixed(1)}s</small>}
                </div>
              ))}
            </div>
          </details>
        )}
        {message.role === 'assistant'
          ? text && <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          : <p>{text}</p>}
      </div>
    </article>
  );
}

/**
 * Input:
 * - Browser events, local storage, and the active Flue durable conversation.
 *
 * Output:
 * - The complete research desk interface.
 *
 * What this function does:
 * - Coordinates thread creation, restoration, model/source choices, history pointers, and prompt submission.
 */
export function App() {
  // Initialization runs once so malformed browser data is repaired before hooks connect to Flue.
  /**
   * Input:
   * - Browser local storage on the first render.
   *
   * Output:
   * - Repaired conversation history and initial preferences.
   *
   * What this function does:
   * - Computes initial React state once instead of reparsing storage on every render.
   */
  const [initial] = useState(() => {
    const storedCurrent = storedConversation();
    const conversations = storedConversations(storedCurrent);
    const preferences = storedCurrent ?? storedPreferences();
    const defaultModelChanged = localStorage.getItem(DEFAULT_MODEL_VERSION_KEY) !== DEFAULT_MODEL_ID;

    // A changed product default starts one fresh thread but keeps older pinned conversations available.
    if (defaultModelChanged) {
      localStorage.setItem(DEFAULT_MODEL_VERSION_KEY, DEFAULT_MODEL_ID);
      localStorage.setItem(MODEL_KEY, DEFAULT_MODEL_ID);
      localStorage.removeItem(STORAGE_KEY);
    }

    const conversation = defaultModelChanged ? null : storedCurrent;
    persistConversations(conversations);
    return {
      conversation,
      conversations,
      preferences: defaultModelChanged ? { ...preferences, model: DEFAULT_MODEL_ID } : preferences,
    };
  });
  // Controls select the model and sources for the next prompt in this durable conversation.
  const [model, setModel] = useState<ModelId>(initial.preferences.model);
  const [mcpServerIds, setMcpServerIds] = useState<McpServerId[]>(initial.preferences.mcpServerIds);
  const [conversationId, setConversationId] = useState(initial.conversation?.id ?? '');
  const [conversations, setConversations] = useState(initial.conversations);
  const [input, setInput] = useState('');
  const [uiError, setUiError] = useState('');
  const [isCreating, setIsCreating] = useState(!initial.conversation);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionAdmitted, setSubmissionAdmitted] = useState(false);
  const submissionPending = useRef(false);

  // Flue reconnects whenever the signed conversation ID changes and restores durable history automatically.
  const agentUrl = conversationId ? `/api/agents/research/${conversationId}` : undefined;
  const agent = useFlueAgent({ url: agentUrl });
  const messages = useDeferredValue(agent.messages);
  const visibleMessages = messages.filter((message) => message.display === 'visible' && (message.role === 'user' || message.role === 'assistant'));
  const busy = isCreating || isSubmitting || agent.status === 'submitted' || agent.status === 'streaming';
  const selectedModel = modelById(model);
  const activeConversation = conversations.find((conversation) => conversation.id === conversationId);

  /**
   * Input:
   * - The first browser render and its validated initial state.
   *
   * Output:
   * - A newly created conversation only when no prior pointer exists.
   *
   * What this function does:
   * - Ensures a fresh browser opens with a usable durable thread.
   */
  useEffect(() => {
    if (initial.conversation) return;
    void startNewConversation(model, mcpServerIds);
    // Initial preferences are intentionally read only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Input:
   * - Message or agent-status changes.
   *
   * Output:
   * - The transcript scrolled to its newest content.
   *
   * What this function does:
   * - Keeps streamed answer tokens visible without changing message state.
   */
  useEffect(() => {
    const transcript = document.querySelector<HTMLDivElement>('.transcript');
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages, agent.status]);

  /**
   * Input:
   * - Optional model/source choices and whether old browser pointers should be discarded.
   *
   * Output:
   * - A new active durable thread, or a user-facing creation error.
   *
   * What this function does:
   * - Requests a signed ID and atomically updates preferences, current pointer, and recent history.
   */
  async function startNewConversation(nextModel = model, nextMcpServerIds = mcpServerIds, resetList = false) {
    setIsCreating(true);
    setUiError('');
    try {
      const id = await requestConversation(nextModel, nextMcpServerIds);
      const now = Date.now();
      const record: ConversationRecord = {
        id,
        model: nextModel,
        mcpServerIds: nextMcpServerIds,
        title: UNTITLED_CONVERSATION,
        createdAt: now,
        updatedAt: now,
      };
      setModel(nextModel);
      setMcpServerIds(nextMcpServerIds);
      setConversationId(id);
      localStorage.setItem(MODEL_KEY, nextModel);
      localStorage.setItem(MCP_KEY, JSON.stringify(nextMcpServerIds));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      // Keep the new thread first and enforce the same bounded history used during startup repair.
      /**
       * Input:
       * - The current local conversation index.
       *
       * Output:
       * - A bounded index with the newly created thread first.
       *
       * What this function does:
       * - Applies the history update against React's latest state to avoid stale writes.
       */
      setConversations((current) => {
        const retained = resetList ? [] : current;
        const next = [record, ...retained.filter((conversation) => conversation.id !== id)].slice(0, MAX_SAVED_CONVERSATIONS);
        persistConversations(next);
        return next;
      });
      setInput('');
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Could not start a new conversation.');
    } finally {
      setIsCreating(false);
    }
  }

  /**
   * Input:
   * - An optional form event and the current composer text.
   *
   * Output:
   * - A durable Flue message submission and updated browser title metadata.
   *
   * What this function does:
   * - Prevents duplicate sends, restores failed prompts, and titles a thread from its first question.
   */
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy || submissionPending.current || !conversationId || !agentUrl) return;
    submissionPending.current = true;
    setIsSubmitting(true);
    setSubmissionAdmitted(false);
    setInput('');
    setUiError('');
    let admitted = false;
    try {
      const client = createFlueClient({ url: agentUrl });
      const messageBody = encodeConfiguredPrompt(prompt, model, mcpServerIds);
      await submitWithConversationLock(conversationId, {
        messageBody,
        send: (body, idempotencyKey) => {
          // Flue supports keyed direct admission at runtime; the current SDK declaration has not exposed it yet.
          const options = {
            message: { kind: 'user' as const, body },
            idempotencyKey,
          };
          return client.send(options);
        },
        wait: (admission) => client.wait(admission),
        onAdmitted: () => {
          admitted = true;
          setSubmissionAdmitted(true);
          // Message content remains in Flue; only title and recency metadata are saved in the browser.
          setConversations((current) => {
            const existing = current.find((conversation) => conversation.id === conversationId);
            if (!existing) return current;
            const updated = {
              ...existing,
              title: existing.title === UNTITLED_CONVERSATION ? conversationTitle(prompt) : existing.title,
              updatedAt: Date.now(),
            };
            const next = [updated, ...current.filter((conversation) => conversation.id !== conversationId)];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            persistConversations(next);
            return next;
          });
        },
      });
    } catch (error) {
      if (!admitted) setInput(prompt);
      setUiError(error instanceof Error ? error.message : 'The research request could not be submitted.');
    } finally {
      submissionPending.current = false;
      setIsSubmitting(false);
      setSubmissionAdmitted(false);
    }
  }

  /**
   * Input:
   * - The active agent URL.
   *
   * Output:
   * - An abort request or a user-facing error.
   *
   * What this function does:
   * - Cancels the current durable response without deleting its conversation history.
   */
  async function stopResearch() {
    if (!agentUrl) return;
    try {
      await createFlueClient({ url: agentUrl }).abort();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Could not stop the active research.');
    }
  }

  /**
   * Input:
   * - One validated browser conversation pointer.
   *
   * Output:
   * - The selected thread restored through the Flue hook.
   *
   * What this function does:
   * - Synchronizes active ID, controls, and local-storage preferences.
   */
  function openConversation(conversation: ConversationRecord) {
    if (busy || conversation.id === conversationId) return;
    setUiError('');
    setInput('');
    setModel(conversation.model);
    setMcpServerIds(conversation.mcpServerIds);
    setConversationId(conversation.id);
    localStorage.setItem(MODEL_KEY, conversation.model);
    localStorage.setItem(MCP_KEY, JSON.stringify(conversation.mcpServerIds));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
  }

  /**
   * Input:
   * - The approved model and source selection for the next prompt.
   *
   * Output:
   * - Updated controls and browser metadata while the active durable conversation ID stays unchanged.
   *
   * What this function does:
   * - Makes configuration mutable per prompt without moving the user to a different Flue Durable Object.
   */
  function updateConfiguration(nextModel: ModelId, nextMcpServerIds: McpServerId[]) {
    setUiError('');
    setModel(nextModel);
    setMcpServerIds(nextMcpServerIds);
    localStorage.setItem(MODEL_KEY, nextModel);
    localStorage.setItem(MCP_KEY, JSON.stringify(nextMcpServerIds));
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      if (!existing) return current;
      const updated = { ...existing, model: nextModel, mcpServerIds: nextMcpServerIds };
      const next = current.map((conversation) => conversation.id === conversationId ? updated : conversation);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      persistConversations(next);
      return next;
    });
  }

  /**
   * Input:
   * - One browser conversation pointer selected for deletion.
   *
   * Output:
   * - A repaired history selection or a fresh thread when the list becomes empty.
   *
   * What this function does:
   * - Removes only the local pointer; durable Flue messages are intentionally not destroyed.
   */
  function deleteConversation(conversation: ConversationRecord) {
    if (busy) return;
    const remaining = conversations.filter((candidate) => candidate.id !== conversation.id);
    setConversations(remaining);
    persistConversations(remaining);
    if (conversation.id !== conversationId) return;
    if (remaining[0]) {
      openConversation(remaining[0]);
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    setConversationId('');
    void startNewConversation(model, mcpServerIds, true);
  }

  /**
   * Input:
   * - A newly selected approved model ID.
   *
   * Output:
   * - The active thread configured to use that model for its next prompt.
   *
   * What this function does:
   * - Keeps one comparison history while changing Flue's submission-scoped model selection.
   */
  function changeModel(nextModel: ModelId) {
    if (nextModel === model || busy) return;
    updateConfiguration(nextModel, mcpServerIds);
  }

  /**
   * Input:
   * - The MCP server ID whose checkbox changed.
   *
   * Output:
   * - The active thread's next-prompt source set, or a validation error.
   *
   * What this function does:
   * - Preserves registry order and prevents source-free research submissions.
   */
  function toggleMcpServer(serverId: McpServerId) {
    if (busy) return;
    const next = mcpServerIds.includes(serverId)
      ? mcpServerIds.filter((id) => id !== serverId)
      : MCP_REGISTRY.filter((server) => mcpServerIds.includes(server.id) || server.id === serverId).map((server) => server.id);
    if (next.length === 0) {
      setUiError('Keep at least one documentation source enabled.');
      return;
    }
    updateConfiguration(model, next);
  }

  /**
   * Input:
   * - A keyboard event from the prompt textarea.
   *
   * Output:
   * - Submission on Enter, while Shift+Enter keeps its normal newline behavior.
   *
   * What this function does:
   * - Provides the chat-style keyboard shortcut without trapping multiline input.
   */
  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  // Status precedence converts Flue's machine states into one concise user-facing label.
  const statusText = isCreating
    ? 'Preparing desk'
    : isSubmitting
      ? submissionAdmitted ? 'Researching' : 'Submitting durably'
      : agent.status === 'streaming'
      ? 'Researching'
      : agent.status === 'submitted'
        ? 'Queued durably'
        : agent.status === 'connecting'
          ? 'Restoring history'
          : agent.status === 'error'
            ? 'Needs attention'
            : 'Ready';

  return (
    <main className="app-shell">
      {/* Product identity, durable execution status, and the global new-thread action. */}
      <header className="masthead">
        <div className="brand-lockup">
          <span className="brand-index">D/01</span>
          <div><p className="eyebrow">Flue durable agent</p><h1>DocAgent</h1></div>
        </div>
        <div className="status-cluster">
          <span className={`status-light ${busy ? 'active' : ''}`} />
          <span>{statusText}</span>
          <button className="text-button" type="button" disabled={busy} onClick={() => void startNewConversation()}>
            New research
          </button>
        </div>
      </header>

      {/* Desktop uses a history rail; responsive CSS turns it into a mobile horizontal strip. */}
      <section className="workspace">
        <aside className="research-rail">
          <div className="history-heading">
            <div><p className="rail-label">Conversation list</p><span>{conversations.length} saved locally</span></div>
            <button type="button" disabled={busy} onClick={() => void startNewConversation()}>+ New</button>
          </div>
          <nav className="conversation-list" aria-label="Saved conversations">
            {conversations.map((conversation) => (
              <div className={`conversation-row ${conversation.id === conversationId ? 'active' : ''}`} key={conversation.id}>
                <button
                  className="conversation-link"
                  type="button"
                  disabled={busy && conversation.id !== conversationId}
                  onClick={() => openConversation(conversation)}
                >
                  <strong>{conversation.title}</strong>
                  <span>
                    {modelById(conversation.model).name}
                    <time dateTime={new Date(conversation.updatedAt).toISOString()}>
                      {new Date(conversation.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </time>
                  </span>
                </button>
                <button
                  className="conversation-delete"
                  type="button"
                  disabled={busy}
                  aria-label={`Delete ${conversation.title}`}
                  title="Delete conversation from this browser"
                  onClick={() => deleteConversation(conversation)}
                >
                  ×
                </button>
              </div>
            ))}
          </nav>
          <p className="history-note">Messages remain in their durable Flue sessions. This browser stores the pointers used to reopen them.</p>
        </aside>

        <section className="conversation-panel">
          <div className="conversation-meta">
            <span>{activeConversation?.title ?? 'Durable session'}</span>
            <span>{selectedModel.name} / {mcpServerIds.length} sources</span>
          </div>

          {/* Model and source controls configure the next prompt without replacing durable history. */}
          <section className="thread-controls" aria-label="Thread configuration">
            <div className="thread-model-control">
              <label htmlFor="model-select">Workers AI model <span>Applies to the next question</span></label>
              <select id="model-select" value={model} disabled={busy} onChange={(event) => changeModel(event.target.value as ModelId)}>
                {MODEL_REGISTRY.map((option) => <option value={option.id} key={option.id}>{option.name} · {option.provider}</option>)}
              </select>
            </div>
            <div className="thread-source-control">
              <p>Documentation sources <span>Applies to the next question</span></p>
              <div className="composer-sources">
                {MCP_REGISTRY.map((server) => (
                  <label className={`composer-source ${mcpServerIds.includes(server.id) ? 'selected' : ''}`} key={server.id} title={server.description}>
                    <input
                      type="checkbox"
                      checked={mcpServerIds.includes(server.id)}
                      disabled={busy}
                      onChange={() => toggleMcpServer(server.id)}
                    />
                    <span>{server.shortLabel}</span>
                    <strong>{server.name}</strong>
                  </label>
                ))}
              </div>
            </div>
          </section>

          {/* Durable history, empty-state prompts, activity traces, and streamed answers. */}
          <div className="transcript" aria-live="polite">
            {!agent.historyReady || isCreating ? (
              <div className="loading-state"><span /><p>Opening the durable research record...</p></div>
            ) : visibleMessages.length === 0 ? (
              <div className="welcome-card">
                <p className="welcome-number">01 / SEARCH</p>
                <h2>Search technical documentation across vendors.</h2>
                <p>Ask one agent to verify product behavior, architecture, APIs, security guidance, migrations, or best practices against official sources.</p>
                <div className="example-list">
                  {EXAMPLES.map((example) => <button type="button" onClick={() => setInput(example)} key={example}><span>Ask</span>{example}</button>)}
                </div>
              </div>
            ) : visibleMessages.map((message, index) => <ConversationMessage message={message} index={index} key={message.id} />)}

            {busy && !isCreating && (
              <div className="working-strip">
                <span className="working-bars"><i /><i /><i /></span>
                <div><strong>{statusText}</strong><p>Reasoning, tool calls, and answer tokens stream into this durable response.</p></div>
              </div>
            )}
          </div>

          {/* Error feedback, prompt entry, cancellation, and submission controls. */}
          <footer className="composer-wrap">
            {(uiError || agent.error) && <p className="error-banner">{uiError || agent.error?.message}</p>}
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <label htmlFor="research-question">Documentation question</label>
              <textarea
                id="research-question"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Ask about product behavior, APIs, architecture, migrations, or best practices..."
                rows={3}
                disabled={isCreating}
              />
              <div className="composer-actions">
                <span>Enter to submit / Shift+Enter for a new line</span>
                {submissionAdmitted || agent.status === 'submitted' || agent.status === 'streaming'
                  ? <button className="stop-button" type="button" onClick={() => void stopResearch()}>Stop</button>
                  : <button className="submit-button" type="submit" disabled={busy || !input.trim() || !conversationId}>
                    {isSubmitting ? 'Submitting...' : 'Search'}
                  </button>}
              </div>
            </form>
          </footer>
        </section>
      </section>
    </main>
  );
}
