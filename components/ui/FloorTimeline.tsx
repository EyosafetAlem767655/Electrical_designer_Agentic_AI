import Link from "next/link";
import { CheckCircle2, Circle, Loader2, RotateCcw } from "lucide-react";
import { FLOOR_STATUS_LABELS } from "@/lib/constants";
import { cx } from "@/lib/utils";
import type { Floor } from "@/types";

function tone(status: Floor["status"]) {
  if (status === "approved") return "border-emerald-300/60 bg-emerald-300/10 text-emerald-100";
  if (status === "design_ready") return "border-cyan-300/70 bg-cyan-300/12 text-cyan-50";
  if (status === "revision_requested") return "border-lime-200/60 bg-lime-300/10 text-lime-50";
  if (["analyzing", "designing", "questions_sent", "pdf_received"].includes(status)) return "border-blue-300/60 bg-blue-300/10 text-blue-50";
  return "border-slate-400/25 bg-white/[0.025] text-slate-200/70";
}

function Icon({ status }: { status: Floor["status"] }) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "revision_requested") return <RotateCcw className="h-4 w-4" />;
  if (["analyzing", "designing"].includes(status)) return <Loader2 className="h-4 w-4 animate-spin" />;
  return <Circle className="h-4 w-4" />;
}

export function FloorTimeline({ projectId, floors, selectedFloorId }: { projectId: string; floors: Floor[]; selectedFloorId?: string }) {
  return (
    <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
      {floors.map((floor) => (
        <Link
          key={floor.id}
          href={`/project/${projectId}/floor/${floor.id}`}
          className={cx(
            "min-w-48 rounded-lg border p-4 transition hover:translate-y-[-1px]",
            tone(floor.status),
            selectedFloorId === floor.id && "ring-1 ring-cyan-200/70"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <Icon status={floor.status} />
            <span className="mono-font text-xs opacity-70">#{floor.floor_number}</span>
          </div>
          <p className="mt-3 truncate text-base font-semibold">{floor.floor_name}</p>
          <p className="mono-font mt-1 text-xs opacity-70">{FLOOR_STATUS_LABELS[floor.status]}</p>
        </Link>
      ))}
    </div>
  );
}
