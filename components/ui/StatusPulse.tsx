import { cx } from "@/lib/utils";

const tones = {
  green: "bg-emerald-300 shadow-[0_0_14px_rgba(0,255,136,0.75)]",
  yellow: "bg-lime-200 shadow-[0_0_14px_rgba(232,255,0,0.75)]",
  blue: "bg-cyan-300 shadow-[0_0_14px_rgba(0,240,255,0.75)]",
  red: "bg-rose-400 shadow-[0_0_14px_rgba(255,51,102,0.75)]",
  gray: "bg-slate-400 shadow-[0_0_12px_rgba(148,163,184,0.42)]"
};

export function StatusPulse({ tone = "blue" }: { tone?: keyof typeof tones }) {
  return <span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", tones[tone], "after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-current after:opacity-40")} />;
}
