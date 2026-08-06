import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlueApiError, FlueExecutionError } from '@flue/sdk';

import {
  conversationSubmissionStorageKey,
  submitWithConversationLock,
} from '../frontend/src/conversation-lock.ts';

const admission = {
  streamUrl: 'https://example.com/thread-1',
  offset: '0_0000000000000001',
  submissionId: 'submission-1',
  uid: 'instance-1',
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('conversation submission lock', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holds an exclusive conversation lock through submission settlement', async () => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    const request = vi.fn(async (_name, _options, callback) => callback(lock));
    vi.stubGlobal('navigator', { locks: { request } });
    vi.stubGlobal('localStorage', memoryStorage());
    const send = vi.fn(async (_body: string, _idempotencyKey: string) => admission);
    const wait = vi.fn(async (_admission: typeof admission) => undefined);

    await expect(submitWithConversationLock('thread-1', {
      messageBody: 'first prompt',
      send,
      wait,
    })).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      'docagent:thread-1',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('first prompt', expect.any(String));
    expect(wait).toHaveBeenCalledWith(admission);
    expect(localStorage.getItem(conversationSubmissionStorageKey('thread-1'))).toBeNull();
  });

  it('rejects instead of joining work already active in another tab', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback(null));
    vi.stubGlobal('navigator', { locks: { request } });
    vi.stubGlobal('localStorage', memoryStorage());
    const send = vi.fn(async (_body: string, _idempotencyKey: string) => admission);

    await expect(submitWithConversationLock('thread-1', {
      messageBody: 'blocked prompt',
      send,
      wait: vi.fn(async (_admission: typeof admission) => undefined),
    })).rejects.toThrow(
      'This conversation is already processing a question in another tab.',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('waits for a submission left active by a closed tab before sending', async () => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lock),
      },
    });
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem(conversationSubmissionStorageKey('thread-1'), JSON.stringify({
      owner: 'closed-tab',
      startedAt: Date.now(),
      messageBody: 'previous prompt',
      admission: { ...admission, submissionId: 'previous-submission' },
    }));
    const send = vi.fn(async (_body: string, _idempotencyKey: string) => admission);
    const wait = vi.fn(async (_admission: typeof admission) => undefined);

    await submitWithConversationLock('thread-1', {
      messageBody: 'next prompt',
      send,
      wait,
    });

    expect(wait.mock.calls.map(([value]) => value.submissionId)).toEqual([
      'previous-submission',
      'submission-1',
    ]);
    expect(send).toHaveBeenCalledOnce();
  });

  it('recovers an ambiguous admission with the same key and payload', async () => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lock),
      },
    });
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem(conversationSubmissionStorageKey('thread-1'), JSON.stringify({
      owner: 'stable-admission-key',
      startedAt: Date.now(),
      messageBody: 'ambiguous previous prompt',
    }));
    const send = vi.fn(async (_body: string, _idempotencyKey: string) => admission);
    const wait = vi.fn(async (_admission: typeof admission) => undefined);

    await submitWithConversationLock('thread-1', {
      messageBody: 'new prompt',
      send,
      wait,
    });

    expect(send.mock.calls[0]).toEqual(['ambiguous previous prompt', 'stable-admission-key']);
    expect(send.mock.calls[1]?.[0]).toBe('new prompt');
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('does not resubmit when retrying the same ambiguous prompt', async () => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lock),
      },
    });
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem(conversationSubmissionStorageKey('thread-1'), JSON.stringify({
      owner: 'stable-admission-key',
      startedAt: Date.now(),
      messageBody: 'ambiguous prompt',
    }));
    const send = vi.fn(async (_body: string, _idempotencyKey: string) => admission);
    const wait = vi.fn(async (_admission: typeof admission) => undefined);
    const onAdmitted = vi.fn();

    await submitWithConversationLock('thread-1', {
      messageBody: 'ambiguous prompt',
      send,
      wait,
      onAdmitted,
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('ambiguous prompt', 'stable-admission-key');
    expect(wait).toHaveBeenCalledOnce();
    expect(onAdmitted).toHaveBeenCalledWith(admission);
    expect(localStorage.getItem(conversationSubmissionStorageKey('thread-1'))).toBeNull();
  });

  it('preserves ambiguous state after a server error', async () => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lock),
      },
    });
    vi.stubGlobal('localStorage', memoryStorage());
    const send = vi.fn(async () => {
      throw new FlueApiError(500, { error: { type: 'internal_error' } });
    });

    await expect(submitWithConversationLock('thread-1', {
      messageBody: 'possibly admitted prompt',
      send,
      wait: vi.fn(async (_admission: typeof admission) => undefined),
    })).rejects.toBeInstanceOf(FlueApiError);

    const persisted = JSON.parse(
      localStorage.getItem(conversationSubmissionStorageKey('thread-1')) ?? '{}',
    );
    expect(persisted.messageBody).toBe('possibly admitted prompt');
    expect(persisted.owner).toEqual(expect.any(String));
  });

  it('clears recovery state after a definitive client rejection', async () => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lock),
      },
    });
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem(conversationSubmissionStorageKey('thread-1'), JSON.stringify({
      owner: 'rejected-admission-key',
      startedAt: Date.now(),
      messageBody: 'rejected prompt',
    }));

    await expect(submitWithConversationLock('thread-1', {
      messageBody: 'next prompt',
      send: vi.fn(async () => {
        throw new FlueApiError(400, { error: { type: 'invalid_request' } });
      }),
      wait: vi.fn(async (_admission: typeof admission) => undefined),
    })).rejects.toBeInstanceOf(FlueApiError);

    expect(localStorage.getItem(conversationSubmissionStorageKey('thread-1'))).toBeNull();
  });

  it.each(['failed', 'aborted'] as const)(
    'does not mark a %s recovered prompt as admitted',
    async (failure) => {
    const lock: Lock = { name: 'docagent:thread-1', mode: 'exclusive' };
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lock),
      },
    });
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem(conversationSubmissionStorageKey('thread-1'), JSON.stringify({
      owner: 'failed-admission-key',
      startedAt: Date.now(),
      messageBody: 'failed prompt',
      admission,
    }));
    const onAdmitted = vi.fn();

    await expect(submitWithConversationLock('thread-1', {
      messageBody: 'failed prompt',
      send: vi.fn(async () => admission),
      wait: vi.fn(async () => {
        throw new FlueExecutionError({
          target: 'agent_submission',
          targetId: admission.submissionId,
          failure,
        });
      }),
      onAdmitted,
    })).rejects.toBeInstanceOf(FlueExecutionError);

    expect(onAdmitted).not.toHaveBeenCalled();
    expect(localStorage.getItem(conversationSubmissionStorageKey('thread-1'))).toBeNull();
    },
  );
});
