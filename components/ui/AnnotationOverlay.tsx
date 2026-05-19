"use client";

import { useState } from "react";
import type { DesignAnnotation } from "@/types";

const planBounds = {
  left: 16,
  top: 8,
  width: 68,
  height: 84
};

function pointOnPlan(x: number, y: number) {
  return {
    x: planBounds.left + (Math.min(100, Math.max(0, x)) / 100) * planBounds.width,
    y: planBounds.top + (Math.min(100, Math.max(0, y)) / 100) * planBounds.height
  };
}

function calloutPosition(annotation: DesignAnnotation, index: number) {
  const target = pointOnPlan(annotation.targetX, annotation.targetY);
  const onLeft = target.x < 50;
  const label = annotation.label.length > 16 ? `${annotation.label.slice(0, 15)}...` : annotation.label;
  const width = Math.min(planBounds.left - 2.4, Math.max(8.5, label.length * 0.55 + 3.5));
  const x = onLeft ? 1.2 : 98.8 - width;
  const row = index % 9;
  const y = Math.min(92, Math.max(4, planBounds.top + 2 + row * 9.2));
  return { x, y, width, target, label };
}

export function AnnotationOverlay({ annotations }: { annotations: DesignAnnotation[] }) {
  const [active, setActive] = useState<string | null>(null);
  const safeAnnotations = annotations.filter((annotation) => annotation?.label && Number.isFinite(annotation.x) && Number.isFinite(annotation.y) && Number.isFinite(annotation.targetX) && Number.isFinite(annotation.targetY));
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f8178" />
        </marker>
      </defs>
      {safeAnnotations.map((annotation, index) => {
        const isActive = active === annotation.label;
        const callout = calloutPosition(annotation, index);
        const lineStartX = callout.x < 50 ? callout.x + callout.width : callout.x;
        const lineStartY = callout.y + 2.1;
        return (
          <g key={`${annotation.label}-${annotation.x}-${annotation.y}`} onMouseEnter={() => setActive(annotation.label)} onMouseLeave={() => setActive(null)}>
            <line
              x1={lineStartX}
              y1={lineStartY}
              x2={callout.target.x}
              y2={callout.target.y}
              stroke={isActive ? "#d66f61" : "#2f8178"}
              strokeWidth={isActive ? 0.45 : 0.22}
              markerEnd="url(#arrow)"
            />
            <rect x={callout.x} y={callout.y} width={callout.width} height="4.6" fill="rgba(255,253,248,0.96)" stroke={isActive ? "#d66f61" : "#2f8178"} strokeWidth="0.18" rx="0.9" />
            <text x={callout.x + 0.8} y={callout.y + 3} fill="#1f2a33" fontSize="1.95" fontFamily="Arial, sans-serif">
              {callout.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
