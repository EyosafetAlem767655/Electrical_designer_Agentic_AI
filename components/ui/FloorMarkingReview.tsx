"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, Loader2, RotateCcw } from "lucide-react";
import type { DesignMarkings, Floor } from "@/types";
import { NeonButton } from "@/components/ui/NeonButton";

type BboxKey = "db_room_bbox" | "generator_room_bbox";
type BboxCorner = "nw" | "ne" | "sw" | "se";
type CompleteDesignMarkings = DesignMarkings & {
  source_size: [number, number];
  boundary_polygon: [number, number][];
  db_room_bbox: [number, number, number, number];
  generator_room_bbox: [number, number, number, number];
};
type DragTarget =
  | { kind: "polygon"; index: number }
  | { kind: "bbox"; key: BboxKey; corner: BboxCorner };

function fallbackMarkings(markings: DesignMarkings | undefined): CompleteDesignMarkings | null {
  return markings?.source_size && (markings.boundary_polygon?.length ?? 0) >= 3 && markings.db_room_bbox && markings.generator_room_bbox
    ? (markings as CompleteDesignMarkings)
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function bboxFromPolygon(poly: [number, number][]) {
  const xs = poly.map((point) => point[0]);
  const ys = poly.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number];
}

function updateBboxCorner(bbox: [number, number, number, number], corner: BboxCorner, x: number, y: number) {
  const next: [number, number, number, number] = [...bbox];
  if (corner.includes("w")) next[0] = Math.min(x, next[2] - 8);
  if (corner.includes("e")) next[2] = Math.max(x, next[0] + 8);
  if (corner.includes("n")) next[1] = Math.min(y, next[3] - 8);
  if (corner.includes("s")) next[3] = Math.max(y, next[1] + 8);
  return next;
}

