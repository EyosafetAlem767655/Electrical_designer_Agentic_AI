import Link from "next/link";
import { Activity, Bot, Cpu, FolderPlus } from "lucide-react";
import { StatusPulse } from "@/components/ui/StatusPulse";
import { NeonButton } from "@/components/ui/NeonButton";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#94d2cc]/14 bg-[#07111f]/78 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3 lg:hidden">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#2f8178]/18 bg-[#2f8178]/10 shadow-[0_12px_26px_rgba(31,42,51,0.08)]">
            <Cpu className="h-5 w-5 text-[#2f8178]" />
          </div>
          <div className="min-w-0">
            <p className="tech-font truncate text-base font-semibold text-white">Elec Nova Tech AI</p>
            <p className="mono-font truncate text-xs text-cyan-100/58">Agentic Electrical Design System</p>
          </div>
        </Link>
        <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <p className="truncate text-sm text-[#1f2a33]/62">Electrical design studio</p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <div className="flex items-center gap-2 rounded-full border border-[#1f2a33]/10 bg-white/58 px-3 py-2">
            <StatusPulse tone="green" />
            <Bot className="h-4 w-4 text-cyan-100/70" />
            <span className="mono-font text-xs text-cyan-50/72">Bot standby</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#1f2a33]/10 bg-white/58 px-3 py-2">
            <StatusPulse tone="blue" />
            <Activity className="h-4 w-4 text-cyan-100/70" />
            <span className="mono-font text-xs text-cyan-50/72">Realtime enabled</span>
          </div>
          <Link href="/project/new">
            <NeonButton className="h-9 px-3">
              <FolderPlus className="h-4 w-4" />
              New Project
            </NeonButton>
          </Link>
        </div>
      </div>
    </header>
  );
}
