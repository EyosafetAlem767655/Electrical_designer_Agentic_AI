import Link from "next/link";
import { ArrowRight, Bot, CircuitBoard, FileCheck2, FolderPlus, MessageSquare, Zap } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NeonButton } from "@/components/ui/NeonButton";
import { StatusPulse } from "@/components/ui/StatusPulse";
import { PROJECT_STATUS_LABELS } from "@/lib/constants";
import { getProjects } from "@/lib/data";
import { formatDateTime } from "@/lib/utils";

function projectTone(status: string) {
  if (status === "completed") return "green" as const;
  if (status === "in_progress") return "blue" as const;
  if (status === "awaiting_verification") return "yellow" as const;
  return "gray" as const;
}

export default async function CommandCenterPage() {
  const projects = await getProjects();
  const active = projects[0];

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <GlassPanel className="scan-line min-h-[340px] overflow-hidden">
          <div className="flex flex-col justify-between gap-8 lg:flex-row">
            <div className="max-w-3xl">
              <p className="mono-font text-sm uppercase text-cyan-100/64">Command Center</p>
              <h1 className="tech-font mt-3 text-4xl font-semibold text-white sm:text-6xl">Electrical Design Intelligence</h1>
              <p className="mt-5 max-w-2xl text-lg leading-7 text-cyan-50/68">
                Manage architect intake, Grok floor-plan analysis, Aurora design generation, engineering review, and A1 PDF export from one live dashboard.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/project/new">
                  <NeonButton>
                    <FolderPlus className="h-4 w-4" />
                    New Project
                  </NeonButton>
                </Link>
                {active ? (
                  <Link href={`/project/${active.id}`}>
                    <NeonButton variant="ghost">
                      Open Active
                      <ArrowRight className="h-4 w-4" />
                    </NeonButton>
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="grid min-w-72 place-items-center">
              <div className="relative h-52 w-52 rounded-full border border-[#c6a171]/22 bg-[#6d4c34]/8 shadow-[0_28px_80px_rgba(0,0,0,0.22)]">
                <div className="absolute inset-8 rounded-full border border-[#d6b17d]/24" />
                <div className="absolute inset-16 grid place-items-center rounded-full border border-[#d6b17d]/42 bg-[#211812]">
                  <Zap className="h-12 w-12 text-[#e7d3b8]" />
                </div>
              </div>
            </div>
          </div>
        </GlassPanel>
        <GlassPanel>
          <p className="tech-font text-lg font-semibold text-white">System Status</p>
          <div className="mt-5 space-y-3">
            {[
              ["Telegram bot", "Webhook endpoint ready", "green", Bot],
              ["AI pipeline", "Async jobs enabled", "blue", CircuitBoard],
              ["PDF export", "A1 floor packages", "yellow", FileCheck2],
              ["Project chat", "Context-aware Grok Q&A", "blue", MessageSquare]
            ].map(([title, subtitle, tone, Icon]) => (
              <div key={title as string} className="flex items-center gap-3 rounded border border-cyan-300/14 bg-white/[0.03] p-3">
                <StatusPulse tone={tone as "green" | "blue" | "yellow"} />
                <Icon className="h-4 w-4 text-cyan-100/70" />
                <div>
                  <p className="text-sm font-semibold text-white">{title as string}</p>
                  <p className="mono-font text-xs text-cyan-100/50">{subtitle as string}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <GlassPanel>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="tech-font text-lg font-semibold text-white">Active Projects</p>
              <p className="mono-font text-xs text-cyan-100/55">Live Supabase-backed project queue</p>
            </div>
            <Link href="/project/new">
              <NeonButton variant="ghost">
                <FolderPlus className="h-4 w-4" />
                Create
              </NeonButton>
            </Link>
          </div>
          <div className="mt-5 grid gap-3">
            {projects.map((project) => {
              const total = project.total_floors ?? 0;
              const current = total ? Math.min(total, project.current_floor + 1) : 0;
              return (
                <Link key={project.id} href={`/project/${project.id}`} className="rounded-lg border border-cyan-300/14 bg-white/[0.03] p-4 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.06]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusPulse tone={projectTone(project.status)} />
                        <h2 className="truncate text-xl font-semibold text-white">{project.project_name}</h2>
                      </div>
                      <p className="mono-font mt-1 text-xs text-cyan-100/55">
                        {project.architect_name} · @{project.architect_telegram_username}
                      </p>
                    </div>
                    <span className="rounded border border-cyan-300/20 px-2 py-1 text-xs text-cyan-50/70">{PROJECT_STATUS_LABELS[project.status]}</span>
                  </div>
                  <div className="mt-4 h-2 rounded bg-white/8">
                    <div className="h-full rounded bg-[#b89162] shadow-[0_8px_18px_rgba(0,0,0,0.2)]" style={{ width: total ? `${(current / total) * 100}%` : "10%" }} />
                  </div>
                  <p className="mono-font mt-2 text-xs text-cyan-100/50">
                    Floor {current}/{total || "?"} · Updated {formatDateTime(project.updated_at)}
                  </p>
                </Link>
              );
            })}
          </div>
        </GlassPanel>

        <GlassPanel>
          <p className="tech-font text-lg font-semibold text-white">Recent Activity</p>
          <div className="mt-5 space-y-4">
            {projects.slice(0, 5).map((project) => (
              <div key={project.id} className="border-l border-cyan-300/30 pl-4">
                <p className="text-sm font-semibold text-white">{project.project_name}</p>
                <p className="mono-font mt-1 text-xs text-cyan-100/55">{PROJECT_STATUS_LABELS[project.status]} · {formatDateTime(project.updated_at)}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}
