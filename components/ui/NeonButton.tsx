"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "border-[#d6b17d]/60 bg-[#6d4c34]/28 text-[#fffaf0] shadow-[0_14px_30px_rgba(0,0,0,0.18)] hover:bg-[#7c573c]/34",
  secondary: "border-[#c2a177]/48 bg-[#f7f2ea]/8 text-[#f7f2ea] shadow-[0_14px_30px_rgba(0,0,0,0.14)] hover:bg-[#f7f2ea]/12",
  danger: "border-[#b26457]/50 bg-[#7c3f35]/18 text-[#f6dfd9] shadow-[0_14px_30px_rgba(0,0,0,0.14)] hover:bg-[#8d493e]/24",
  ghost: "border-[#c6a171]/22 bg-white/[0.035] text-[#efe4d4]/82 hover:border-[#d6b17d]/48 hover:bg-[#6d4c34]/16"
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
