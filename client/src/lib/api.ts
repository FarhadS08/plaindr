/**
 * Plaindr API client.
 *
 * Wraps the FastAPI backend that tracks AI company policy changes across
 * 130+ tools and exposes a RAG endpoint for natural-language queries.
 *
 * All endpoints share the same base URL defined by VITE_API_URL. When the
 * variable is unset we fall back to a relative path so that dev servers
 * with a rewrite proxy continue to work.
 */

const RAW_BASE = import.meta.env.VITE_API_URL ?? "";
export const API_BASE_URL = RAW_BASE.replace(/\/$/, "");

// ---------- Types ----------

export type Company = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  main_url: string | null;
};

export type Policy = {
  id: string;
  author_id: string;
  title: string;
  policy_type: string;
  source_url: string;
  content?: string | null;
  version: number;
  effective_date: string | null;
  scraped_at: string | null;
};

export type DiffKeyChange = {
  section: string;
  change_type: "added" | "removed" | "modified";
  description: string;
  severity: "info" | "warning" | "breaking";
};

export type DiffAnalysis = {
  summary: string;
  key_changes: DiffKeyChange[];
  consequences: string;
  risk_level: "low" | "medium" | "high" | "critical";
};

export type DiffDocument = {
  id: string;
  source_url: string;
  author_id: string;
  old_version_id: string;
  new_version_id: string;
  old_version: number;
  new_version: number;
  old_effective_date: string | null;
  new_effective_date: string | null;
  diff_text: string;
  stats: { lines_added: number; lines_removed: number; hunks: number };
  analysis: DiffAnalysis | null;
  analysis_status: "completed" | "pending" | "failed";
  computed_at: string;
};

export type QuerySource = {
  text: string;
  source_url: string;
  section_heading: string | null;
  policy_summary: string | null;
  relevance_score: number;
};

export type QueryResponse = {
  answer: string;
  sources: QuerySource[];
  intent: string;
};

export type QueryRequest = {
  question: string;
  company_filter?: string;
  policy_type_filter?: string;
};

// ---------- Fetch helper ----------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Plaindr API ${res.status} ${res.statusText} at ${path}${body ? `: ${body}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

// ---------- Endpoints ----------

export const api = {
  // Companies
  listCompanies: () => request<Company[]>(`/api/companies`),
  getCompany: (id: string) => request<Company>(`/api/companies/${id}`),
  getCompanyPolicies: (id: string) =>
    request<Policy[]>(`/api/companies/${id}/policies`),

  // Policies
  listPolicies: () => request<Policy[]>(`/api/policies`),
  getPolicy: (sourceUrl: string) =>
    request<Policy>(`/api/policies/${encodeSourceUrl(sourceUrl)}`),

  // Diffs
  recentDiffs: (limit = 20) =>
    request<DiffDocument[]>(`/api/diffs/recent?limit=${limit}`),
  diffsByUrl: (sourceUrl: string) =>
    request<DiffDocument[]>(`/api/diffs/by-url/${encodeSourceUrl(sourceUrl)}`),
  getDiff: (diffId: string) => request<DiffDocument>(`/api/diffs/${diffId}`),

  // RAG
  query: (body: QueryRequest) =>
    request<QueryResponse>(`/api/query`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Streams a RAG answer via Server-Sent Events-style `fetch` reader.
   * The backend emits newline-delimited JSON frames, each one of:
   *   {"type":"sources", ...}
   *   {"type":"token", "text": "..."}
   *   {"type":"done"}
   */
  async streamQuery(
    body: QueryRequest,
    handlers: {
      onSources?: (sources: QuerySource[]) => void;
      onToken?: (text: string) => void;
      onDone?: () => void;
      onError?: (err: unknown) => void;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/query/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: handlers.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status} ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames end in a blank line. We accept either "data: <json>\n\n"
        // or plain newline-delimited JSON for compatibility with both backends.
        const frames = buffer.split(/\n\n+/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const lines = frame.split(/\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "sources" && Array.isArray(parsed.sources)) {
                handlers.onSources?.(parsed.sources as QuerySource[]);
              } else if (parsed.type === "token" && typeof parsed.text === "string") {
                handlers.onToken?.(parsed.text);
              } else if (parsed.type === "done") {
                handlers.onDone?.();
              }
            } catch {
              // ignore malformed line
            }
          }
        }
      }
      // flush trailing buffer if it held one final frame
      if (buffer.trim()) {
        const payload = buffer.startsWith("data:") ? buffer.slice(5).trim() : buffer.trim();
        try {
          const parsed = JSON.parse(payload);
          if (parsed.type === "token" && typeof parsed.text === "string") {
            handlers.onToken?.(parsed.text);
          } else if (parsed.type === "done") {
            handlers.onDone?.();
          }
        } catch {
          // ignore
        }
      }
      handlers.onDone?.();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(err);
    }
  },
};

// ---------- URL helpers ----------

/**
 * Encodes an arbitrary source URL for use in a `:source_url:path` FastAPI
 * parameter. The backend accepts URLs directly in the path, but we still
 * URI-encode slashes inside the scheme to keep the request well-formed.
 */
export function encodeSourceUrl(sourceUrl: string): string {
  // Preserve `://` so FastAPI's path converter recognises it.
  return sourceUrl
    .replace(/^(https?):\/\//, "$1://")
    .split("/")
    .map((seg, idx) => (idx <= 1 ? seg : encodeURIComponent(seg)))
    .join("/");
}

/** Encodes a source URL for use as a route parameter (wouter param). */
export function encodeSourceUrlForRoute(sourceUrl: string): string {
  return encodeURIComponent(sourceUrl);
}

/** Decodes a wouter route parameter back to a canonical source URL. */
export function decodeSourceUrlFromRoute(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}
