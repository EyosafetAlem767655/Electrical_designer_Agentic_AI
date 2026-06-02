import { getEnv } from "@/lib/env";

export function backendBaseUrl() {
  const value = getEnv("BACKEND_BASE_URL");
  return value ? value.replace(/\/$/, "") : null;
}

export async function proxyToBackend(path: string, init?: RequestInit) {
  const base = backendBaseUrl();
  if (!base) return null;
  const response = await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}
