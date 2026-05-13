"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { DEFAULT_SYMBOL_LEGEND } from "@/lib/constants";
import type { Design } from "@/types";
import { AnnotationOverlay } from "@/components/ui/AnnotationOverlay";
import { NeonButton } from "@/components/ui/NeonButton";

export function DesignViewer({ design }: { design?: Design | null }) {
  const [zoom, setZoom] = useState(1);
  const legend = design?.symbol_legend?.length ? design.symbol_legend : DEFAULT_SYMBOL_LEGEND;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
      <div className="glass-panel overflow-hidden rounded-lg p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="mono-font text-xs text-cyan-100/62">Design viewer · zoom {(zoom * 100).toFixed(0)}%</p>
          <div className="flex gap-2">
            <NeonButton variant="ghost" className="h-8 px-2" onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))} title="Zoom out">
              <Minus className="h-4 w-4" />
            </NeonButton>
            <NeonButton variant="ghost" className="h-8 px-2" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} title="Zoom in">
              <Plus className="h-4 w-4" />
            </NeonButton>
            <NeonButton variant="ghost" className="h-8 px-2" onClick={() => setZoom(1)} title="Reset view">
              <Maximize2 className="h-4 w-4" />
            </NeonButton>
          </div>
        </div>
        <div className="relative aspect-[1.42] overflow-auto rounded border border-cyan-300/18 bg-white">
          <div className="relative h-full min-h-[360px] w-full origin-center transition" style={{ transform: `scale(${zoom})` }}>
            {design?.design_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={design.design_image_url} alt="Electrical design" className="h-full w-full object-contain" />
            ) : (
              <div className="grid h-full place-items-center bg-[linear-gradient(90deg,#eef8ff_1px,transparent_1px),linear-gradient(#eef8ff_1px,transparent_1px)] bg-[size:28px_28px] text-slate-700">
                <div className="rounded border border-slate-300 bg-white/90 px-5 py-4 text-center">
                  <p className="tech-font text-lg font-semibold">Design artifact pending</p>
                  <p className="mono-font mt-1 text-xs text-slate-500">AI-generated image and SVG annotations will appear here.</p>
                </div>
              </div>
            )}
            {design?.annotations?.length ? <AnnotationOverlay annotations={design.annotations} /> : null}
          </div>
        </div>
      </div>
      <aside className="glass-panel rounded-lg p-4">
        <p className="tech-font text-sm font-semibold text-white">Interactive Legend</p>
        <div className="mt-4 space-y-3">
          {legend.map((item) => (
            <div key={`${item.symbol}-${item.label}`} className="rounded border border-cyan-300/14 bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                <span className="mono-font grid h-8 w-8 place-items-center rounded border text-xs font-semibold" style={{ color: item.color, borderColor: `${item.color}88` }}>
                  {item.symbol}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{item.label}</p>
                  <p className="text-xs text-cyan-50/55">{item.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
