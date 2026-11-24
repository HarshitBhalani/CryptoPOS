export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export async function apiFetch(path: string, init: RequestInit = {}) {
  const request = () => fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    cache: "no-store",
  });
  let response = await request();
  if (response.status === 401 && !["/auth/refresh", "/auth/logout"].includes(path)) {
    const refreshed = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include", cache: "no-store" });
    if (refreshed.ok) response = await request();
  }
  return response;
}

export async function apiData<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(", ") : result.message ?? "Request failed");
  return result.data as T;
}
