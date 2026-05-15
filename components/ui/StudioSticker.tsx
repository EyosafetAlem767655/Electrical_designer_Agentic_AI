import { cx } from "@/lib/utils";

type StickerKind = "drafting" | "handoff" | "package";

export function StudioSticker({ kind, className }: { kind: StickerKind; className?: string }) {
  if (kind === "handoff") {
    return (
      <div className={cx("tech-ambient", className)} aria-hidden="true">
        <svg viewBox="0 0 260 190" role="img">
          <defs>
            <linearGradient id="handoffGlow" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#5eead4" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <path className="tech-halo" d="M35 95c0-42 41-76 94-76s96 34 96 76-43 76-96 76-94-34-94-76Z" />
          <path className="tech-ring" d="M74 96c0-25 25-45 56-45s56 20 56 45-25 45-56 45-56-20-56-45Z" />
          <path className="tech-route" d="M58 104c24-39 47-38 72-6s49 33 76-8" />
          <circle className="tech-node node-a" cx="58" cy="104" r="8" />
          <circle className="tech-node node-b" cx="130" cy="98" r="10" />
          <circle className="tech-node node-c" cx="206" cy="90" r="8" />
          <path className="tech-scan" d="M93 68h75M83 121h96" />
          <g className="tech-orbit">
            <circle cx="130" cy="42" r="4" fill="#f8fafc" />
            <circle cx="190" cy="122" r="3" fill="#5eead4" />
            <circle cx="76" cy="130" r="3" fill="#a78bfa" />
          </g>
        </svg>
      </div>
    );
  }

  if (kind === "package") {
    return (
      <div className={cx("tech-ambient", className)} aria-hidden="true">
        <svg viewBox="0 0 260 190" role="img">
          <path className="tech-halo" d="M38 112c-10-38 32-78 86-89 56-11 104 10 112 49 8 40-28 79-86 91-57 12-102-12-112-51Z" />
          <g className="tech-stack stack-back">
            <path className="tech-panel" d="M78 45h89l31 25v75H78V45Z" />
            <path className="tech-fold" d="M167 45v26h31" />
          </g>
          <g className="tech-stack stack-front">
            <path className="tech-panel" d="M58 32h90l30 25v75H58V32Z" />
            <path className="tech-fold" d="M148 32v26h30" />
          </g>
          <path className="tech-scan" d="M79 72h71M79 91h50M79 110h76" />
          <path className="tech-check" d="M178 121l11 12 26-33" />
          <circle className="tech-node node-c" cx="198" cy="113" r="22" />
        </svg>
      </div>
    );
  }

  return (
    <div className={cx("tech-ambient", className)} aria-hidden="true">
      <svg viewBox="0 0 260 190" role="img">
        <defs>
          <linearGradient id="draftingPanel" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#172554" />
            <stop offset="100%" stopColor="#0f766e" />
          </linearGradient>
        </defs>
        <path className="tech-halo" d="M33 96c0-45 44-82 99-82s99 37 99 82-44 82-99 82-99-37-99-82Z" />
        <path className="tech-board" d="M48 45h140l24 23v78H48V45Z" />
        <path className="tech-fold" d="M188 45v24h24" />
        <path className="tech-grid" d="M67 66h110M67 86h126M67 106h105M67 126h120M88 55v85M111 55v85M134 55v85M157 55v85" />
        <path className="tech-route" d="M68 128c20-68 55 12 79-40 18-39 43-14 66-40" />
        <circle className="tech-node node-a" cx="68" cy="128" r="7" />
        <circle className="tech-node node-b" cx="148" cy="88" r="7" />
        <circle className="tech-node node-c" cx="213" cy="48" r="7" />
        <path className="tech-cursor" d="M184 133l28-58 18 9-29 59-19 10 2-20Z" />
      </svg>
    </div>
  );
}
