import { cx } from "@/lib/utils";

const tones = {
  green: "bg-[#6d8a66] shadow-[0_0_10px_rgba(109,138,102,0.34)]",
  yellow: "bg-[#d66f61] shadow-[0_0_10px_rgba(214,111,97,0.3)]",
  blue: "bg-[#2f8178] shadow-[0_0_10px_rgba(47,129,120,0.3)]",
  red: "bg-[#c95f55] shadow-[0_0_10px_rgba(201,95,85,0.32)]",
  gray: "bg-[#687580] shadow-[0_0_10px_rgba(104,117,128,0.22)]"
};

export function StatusPulse({ tone = "blue" }: { tone?: keyof typeof tones }) {
  return <span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", tones[tone], "after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-current after:opacity-40")} />;
}
