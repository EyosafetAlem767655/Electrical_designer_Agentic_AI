import Link from "next/link";
import { CheckCircle2, Circle, Loader2, RotateCcw } from "lucide-react";
import { FLOOR_STATUS_LABELS } from "@/lib/constants";
import { cx } from "@/lib/utils";
import type { Floor } from "@/types";

function tone(status: Floor["status"]) {
  if (status === "approved") return "border-[#8fa37c]/42 bg-[#8fa37c]/10 text-[#dfe8d7]";
  if (status === "design_ready") return "border-[#d6b17d]/50 bg-[#6d4c34]/16 text-[#fffaf0]";
  if (status === "revision_requested") return "border-[#d6b17d]/44 bg-[#d6b17d]/10 text-[#f5e1bd]";
  if (["analyzing", "designing", "questions_sent", "pdf_received"].includes(status)) return "border-[#b89162]/44 bg-[#6d4c34]/12 text-[#efe4d4]";
  return "border-[#c6a171]/14 bg-white/[0.025] text-[#c9b9a6]/78";
}

function Icon({ status }: { status: Floor["status"] }) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "revision_requested") return <RotateCcw className="h-4 w-4" />;
  if (["analyzing", "designing"].includes(status)) return <Loader2 className="h-4 w-4 animate-spin" />;
  return <Circle className="h-4 w-4" />;
}

export function FloorTimeline({ projectId, floors, selectedFloorId }: { projectId: string; floors: Floor[]; selectedFloorId?: string }) {
  return (
    <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-2">
      {floors.map((floor) => (
        <Link
          key={floor.id}
          href={`/project/${projectId}/floor/${floor.id}`}
          className={cx(
            "min-w-52 rounded border px-3 py-3 transition hover:bg-white/[0.04]",
            tone(floor.status),
            selectedFloorId === floor.id && "ring-1 ring-[#d6b17d]/60"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <Icon status={floor.status} />
            <span className="text-xs opacity-70">Level {floor.floor_number}</span>
          </div>
          <p className="mt-2 truncate text-sm font-semibold">{floor.floor_name}</p>
          <p className="mt-1 text-xs opacity-70">{FLOOR_STATUS_LABELS[floor.status]}</p>
        </Link>
      ))}
    </div>
  );
}
