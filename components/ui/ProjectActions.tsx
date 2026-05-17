"use client";

import { Check, FileDown, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";
import type { Design, Floor } from "@/types";

export function ProjectActions({ projectId, floor, design }: { projectId: string; floor?: Floor | null; design?: Design | null }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: Record<string, unknown>) {
    setError(null);
    setBusy(path);
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) throw new Error(payload.error ?? "Request failed");
    router.refresh();
  }

  async function exportPdf() {
    if (!floor || !design) return;
    setBusy("pdf");
    const response = await fetch("/api/pdf/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, floorId: floor.id, designId: design.id })
    });
    setBusy(null);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${floor.floor_name.replace(/[^a-z0-9]+/gi, "-")}-electrical.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function requestRevision() {
    if (!floor || !notes.trim()) return;
    try {
      await post(`/api/projects/${projectId}/revise`, { floorId: floor.id, notes: notes.trim() });
      setNotes("");
    } catch (revisionError) {
      setError(revisionError instanceof Error ? revisionError.message : "Revision request failed");
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-[#fffaf0]">Engineering Review</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <NeonButton disabled={!floor || busy !== null} onClick={() => floor && post(`/api/projects/${projectId}/approve`, { floorId: floor.id }).catch((approveError) => setError(approveError instanceof Error ? approveError.message : "Approval failed"))}>
          <Check className="h-4 w-4" />
          Approve
        </NeonButton>
        <NeonButton variant="ghost" disabled={!design || busy !== null} onClick={exportPdf}>
          <FileDown className="h-4 w-4" />
          Save PDF
        </NeonButton>
      </div>
      <form
        className="mt-5 rounded border border-[#c6a171]/14 bg-white/[0.025] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void requestRevision();
        }}
      >
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[#c9b9a6]/62">Revision request</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-2 min-h-28 w-full rounded border border-[#c6a171]/20 bg-[#140f0c]/52 px-3 py-2 text-sm text-[#f7f2ea] outline-none transition placeholder:text-[#c9b9a6]/36 focus:border-[#d6b17d]/58"
            placeholder="Example: Make labels larger, add more socket outlets in each office, route lighting circuits more clearly, move DB near the stair core..."
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs leading-5 text-[#efe4d4]/52">Submits a new design job using these notes and the latest floor plan.</p>
          <NeonButton type="submit" variant="secondary" disabled={!floor || !notes.trim() || busy !== null}>
            <RotateCcw className={busy?.includes("/revise") ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Submit Revision
          </NeonButton>
        </div>
      </form>
      {error ? <p className="mt-3 rounded border border-rose-300/24 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
    </div>
  );
}
