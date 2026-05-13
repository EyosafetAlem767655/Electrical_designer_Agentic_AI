import Link from "next/link";
import { Activity, Bot, Cpu } from "lucide-react";
import { StatusPulse } from "@/components/ui/StatusPulse";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-cyan-300/15 bg-[#07070b]/74 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded border border-cyan-300/50 bg-cyan-300/10 shadow-[0_0_24px_rgba(0,240,255,0.18)]">
            <Cpu className="h-5 w-5 text-cyan-200" />
          </div>
          <div className="min-w-0">
            <p className="tech-font truncate text-base font-semibold text-white">Elec Nova Tech AI</p>
            <p className="mono-font truncate text-xs text-cyan-100/58">Agentic Electrical Design System</p>
          </div>
        </Link>
        <div className="hidden items-center gap-3 md:flex">
          <div className="flex items-center gap-2 rounded border border-cyan-300/20 bg-white/[0.03] px-3 py-2">
            <StatusPulse tone="green" />
            <Bot className="h-4 w-4 text-cyan-100/70" />
            <span className="mono-font text-xs text-cyan-50/72">Bot standby</span>
          </div>
          <div className="flex items-center gap-2 rounded border border-cyan-300/20 bg-white/[0.03] px-3 py-2">
            <StatusPulse tone="blue" />
            <Activity className="h-4 w-4 text-cyan-100/70" />
            <span className="mono-font text-xs text-cyan-50/72">Realtime enabled</span>
          </div>
        </div>
      </div>
    </header>
  );
}
