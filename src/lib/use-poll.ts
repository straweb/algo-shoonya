"use client";

import { useEffect, useRef, useState } from "react";

/** Poll a JSON endpoint. Returns [data, refresh, loading]. */
export function usePoll<T>(url: string, ms = 3000, enabled = true): [T | null, () => void, boolean] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const refresh = async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      if (mounted.current) {
        setData(json);
        setLoading(false);
      }
    } catch {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;
    void refresh();
    timer.current = setInterval(() => void refresh(), ms);
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [url, ms, enabled]);

  return [data, refresh, loading];
}

export async function apiCall<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}
