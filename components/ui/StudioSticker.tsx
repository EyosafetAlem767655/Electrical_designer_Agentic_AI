import { cx } from "@/lib/utils";

type StickerKind = "drafting" | "handoff" | "package";

export function StudioSticker({ kind, className }: { kind: StickerKind; className?: string }) {
  if (kind === "handoff") {
    return (
      <div className={cx("studio-sticker", className)} aria-hidden="true">
        <svg viewBox="0 0 180 150" role="img">
          <path className="sticker-paper" d="M39 26c26-16 83-19 107 6 18 19 10 59-12 77-24 20-75 24-100 3C7 89 11 43 39 26Z" />
          <path className="sticker-line" d="M55 76c16-19 52-22 72-4" />
          <path className="sticker-line delayed" d="M69 55h41" />
          <path className="sticker-line delayed-more" d="M70 97h38" />
          <circle className="sticker-dot" cx="53" cy="78" r="9" />
          <circle className="sticker-dot coral" cx="130" cy="70" r="9" />
          <path className="sticker-accent" d="M120 95l22 12-19 12 4-14-7-10Z" />
        </svg>
      </div>
    );
  }

  if (kind === "package") {
    return (
      <div className={cx("studio-sticker", className)} aria-hidden="true">
        <svg viewBox="0 0 180 150" role="img">
          <path className="sticker-paper plum" d="M34 28c28-18 89-16 112 11 19 22 2 69-28 82-31 13-80 5-97-20C3 75 9 45 34 28Z" />
          <path className="sticker-sheet" d="M61 40h58l19 19v53H61V40Z" />
          <path className="sticker-fold" d="M119 40v20h19" />
          <path className="sticker-line" d="M75 73h48" />
          <path className="sticker-line delayed" d="M75 88h36" />
          <path className="sticker-line delayed-more" d="M75 103h50" />
          <circle className="sticker-dot coral" cx="55" cy="112" r="7" />
        </svg>
      </div>
    );
  }

  return (
    <div className={cx("studio-sticker", className)} aria-hidden="true">
      <svg viewBox="0 0 180 150" role="img">
        <path className="sticker-paper teal" d="M31 30c25-22 89-22 116 2 26 23 16 75-17 91-34 16-91 5-112-22C-2 76 8 50 31 30Z" />
        <path className="sticker-sheet" d="M43 43h92v66H43V43Z" />
        <path className="sticker-line" d="M58 62h63" />
        <path className="sticker-line delayed" d="M58 79h42" />
        <path className="sticker-line delayed-more" d="M58 96h58" />
        <path className="sticker-accent" d="M119 107l25-54 15 7-25 54-17 10 2-17Z" />
        <path className="sticker-fold" d="M119 107l15 7" />
      </svg>
    </div>
  );
}