export function FloorMarkingReview({ projectId, floor }: { projectId: string; floor: Floor }) {
  const imageUrl = floor.architectural_image_url;
  const initial = useMemo(() => fallbackMarkings(floor.design_markings?.confirmed ?? floor.design_markings?.ai), [floor.design_markings]);
  const aiMarkings = useMemo(() => fallbackMarkings(floor.design_markings?.ai), [floor.design_markings]);
  const [markings, setMarkings] = useState<CompleteDesignMarkings | null>(initial);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const existing = floor.review_answers && typeof floor.review_answers === "object" ? floor.review_answers : {};
    return Object.fromEntries(Object.entries(existing).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value ?? "")]));
  });
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (!imageUrl || !markings?.source_size) return null;
  const [width, height] = markings.source_size;
  const boundary = markings.boundary_polygon ?? [];
  const designBbox = bboxFromPolygon(boundary);

  function pointerToImage(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return [0, 0] as [number, number];
    const rect = svg.getBoundingClientRect();
    return [
      clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * width, 0, width),
      clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * height, 0, height)
    ] as [number, number];
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!dragTarget) return;
    const [x, y] = pointerToImage(event);
    setMarkings((current) => {
      if (!current) return current;
      if (dragTarget.kind === "polygon") {
        const polygon = [...(current.boundary_polygon ?? [])];
        polygon[dragTarget.index] = [x, y];
        return { ...current, boundary_polygon: polygon, design_bbox: bboxFromPolygon(polygon) };
      }
      const bbox = current[dragTarget.key];
      return { ...current, [dragTarget.key]: updateBboxCorner(bbox, dragTarget.corner, x, y) };
    });
  }

  async function submit() {
    if (!markings) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/projects/${projectId}/floors/${floor.id}/review-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markings, answers, queueGeneration: true })
    });
    const result = await response.json().catch(() => ({ error: "Review save failed" }));
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? "Review save failed");
      return;
    }
    setMessage("Confirmed. Generation has been queued.");
  }

  const boxStyles: Record<BboxKey, { color: string; label: string }> = {
    db_room_bbox: { color: "#3b82f6", label: "DB / Meter" },
    generator_room_bbox: { color: "#22c55e", label: "Generator / Store" }
  };

  return (
    <section className="overflow-hidden rounded border border-[#c6a171]/16 bg-[#100c09]/72">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c6a171]/14 px-4 py-3">
        <div>
          <p className="font-semibold text-[#fffaf0]">Floor Marking Review</p>
          <p className="text-sm text-[#efe4d4]/56">Drag boundary vertices and room-box corners, answer questions, then generate.</p>
        </div>
        <div className="flex gap-2">
          <NeonButton type="button" variant="ghost" onClick={() => aiMarkings && setMarkings(aiMarkings)} disabled={!aiMarkings || busy}>
            <RotateCcw className="h-4 w-4" />
            Reset AI
          </NeonButton>
          <NeonButton type="button" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Confirm & Generate
          </NeonButton>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative border border-[#c6a171]/14 bg-black/28" style={{ aspectRatio: `${width} / ${height}` }}>
          <Image src={imageUrl} alt={`${floor.floor_name} source plan`} fill unoptimized sizes="100vw" className="object-fill" />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="absolute inset-0 h-full w-full touch-none"
            onPointerMove={onPointerMove}
            onPointerUp={() => setDragTarget(null)}
            onPointerLeave={() => setDragTarget(null)}
          >
            <polygon points={boundary.map(([x, y]) => `${x},${y}`).join(" ")} fill="rgba(214,177,125,0.12)" stroke="#d6b17d" strokeWidth={Math.max(width, height) * 0.003} />
            <rect x={designBbox[0]} y={designBbox[1]} width={designBbox[2] - designBbox[0]} height={designBbox[3] - designBbox[1]} fill="none" stroke="rgba(255,255,255,0.35)" strokeDasharray="18 12" />
            {(["db_room_bbox", "generator_room_bbox"] as BboxKey[]).map((key) => {
              const bbox = markings[key];
              const style = boxStyles[key];
              const corners = [
                ["nw", bbox[0], bbox[1]],
                ["ne", bbox[2], bbox[1]],
                ["sw", bbox[0], bbox[3]],
                ["se", bbox[2], bbox[3]]
              ] as const;
              return (
                <g key={key}>
                  <rect x={bbox[0]} y={bbox[1]} width={bbox[2] - bbox[0]} height={bbox[3] - bbox[1]} fill="transparent" stroke={style.color} strokeWidth={Math.max(width, height) * 0.004} />
                  <text x={bbox[0] + 8} y={bbox[1] + 22} fill={style.color} fontSize={Math.max(18, width * 0.018)} fontWeight="700">
                    {style.label}
                  </text>
                  {corners.map(([corner, x, y]) => (
                    <circle key={`${key}-${corner}`} cx={x} cy={y} r={Math.max(8, width * 0.008)} fill={style.color} stroke="#111" strokeWidth={2} onPointerDown={(event) => { event.stopPropagation(); setDragTarget({ kind: "bbox", key, corner }); }} />
                  ))}
                </g>
              );
            })}
            {boundary.map(([x, y], index) => (
              <circle key={index} cx={x} cy={y} r={Math.max(9, width * 0.009)} fill="#d6b17d" stroke="#111" strokeWidth={2} onPointerDown={(event) => { event.stopPropagation(); setDragTarget({ kind: "polygon", index }); }} />
            ))}
          </svg>
        </div>

        <div className="space-y-3">
          <div className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3 text-sm text-[#efe4d4]/64">
            <p className="font-medium text-[#fffaf0]">Source Pixels</p>
            <p className="mt-1">{Math.round(width)} x {Math.round(height)}</p>
            {markings.warnings?.length ? <p className="mt-2 text-[#d6b17d]">{markings.warnings[0]?.message}</p> : null}
          </div>
          {(floor.ai_questions ?? []).map((question, index) => {
            const key = `q${index + 1}`;
            return (
              <label key={key} className="block rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
                <span className="text-sm text-[#efe4d4]/72">{index + 1}. {question}</span>
                <textarea
                  value={answers[key] ?? ""}
                  onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))}
                  className="mt-2 min-h-20 w-full rounded border border-[#c6a171]/18 bg-[#140f0c]/70 px-3 py-2 text-sm text-[#fffaf0] outline-none focus:border-[#d6b17d]/60"
                />
              </label>
            );
          })}
          {message ? <p className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3 text-sm text-[#efe4d4]/76">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
