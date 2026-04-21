// Tiny client for the Python FastAPI backend.
//
// Centralises the JWT-forwarding + error-mapping boilerplate so tRPC
// procedures that proxy to Python don't each reinvent it. Maps Python's
// `{ detail: ... }` error shape to appropriate TRPCError codes.

import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export type BackendMethod = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

/**
 * Call a Python backend endpoint with the caller's Supabase JWT.
 *
 * - Forwards `Authorization: Bearer <accessToken>`.
 * - Accepts an optional `AbortSignal` for per-call timeouts.
 * - On non-2xx, throws a TRPCError with a useful message extracted
 *   from Python's `{ detail: ... }` body. 429 -> TOO_MANY_REQUESTS,
 *   401 -> UNAUTHORIZED, 403 -> FORBIDDEN, 404 -> NOT_FOUND, 502 ->
 *   BAD_GATEWAY (with the scrape error surfaced verbatim).
 */
export async function callBackend<T>(
  path: string,
  method: BackendMethod,
  body: unknown,
  accessToken: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!ENV.backendUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "BACKEND_URL is not configured",
    });
  }

  const url = `${ENV.backendUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // AbortError, DNS, TCP-reset, etc. Surface as 504-ish.
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Backend request timed out"
        : err instanceof Error
          ? `Backend request failed: ${err.message}`
          : "Backend request failed";
    throw new TRPCError({
      code: "TIMEOUT",
      message,
    });
  }

  // 204 / empty body short-circuit.
  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body — keep as text for error messages.
      parsed = text;
    }
  }

  if (!res.ok) {
    const detail = extractDetail(parsed);
    const message = detail ?? `Backend error (${res.status})`;
    throw new TRPCError({
      code: statusToTrpcCode(res.status),
      message,
    });
  }

  return parsed as T;
}

function extractDetail(parsed: unknown): string | null {
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed;
  if (typeof parsed === "object") {
    const d = (parsed as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
    // FastAPI validation errors use an array of { msg, loc, ... }
    if (Array.isArray(d) && d.length > 0) {
      const first = d[0];
      if (first && typeof first === "object" && typeof (first as { msg?: unknown }).msg === "string") {
        return (first as { msg: string }).msg;
      }
      try {
        return JSON.stringify(d);
      } catch {
        return null;
      }
    }
    // Fall back to a `message` field if present.
    const m = (parsed as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return null;
}

function statusToTrpcCode(status: number): TRPCError["code"] {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE_CONTENT";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 502:
      // Surface the underlying scrape/backend error verbatim. We keep
      // 502 mapped to BAD_GATEWAY so the client can distinguish "their
      // input is fine, the upstream scraper failed" from plain 500s.
      return "BAD_GATEWAY";
    case 503:
      return "SERVICE_UNAVAILABLE";
    case 504:
      return "TIMEOUT";
    default:
      if (status >= 500) return "INTERNAL_SERVER_ERROR";
      return "BAD_REQUEST";
  }
}

/**
 * Build an AbortSignal that fires after `ms` milliseconds. Use with
 * `callBackend(..., signal)` to enforce per-call timeouts.
 */
export function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}
