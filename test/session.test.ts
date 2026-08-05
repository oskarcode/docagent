// Vitest and Web Platform Request objects test browser-session behavior in Node.
import { describe, expect, it } from 'vitest';

// Session helpers are tested directly so failures do not require a deployed Durable Object.
import {
  createConversationToken,
  getExistingSession,
  getOrCreateSession,
  verifyConversationToken,
} from '../src/lib/session.ts';

describe('anonymous conversation sessions', () => {
  /**
   * Input:
   * - Requests with and without an existing anonymous-session cookie.
   *
   * Output:
   * - Assertions for secure cookie creation, validation, and reuse.
   *
   * What this function does:
   * - Guards the browser identity boundary used by every signed conversation.
   */
  it('creates an HttpOnly strict cookie and reuses it', () => {
    const created = getOrCreateSession(new Request('https://example.com/api/conversations'));
    expect(created.cookie).toContain('HttpOnly');
    expect(created.cookie).toContain('SameSite=Strict');
    expect(created.cookie).toContain('Secure');

    const reused = getOrCreateSession(new Request('https://example.com/api/conversations', {
      headers: { cookie: `tech_docs_flue_session=${created.id}` },
    }));
    expect(reused).toEqual({ id: created.id, cookie: null });
    expect(getExistingSession(new Request('https://example.com', {
      headers: { cookie: `tech_docs_flue_session=${created.id}` },
    }))).toBe(created.id);
  });

  /**
   * Input:
   * - Owner and non-owner session IDs plus a configured conversation token.
   *
   * Output:
   * - Assertions proving tokens cannot move between sessions or configuration prefixes.
   *
   * What this function does:
   * - Detects ownership and model-tampering regressions in the HMAC design.
   */
  it('binds each signed conversation to one browser session, model, and source set', async () => {
    const owner = crypto.randomUUID();
    const otherSession = crypto.randomUUID();
    const token = await createConversationToken(owner, 'kimi-k2-6', ['cloudflare-docs', 'aws-knowledge']);

    expect(token.startsWith('kimi-k2-6.3.')).toBe(true);
    await expect(verifyConversationToken(owner, token)).resolves.toBe(true);
    await expect(verifyConversationToken(otherSession, token)).resolves.toBe(false);
    await expect(verifyConversationToken(owner, token.replace('kimi-k2-6.', 'glm-5-2.'))).resolves.toBe(false);
    await expect(verifyConversationToken(owner, token.replace('.3.', '.1.'))).resolves.toBe(false);
  });
});
