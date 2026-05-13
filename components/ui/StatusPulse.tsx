import { cx } from "@/lib/utils";

const tones = {
  green: "bg-[#8fa37c] shadow-[0_0_12px_rgba(143,163,124,0.48)]",
  yellow: "bg-[#d6b17d] shadow-[0_0_12px_rgba(214,177,125,0.48)]",
  blue: "bg-[#b89162] shadow-[0_0_12px_rgba(184,145,98,0.46)]",
  red: "bg-[#b26457] shadow-[0_0_12px_rgba(178,100,87,0.46)]",
  gray: "bg-[#8a7d70] shadow-[0_0_10px_rgba(138,125,112,0.32)]"
};

export function StatusPulse({ tone = "blue" }: { tone?: keyof typeof tones }) {
  return <span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", tones[tone], "after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-current after:opacity-40")} />;
}
