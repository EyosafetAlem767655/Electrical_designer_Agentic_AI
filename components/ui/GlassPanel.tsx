import type { HTMLAttributes } from "react";
import { cx } from "@/lib/utils";

export function GlassPanel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cx("glass-panel rounded-lg p-5", className)} {...props}>
      {children}
    </section>
  );
}
