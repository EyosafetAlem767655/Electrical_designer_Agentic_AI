import Link from "next/link";
import { Activity, Bot, Cpu, FolderPlus } from "lucide-react";
import { StatusPulse } from "@/components/ui/StatusPulse";
import { NeonButton } from "@/components/ui/NeonButton";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#c6a171]/18 bg-[#1b130f]/86 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3 lg:hidden">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded border border-[#d6b17d]/40 bg-[#6d4c34]/20 shadow-[0_14px_30px_rgba(0,0,0,0.22)]">
            <Cpu className="h-5 w-5 text-[#e7d3b8]" />
          </div>
          <div className="min-w-0">
            <p className="tech-font truncate text-base font-semibold text-white">Elec Nova Tech AI</p>
            <p className="mono-font truncate text-xs text-cyan-100/58">Agentic Electrical Design System</p>
          </div>
        </Link>
        <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <p className="truncate text-sm text-[#f7f2ea]/72">Engineering command workspace</p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <div className="flex items-center gap-2 rounded border border-[#c6a171]/20 bg-white/[0.035] px-3 py-2">
            <StatusPulse tone="green" />
            <Bot className="h-4 w-4 text-cyan-100/70" />
            <span className="mono-font text-xs text-cyan-50/72">Bot standby</span>
          </div>
          <div className="flex items-center gap-2 rounded border border-[#c6a171]/20 bg-white/[0.035] px-3 py-2">
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
