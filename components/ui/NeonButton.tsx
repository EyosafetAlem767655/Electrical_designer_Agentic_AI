"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "border-cyan-200/60 bg-cyan-300/12 text-cyan-50 shadow-[0_0_22px_rgba(0,240,255,0.14)] hover:bg-cyan-300/20",
  secondary: "border-lime-200/50 bg-lime-300/10 text-lime-50 shadow-[0_0_20px_rgba(232,255,0,0.10)] hover:bg-lime-300/18",
  danger: "border-rose-300/50 bg-rose-400/10 text-rose-50 shadow-[0_0_20px_rgba(255,51,102,0.12)] hover:bg-rose-400/18",
  ghost: "border-cyan-300/18 bg-white/[0.03] text-cyan-50/80 hover:border-cyan-200/42 hover:bg-cyan-300/8"
};

export function NeonButton({
  className,
  children,
  disabled,
  type = "button",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      disabled={disabled}
      type={type}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}
