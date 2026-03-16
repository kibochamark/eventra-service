import { IncomingHttpHeaders } from 'http';

/**
 * Converts Node.js IncomingHttpHeaders to a Web API Headers object.
 * Replaces the `fromNodeHeaders` import from better-auth/node (ESM-only)
 * so the compiled CJS bundle works on Vercel.
 */
export function fromNodeHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}
