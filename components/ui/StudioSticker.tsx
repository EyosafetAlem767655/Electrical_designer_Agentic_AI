import { cx } from "@/lib/utils";

type StickerKind = "drafting" | "handoff" | "package";

export function StudioSticker({ kind, className }: { kind: StickerKind; className?: string }) {
  if (kind === "handoff") {
    return (
      <div className={cx("studio-sticker", className)} aria-hidden="true">
        <svg viewBox="0 0 220 170" role="img">
          <path className="sticker-paper" d="M41 26c33-21 106-21 137 8 26 24 13 82-25 105-37 22-104 14-132-19C-5 88 7 48 41 26Z" />
          <g className="sticker-orbit">
            <circle className="sticker-dot coral" cx="106" cy="22" r="6" />
            <circle className="sticker-dot" cx="158" cy="78" r="5" />
            <circle className="sticker-dot coral" cx="78" cy="131" r="4" />
          </g>
          <circle className="sticker-sheet" cx="66" cy="82" r="25" />
          <circle className="sticker-sheet" cx="154" cy="78" r="25" />
          <path className="sticker-route" d="M91 80c20-30 40 26 62-2" />
          <circle className="sticker-pulse" cx="91" cy="80" r="7" />
          <path className="sticker-line" d="M54 77h24" />
          <path className="sticker-line delayed" d="M143 73h24" />
          <path className="sticker-accent" d="M105 113l30 12-25 18 4-17-9-13Z" />
        </svg>
      </div>
    );
  }

  if (kind === "package") {
    return (
      <div className={cx("studio-sticker", className)} aria-hidden="true">
        <svg viewBox="0 0 220 170" role="img">
          <path className="sticker-paper plum" d="M42 29c36-25 111-19 142 15 23 25 2 82-37 99-40 18-105 8-128-27C-3 81 9 52 42 29Z" />
          <g className="sticker-stack-b">
            <path className="sticker-sheet" d="M70 49h72l21 21v65H70V49Z" />
            <path className="sticker-fold" d="M142 49v22h21" />
          </g>
          <g className="sticker-stack-a">
            <path className="sticker-sheet" d="M54 39h72l21 21v65H54V39Z" />
            <path className="sticker-fold" d="M126 39v22h21" />
          </g>
          <path className="sticker-line" d="M72 76h54" />
          <path className="sticker-line delayed" d="M72 93h39" />
          <path className="sticker-line delayed-more" d="M72 110h62" />
          <circle className="sticker-dot coral" cx="154" cy="120" r="9" />
          <path className="sticker-accent" d="M149 117l5 6 13-17" />
        </svg>
      </div>
    );
  }

  return (
    <div className={cx("studio-sticker", className)} aria-hidden="true">
      <svg viewBox="0 0 220 170" role="img">
        <path className="sticker-paper teal" d="M38 32c34-31 117-27 149 4 31 31 16 93-29 113-45 20-118 4-145-36C-10 78 5 61 38 32Z" />
        <path className="sticker-sheet" d="M43 42h111v82H43V42Z" />
        <path className="sticker-grid" d="M43 62h111M43 82h111M43 102h111M65 42v82M87 42v82M109 42v82M131 42v82" />
        <path className="sticker-route" d="M58 111c13-51 42 1 58-39 13-34 37-11 52-31" />
        <circle className="sticker-pulse" cx="58" cy="111" r="7" />
        <path className="sticker-line delayed" d="M60 58h56" />
        <path className="sticker-line delayed-more" d="M60 92h34" />
        <g className="sticker-pencil">
          <path className="sticker-accent" d="M143 118l28-69 17 8-29 69-19 11 3-19Z" />
          <path className="sticker-fold" d="M143 118l16 8" />
        </g>
      </svg>
    </div>
  );
}
