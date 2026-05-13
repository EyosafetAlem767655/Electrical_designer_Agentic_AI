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
    <aside className="hidden w-64 shrink-0 border-r border-[#1f2a33]/10 bg-[#fffdf8]/72 px-4 py-5 backdrop-blur-xl lg:block">
      <div className="mb-8 border-b border-[#1f2a33]/10 pb-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full border border-[#2f8178]/18 bg-[#2f8178]/10">
            <Bot className="h-5 w-5 text-[#2f8178]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1f2a33]">Elec Nova Tech</p>
            <p className="text-xs text-[#687580]">Design studio</p>
          </div>
        </div>
      </div>
      <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#687580]/70">Studio</p>
      <nav className="flex flex-col gap-1.5">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex h-11 items-center gap-3 rounded-full border border-transparent px-3 text-sm font-medium text-[#1f2a33]/68 transition hover:border-[#2f8178]/18 hover:bg-[#2f8178]/8 hover:text-[#1f2a33]"
              title={item.label}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 rounded-[22px_10px_18px_12px] border border-[#1f2a33]/10 bg-white/62 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#687580]/70">Studio Flow</p>
        <p className="mt-2 text-sm leading-5 text-[#1f2a33]/64">Project intake, drawing review, revisions, and PDF issue tracking in one calm workspace.</p>
      </div>
    </aside>
  );
}
