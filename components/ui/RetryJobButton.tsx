"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const setupSecretStorageKey = "elec-nova-telegram-setup-secret";

export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const setupSecret = window.sessionStorage.getItem(setupSecretStorageKey)?.trim();
      const response = await fetch(`/api/jobs/${jobId}/retry`, {
        method: "POST",
        headers: setupSecret ? { "x-job-secret": setupSecret } : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Retry failed");
      router.refresh();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded border border-[#d6b17d]/28 bg-[#d6b17d]/10 px-3 text-sm font-semibold text-[#fffaf0] transition hover:border-[#d6b17d]/55 hover:bg-[#d6b17d]/18 disabled:cursor-not-allowed disabled:opacity-55"
      >
        <RotateCcw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        {busy ? "Retrying" : "Retry Job"}
      </button>
      {error ? <p className="mt-2 text-xs text-rose-100">{error}</p> : null}
    </div>
  );
}
