"use client";

import { useState } from "react";
import type { DesignAnnotation } from "@/types";

export function AnnotationOverlay({ annotations }: { annotations: DesignAnnotation[] }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f8178" />
        </marker>
      </defs>
      {annotations.map((annotation) => {
        const isActive = active === annotation.label;
        return (
          <g key={`${annotation.label}-${annotation.x}-${annotation.y}`} onMouseEnter={() => setActive(annotation.label)} onMouseLeave={() => setActive(null)}>
            <line
              x1={annotation.x}
              y1={annotation.y}
              x2={annotation.targetX}
              y2={annotation.targetY}
              stroke={isActive ? "#d66f61" : "#2f8178"}
              strokeWidth={isActive ? 0.45 : 0.22}
              markerEnd="url(#arrow)"
            />
            <rect x={annotation.x - 0.8} y={annotation.y - 2.3} width={Math.max(8, annotation.label.length * 1.15)} height="4.2" fill="rgba(255,253,248,0.92)" stroke={isActive ? "#d66f61" : "#2f8178"} strokeWidth="0.18" rx="1.2" />
            <text x={annotation.x} y={annotation.y + 0.5} fill="#1f2a33" fontSize="2.2" fontFamily="Arial, sans-serif">
              {annotation.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
