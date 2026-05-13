"use client";

import { Layers3, Maximize2, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { DEFAULT_SYMBOL_LEGEND } from "@/lib/constants";
import type { Design } from "@/types";
import { AnnotationOverlay } from "@/components/ui/AnnotationOverlay";
import { NeonButton } from "@/components/ui/NeonButton";

export function DesignViewer({ design }: { design?: Design | null }) {
  const [zoom, setZoom] = useState(1);
  const legend = design?.symbol_legend?.length ? design.symbol_legend : DEFAULT_SYMBOL_LEGEND;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
      <div className="glass-panel overflow-hidden rounded p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#c6a171]/14 px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-[#d6b17d]/72" />
            <p className="text-sm font-semibold text-[#fffaf0]">Drawing Workspace</p>
            <span className="text-xs text-[#c9b9a6]/55">Zoom {(zoom * 100).toFixed(0)}%</span>
          </div>
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
        <div className="relative aspect-[1.42] overflow-auto bg-[#f4efe7] p-4">
          <div className="absolute left-4 top-4 z-10 rounded border border-[#c6a171]/30 bg-[#fffaf0]/90 px-2 py-1 text-xs font-semibold text-[#3b2a20]">A1 REVIEW PREVIEW</div>
          <div className="relative h-full min-h-[360px] w-full origin-center transition" style={{ transform: `scale(${zoom})` }}>
            {design?.design_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={design.design_image_url} alt="Electrical design" className="h-full w-full object-contain" />
            ) : (
              <div className="grid h-full place-items-center border border-[#d8c9b5] bg-[linear-gradient(90deg,#e6dac9_1px,transparent_1px),linear-gradient(#e6dac9_1px,transparent_1px)] bg-[size:28px_28px] text-[#3b2a20]">
                <div className="rounded border border-[#d1bfaa] bg-[#fffaf0]/92 px-5 py-4 text-center shadow-sm">
                  <p className="text-lg font-semibold">Design artifact pending</p>
                  <p className="mt-1 text-xs text-[#6d5a49]">AI-generated image and SVG annotations will appear here.</p>
                </div>
              </div>
            )}
            {design?.annotations?.length ? <AnnotationOverlay annotations={design.annotations} /> : null}
          </div>
        </div>
      </div>
      <aside className="glass-panel rounded p-4">
        <p className="text-sm font-semibold text-[#fffaf0]">Symbol Legend</p>
        <p className="mt-1 text-xs text-[#c9b9a6]/56">Electrical systems used in the current design.</p>
        <div className="mt-4 space-y-2">
          {legend.map((item) => (
            <div key={`${item.symbol}-${item.label}`} className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
              <div className="flex items-center gap-3">
                <span className="mono-font grid h-8 w-8 place-items-center rounded border text-xs font-semibold" style={{ color: item.color, borderColor: `${item.color}88` }}>
                  {item.symbol}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#fffaf0]">{item.label}</p>
                  <p className="text-xs text-[#c9b9a6]/58">{item.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
