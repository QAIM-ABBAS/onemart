import type { AuthResponse, ErrorEnvelope, User } from "./types";

const BASE = "/api";

let accessToken: string | null = null;
let sessionLostHandler: (() => void) | null = null;
let refreshPromise: Promise<AuthResponse | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionLostHandler(fn: (() => void) | null): void {
  sessionLostHandler = fn;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const item of this.details) {
        if (item && typeof item === "object" && "field" in item && "message" in item) {
          const field = String(item.field);
          if (!out[field]) out[field] = String(item.message);
        }
      }
    }
    return out;
  }
}

type QueryValue = string | number | boolean | undefined | null;

export function buildQuery(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  retryOn401?: boolean;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function applyAuth(res: AuthResponse): AuthResponse {
  accessToken = res.access_token;
  return res;
}

export async function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as AuthResponse;
        return applyAuth(data);
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, retryOn401 = true } = options;
  const url = `${BASE}${path}${query ? buildQuery(query) : ""}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the server. Check your connection.");
  }

  if (res.status === 401 && retryOn401 && !path.startsWith("/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, retryOn401: false });
    }
    accessToken = null;
    sessionLostHandler?.();
  }

  if (res.status === 204) return undefined as T;

  const data = await parseBody(res);

  if (!res.ok) {
    const envelope = data as ErrorEnvelope | null;
    const err = envelope?.error;
    if (res.status === 401) {
      accessToken = null;
      sessionLostHandler?.();
    }
    throw new ApiError(
      res.status,
      err?.code ?? "error",
      err?.message ?? "Something went wrong. Please try again.",
      err?.details ?? data,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>) =>
    request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    retryOn401: false,
  });
  return applyAuth(res);
}

export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthResponse> {
  const res = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: { email, password, full_name: fullName },
    retryOn401: false,
  });
  return applyAuth(res);
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST", retryOn401: false });
  } finally {
    accessToken = null;
  }
}

export async function me(): Promise<User> {
  return request<User>("/auth/me");
}
