"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "border-[#2f8178]/20 bg-[#2f8178] text-white shadow-[0_12px_28px_rgba(47,129,120,0.18)] hover:bg-[#156a63]",
  secondary: "border-[#6d5a87]/22 bg-[#6d5a87]/10 text-[#2c2440] shadow-[0_12px_28px_rgba(31,42,51,0.08)] hover:bg-[#6d5a87]/16",
  danger: "border-[#d66f61]/26 bg-[#d66f61]/12 text-[#8d332b] shadow-[0_12px_28px_rgba(31,42,51,0.08)] hover:bg-[#d66f61]/18",
  ghost: "border-[#1f2a33]/10 bg-white/45 text-[#1f2a33]/78 hover:border-[#2f8178]/24 hover:bg-[#2f8178]/8"
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
        "inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}
