// Flue result and error types distinguish admission failures from settled execution failures.
import { FlueApiError, FlueExecutionError, type AgentSendResult } from '@flue/sdk';

// Browser coordination uses one Web Lock and one recoverable local-storage marker per conversation.
const LOCK_UNAVAILABLE_MESSAGE = 'This conversation is already processing a question in another tab.';
const LOCK_UNSUPPORTED_MESSAGE = 'This browser cannot safely coordinate concurrent questions for one conversation.';
const ACTIVE_SUBMISSION_PREFIX = 'docagent_active_submission:';

// The marker preserves the exact payload and idempotency key across tab closure or an uncertain HTTP response.
type SubmissionMarker = {
  owner: string;
  startedAt: number;
  messageBody: string;
  admission?: AgentSendResult;
};

// Callbacks let App.tsx supply Flue transport operations without coupling this module to React.
type SubmissionOperations = {
  messageBody: string;
  send: (messageBody: string, idempotencyKey: string) => Promise<AgentSendResult>;
  wait: (admission: AgentSendResult) => Promise<void>;
  onAdmitted?: (admission: AgentSendResult) => void;
  onAdmissionUncertain?: () => void;
};

/**
 * Input:
 * - One signed conversation ID.
 *
 * Output:
 * - The local-storage key for that conversation's recoverable submission marker.
 *
 * What this function does:
 * - Names browser recovery state consistently across the UI and tests.
 */
export function conversationSubmissionStorageKey(conversationId: string): string {
  return `${ACTIVE_SUBMISSION_PREFIX}${conversationId}`;
}

/**
 * Input:
 * - A local-storage key that may contain untrusted or stale JSON.
 *
 * Output:
 * - A validated submission marker, or null.
 *
 * What this function does:
 * - Rejects malformed recovery state before it can trigger a replay or settlement wait.
 */
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

/**
 * Input:
 * - A marker key and the idempotency owner expected by this operation.
 *
 * Output:
 * - No return value; matching browser recovery state is removed.
 *
 * What this function does:
 * - Prevents one tab from clearing a newer marker written by another operation.
 */
function clearOwnedMarker(key: string, owner: string) {
  if (readMarker(key)?.owner === owner) localStorage.removeItem(key);
}

/**
 * Input:
 * - An unknown error raised while Flue admission is unresolved.
 *
 * Output:
 * - True only when a non-timeout 4xx response proves the request was rejected.
 *
 * What this function does:
 * - Keeps 408 and 5xx attempts recoverable because the server may already have admitted them.
 */
function isDefinitiveAdmissionRejection(error: unknown) {
  return error instanceof FlueApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408;
}

/**
 * Input:
 * - A conversation ID and the Flue send/wait callbacks for one prompt.
 *
 * Output:
 * - A promise that resolves after durable settlement or rejects with actionable lock/Flue errors.
 *
 * What this function does:
 * - Holds one exclusive same-origin Web Lock through settlement.
 * - Replays uncertain admissions with the original payload and idempotency key.
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
    /**
     * Input:
     * - The browser lock granted for this conversation, or null when another tab owns it.
     *
     * Output:
     * - A small acquisition result consumed after the lock callback completes.
     *
     * What this function does:
     * - Recovers prior work before admitting the current prompt and keeps the lock until settlement.
     */
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
            else operations.onAdmissionUncertain?.();
            throw error;
          }
          localStorage.setItem(key, JSON.stringify({ ...previous, admission: previousAdmission }));
        }
        // Correlate an exact replay as soon as its durable admission is known; settlement may take minutes.
        if (recoveringCurrentPrompt) operations.onAdmitted?.(previousAdmission);
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
          return { acquired: true as const };
        }
      }

      const owner = crypto.randomUUID();
      const marker: SubmissionMarker = { owner, startedAt: Date.now(), messageBody: operations.messageBody };
      localStorage.setItem(key, JSON.stringify(marker));
      let shouldClearMarker = false;
      let admissionKnown = false;
      try {
        const admission = await operations.send(marker.messageBody, owner);
        admissionKnown = true;
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
        else if (!admissionKnown) operations.onAdmissionUncertain?.();
        throw error;
      } finally {
        if (shouldClearMarker) clearOwnedMarker(key, owner);
      }
    },
  );

  if (!result.acquired) throw new Error(LOCK_UNAVAILABLE_MESSAGE);
}
