import { FlueApiError, FlueExecutionError, type AgentSendResult } from '@flue/sdk';

const LOCK_UNAVAILABLE_MESSAGE = 'This conversation is already processing a question in another tab.';
const LOCK_UNSUPPORTED_MESSAGE = 'This browser cannot safely coordinate concurrent questions for one conversation.';
const ACTIVE_SUBMISSION_PREFIX = 'docagent_active_submission:';

type SubmissionMarker = {
  owner: string;
  startedAt: number;
  messageBody: string;
  admission?: AgentSendResult;
};

type SubmissionOperations = {
  messageBody: string;
  send: (messageBody: string, idempotencyKey: string) => Promise<AgentSendResult>;
  wait: (admission: AgentSendResult) => Promise<void>;
  onAdmitted?: (admission: AgentSendResult) => void;
};

export function conversationSubmissionStorageKey(conversationId: string): string {
  return `${ACTIVE_SUBMISSION_PREFIX}${conversationId}`;
}

function readMarker(key: string): SubmissionMarker | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null;
    if (
      !value
      || typeof value.owner !== 'string'
      || typeof value.startedAt !== 'number'
      || typeof value.messageBody !== 'string'
    ) return null;
    if (value.admission !== undefined) {
      const admission = value.admission as Record<string, unknown>;
      if (
        !admission
        || typeof admission.streamUrl !== 'string'
        || typeof admission.offset !== 'string'
        || typeof admission.submissionId !== 'string'
        || typeof admission.uid !== 'string'
      ) return null;
    }
    return value as SubmissionMarker;
  } catch {
    return null;
  }
}

function clearOwnedMarker(key: string, owner: string) {
  if (readMarker(key)?.owner === owner) localStorage.removeItem(key);
}

function isDefinitiveAdmissionRejection(error: unknown) {
  return error instanceof FlueApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408;
}

/**
 * Runs one submission exclusively across every same-origin browser tab until it settles.
 */
export async function submitWithConversationLock(
  conversationId: string,
  operations: SubmissionOperations,
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error(LOCK_UNSUPPORTED_MESSAGE);
  }

  const result = await navigator.locks.request(
    `docagent:${conversationId}`,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) return { acquired: false as const };

      const key = conversationSubmissionStorageKey(conversationId);
      const previous = readMarker(key);
      if (previous) {
        const recoveringCurrentPrompt = previous.messageBody === operations.messageBody;
        let previousAdmission = previous.admission;
        if (!previousAdmission) {
          // An exact keyed replay recovers the original receipt when admission succeeded but its response was lost.
          try {
            previousAdmission = await operations.send(previous.messageBody, previous.owner);
          } catch (error) {
            if (isDefinitiveAdmissionRejection(error)) clearOwnedMarker(key, previous.owner);
            throw error;
          }
          localStorage.setItem(key, JSON.stringify({ ...previous, admission: previousAdmission }));
        }
        try {
          await operations.wait(previousAdmission);
        } catch (error) {
          // Failed and aborted submissions are settled and no longer block the next configuration.
          const settled = error instanceof FlueExecutionError
            && (error.failure === 'failed' || error.failure === 'aborted');
          if (!settled) throw error;
          clearOwnedMarker(key, previous.owner);
          if (recoveringCurrentPrompt) throw error;
        }
        clearOwnedMarker(key, previous.owner);
        if (recoveringCurrentPrompt) {
          operations.onAdmitted?.(previousAdmission);
          return { acquired: true as const };
        }
      }

      const owner = crypto.randomUUID();
      const marker: SubmissionMarker = { owner, startedAt: Date.now(), messageBody: operations.messageBody };
      localStorage.setItem(key, JSON.stringify(marker));
      let shouldClearMarker = false;
      try {
        const admission = await operations.send(marker.messageBody, owner);
        localStorage.setItem(key, JSON.stringify({ ...marker, admission }));
        operations.onAdmitted?.(admission);
        try {
          await operations.wait(admission);
          shouldClearMarker = true;
        } catch (error) {
          if (
            error instanceof FlueExecutionError
            && (error.failure === 'failed' || error.failure === 'aborted')
          ) shouldClearMarker = true;
          throw error;
        }
        return { acquired: true as const };
      } catch (error) {
        // Only definitive client rejections prove admission failed; 408/5xx responses remain recoverable.
        if (isDefinitiveAdmissionRejection(error)) shouldClearMarker = true;
        throw error;
      } finally {
        if (shouldClearMarker) clearOwnedMarker(key, owner);
      }
    },
  );

  if (!result.acquired) throw new Error(LOCK_UNAVAILABLE_MESSAGE);
}
