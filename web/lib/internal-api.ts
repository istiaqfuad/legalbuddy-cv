/** Backend access: the FastAPI container only trusts this server.
 *
 * Every server-side call to API_INTERNAL_URL carries the shared
 * INTERNAL_API_TOKEN (browsers never see it; the Python API rejects
 * /api/* calls without it when the token is configured). Unset locally
 * means no gate.
 */

export function internalBase(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:8000";
}

export function internalHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  const token = process.env.INTERNAL_API_TOKEN;
  if (token) headers.set("x-internal-token", token);
  return headers;
}
