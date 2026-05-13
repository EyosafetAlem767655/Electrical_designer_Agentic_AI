import Link from "next/link";
import { Bot, FolderPlus, Gauge, MessageSquare, Workflow } from "lucide-react";

const nav = [
  { href: "/", label: "Command", icon: Gauge },
  { href: "/project/new", label: "New Project", icon: FolderPlus },
  { href: "/project/demo-project/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/api/jobs/process", label: "Jobs", icon: Workflow }
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-[#c6a171]/18 bg-[#120d0a]/90 px-4 py-5 backdrop-blur-xl lg:block">
      <div className="mb-8 border-b border-[#c6a171]/14 pb-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded border border-[#d6b17d]/34 bg-[#6d4c34]/22">
            <Bot className="h-5 w-5 text-[#e7d3b8]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#fffaf0]">Elec Nova Tech</p>
            <p className="text-xs text-[#c9b9a6]/70">Electrical design ops</p>
          </div>
        </div>
      </div>
      <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#c9b9a6]/48">Workspace</p>
      <nav className="flex flex-col gap-1.5">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex h-11 items-center gap-3 rounded border border-transparent px-3 text-sm font-medium text-[#e8ddcf]/72 transition hover:border-[#d6b17d]/28 hover:bg-[#6d4c34]/18 hover:text-white"
              title={item.label}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 rounded border border-[#c6a171]/16 bg-white/[0.025] p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#c9b9a6]/48">Review Mode</p>
        <p className="mt-2 text-sm leading-5 text-[#f7f2ea]/68">Project intake, drawing review, revisions, and PDF issue tracking in one workspace.</p>
      </div>
    </aside>
  );
}
