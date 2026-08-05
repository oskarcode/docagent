// Registry helpers validate and encode the immutable model/source portion of each signed token.
import {
  decodeMcpMask,
  encodeMcpMask,
  isModelId,
  type McpServerId,
  type ModelId,
} from './registry.ts';

// Session and token formats are deliberately narrow so malformed public identifiers fail closed.
const COOKIE_NAME = 'tech_docs_flue_session';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_PATTERN = /^[0-9a-f-]{36}$/i;
const CONVERSATION_UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Input:
 * - A Cookie header string and the cookie name to locate.
 *
 * Output:
 * - The cookie value, or null when the cookie is absent.
 *
 * What this function does:
 * - Parses only the requested cookie without accepting partial name matches.
 */
function readCookie(header: string, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) return cookie.slice(prefix.length);
  }
  return null;
}

/**
 * Input:
 * - Raw bytes, usually an HMAC signature.
 *
 * Output:
 * - An unpadded URL-safe Base64 string.
 *
 * What this function does:
 * - Makes binary signatures safe to embed in a URL path.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Input:
 * - An unpadded URL-safe Base64 string.
 *
 * Output:
 * - The decoded bytes used by Web Crypto verification.
 *
 * What this function does:
 * - Restores standard Base64 characters and padding before decoding.
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Input:
 * - The anonymous browser session UUID.
 *
 * Output:
 * - A non-exportable HMAC-SHA256 key.
 *
 * What this function does:
 * - Derives a session-specific signing key so another browser cannot reuse a conversation token.
 */
async function hmacKey(sessionId: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sessionId),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Input:
 * - An incoming HTTP request.
 *
 * Output:
 * - A validated session UUID, or null.
 *
 * What this function does:
 * - Reads the anonymous session cookie and rejects malformed values.
 */
export function getExistingSession(request: Request): string | null {
  const sessionId = readCookie(request.headers.get('cookie') ?? '', COOKIE_NAME);
  return sessionId && SESSION_PATTERN.test(sessionId) ? sessionId : null;
}

/**
 * Input:
 * - An incoming request that may already contain a session cookie.
 *
 * Output:
 * - The session ID and an optional Set-Cookie value for a new session.
 *
 * What this function does:
 * - Reuses a valid session or creates a 30-day HttpOnly, same-site session.
 */
export function getOrCreateSession(request: Request): { id: string; cookie: string | null } {
  const existing = getExistingSession(request);
  if (existing) return { id: existing, cookie: null };

  const id = crypto.randomUUID();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return {
    id,
    cookie: `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`,
  };
}

/**
 * Input:
 * - A session UUID and approved model alias.
 *
 * Output:
 * - A signed conversation token containing the model and a random conversation UUID.
 *
 * What this function does:
 * - Binds a new durable conversation to exactly one anonymous browser session.
 */
export async function createConversationToken(
  sessionId: string,
  model: ModelId,
  mcpServerIds: readonly McpServerId[],
): Promise<string> {
  const unsigned = `${model}.${encodeMcpMask(mcpServerIds)}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(sessionId), new TextEncoder().encode(unsigned));
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Input:
 * - The current session UUID and an untrusted conversation token.
 *
 * Output:
 * - True only when the token format and HMAC signature are valid for this session.
 *
 * What this function does:
 * - Enforces the ownership boundary before requests reach Flue's durable router.
 */
export async function verifyConversationToken(sessionId: string, token: string): Promise<boolean> {
  const [model, mask, conversationId, signature, ...extra] = token.split('.');
  if (
    extra.length > 0
    || !isModelId(model)
    || decodeMcpMask(mask) === null
    || !CONVERSATION_UUID_PATTERN.test(conversationId ?? '')
    || !SIGNATURE_PATTERN.test(signature ?? '')
  ) return false;
  const unsigned = `${model}.${mask}.${conversationId}`;
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(sessionId),
    base64UrlToBytes(signature),
    new TextEncoder().encode(unsigned),
  );
}
