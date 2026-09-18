import { useEffect, useState } from "react";
import type { MirrorPayload } from "../types";

export type MirrorDataStatus = "placeholder" | "loading" | "error" | "success";

export interface UseMirrorDataResult {
  status: MirrorDataStatus;
  data: MirrorPayload | null;
  error: string | null;
}

const PLACEHOLDER = "MIRROR_DATA_URL_PLACEHOLDER";

export function useMirrorData(url: string): UseMirrorDataResult {
  const [status, setStatus] = useState<MirrorDataStatus>(url === PLACEHOLDER ? "placeholder" : "loading");
  const [data, setData] = useState<MirrorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url === PLACEHOLDER) {
      setStatus("placeholder");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Mirror data request failed: HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((payload: MirrorPayload) => {
        if (cancelled) return;
        setData(payload);
        setStatus("success");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { status, data, error };
}
