import Link from "next/link";
import { FolderPlus, Gauge, MessageSquare, Workflow } from "lucide-react";

const nav = [
  { href: "/", label: "Command", icon: Gauge },
  { href: "/project/new", label: "New Project", icon: FolderPlus },
  { href: "/project/demo-project/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/api/jobs/process", label: "Jobs", icon: Workflow }
];

export function Sidebar() {
  return (
    <aside className="hidden w-20 shrink-0 border-r border-[#c6a171]/18 bg-[#120d0a]/88 px-3 py-4 backdrop-blur-xl lg:block">
      <nav className="flex flex-col gap-3">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group grid h-14 place-items-center rounded border border-[#c6a171]/16 bg-white/[0.025] text-[#e8ddcf]/68 transition hover:border-[#d6b17d]/50 hover:bg-[#6d4c34]/18 hover:text-white"
              title={item.label}
            >
              <Icon className="h-5 w-5" />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
