import Link from "next/link";
import { ArrowUpRight, Bot, CheckCircle2, ClipboardList, FileCheck2, FolderPlus, MessageSquare, TimerReset, type LucideIcon } from "lucide-react";
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
  const active = projects.filter((project) => project.status !== "completed").length;
  const inReview = projects.filter((project) => project.status === "in_progress").length;
  const completed = projects.filter((project) => project.status === "completed").length;
  const metrics: Array<{ label: string; value: string | number; icon: LucideIcon; note: string }> = [
    { label: "Open Projects", value: active, icon: ClipboardList, note: "Projects not yet completed" },
    { label: "In Design", value: inReview, icon: TimerReset, note: "Active floor workflows" },
    { label: "Completed", value: completed, icon: CheckCircle2, note: "Issued project packages" },
    { label: "System", value: "Ready", icon: Bot, note: "Bot, jobs, AI routes online" }
  ];
  const queue: Array<{ title: string; copy: string; icon: LucideIcon }> = [
    { title: "Architect intake", copy: "Verify DM identity and floor sequence", icon: MessageSquare },
    { title: "AI production", copy: "Analyze plan, ask questions, generate drawing", icon: Bot },
    { title: "Engineering review", copy: "Approve, revise, or export package", icon: FileCheck2 }
  ];

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-[#c6a171]/14 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c9b9a6]/54">Operations Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold text-[#fffaf0]">Electrical Design Workbench</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#efe4d4]/66">
            Track architect intake, floor submissions, AI design jobs, engineering approvals, and package exports from one task-focused view.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/project/new">
            <NeonButton>
              <FolderPlus className="h-4 w-4" />
              Create project
            </NeonButton>
          </Link>
          {projects[0] ? (
            <Link href={`/project/${projects[0].id}`}>
              <NeonButton variant="ghost">
                Open latest
                <ArrowUpRight className="h-4 w-4" />
              </NeonButton>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, note }) => (
          <GlassPanel key={label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#c9b9a6]/48">{label}</p>
                <p className="mt-3 text-3xl font-semibold text-[#fffaf0]">{value}</p>
                <p className="mt-1 text-sm text-[#efe4d4]/56">{note}</p>
              </div>
              <Icon className="h-5 w-5 text-[#d6b17d]/70" />
            </div>
          </GlassPanel>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <GlassPanel className="p-0">
          <div className="flex items-center justify-between gap-4 border-b border-[#c6a171]/14 px-5 py-4">
            <div>
              <p className="text-lg font-semibold text-[#fffaf0]">Project Register</p>
              <p className="text-sm text-[#efe4d4]/54">Prioritized by most recent activity</p>
            </div>
            <Link href="/project/new">
              <NeonButton variant="ghost" className="h-9">
                <FolderPlus className="h-4 w-4" />
                Add
              </NeonButton>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#c6a171]/12 text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/50">
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-5 py-3 font-semibold">Architect</th>
                  <th className="px-5 py-3 font-semibold">Stage</th>
                  <th className="px-5 py-3 font-semibold">Floor Progress</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                  <th className="px-5 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const total = project.total_floors ?? 0;
                  const current = total ? Math.min(total, project.current_floor + 1) : 0;
                  return (
                    <tr key={project.id} className="border-b border-[#c6a171]/10 transition hover:bg-white/[0.035]">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <StatusPulse tone={projectTone(project.status)} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#fffaf0]">{project.project_name}</p>
                            <p className="text-xs text-[#c9b9a6]/54">{project.building_purpose ?? "Purpose pending"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#efe4d4]/72">
                        <p>{project.architect_name}</p>
                        <p className="text-xs text-[#c9b9a6]/52">@{project.architect_telegram_username}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded border border-[#c6a171]/22 bg-white/[0.025] px-2 py-1 text-xs text-[#efe4d4]/76">{PROJECT_STATUS_LABELS[project.status]}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="h-1.5 w-40 rounded bg-white/8">
                          <div className="h-full rounded bg-[#b89162]" style={{ width: total ? `${(current / total) * 100}%` : "8%" }} />
                        </div>
                        <p className="mt-2 text-xs text-[#c9b9a6]/52">
                          {current}/{total || "?"} floors
                        </p>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#efe4d4]/62">{formatDateTime(project.updated_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <Link href={`/project/${project.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#d6b17d] hover:text-[#fffaf0]">
                          Review
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassPanel>

        <div className="space-y-5">
          <GlassPanel>
            <p className="text-lg font-semibold text-[#fffaf0]">Operations Queue</p>
            <div className="mt-4 space-y-3">
              {queue.map(({ title, copy, icon: Icon }, index) => (
                <div key={title} className="flex gap-3 rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded border border-[#d6b17d]/24 bg-[#6d4c34]/14 text-sm text-[#d6b17d]">{index + 1}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-[#d6b17d]/72" />
                      <p className="font-semibold text-[#fffaf0]">{title}</p>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[#efe4d4]/58">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel>
            <p className="text-lg font-semibold text-[#fffaf0]">Recent Activity</p>
            <div className="mt-4 space-y-4">
              {projects.slice(0, 5).map((project) => (
                <div key={project.id} className="border-l border-[#c6a171]/28 pl-4">
                  <p className="text-sm font-semibold text-[#fffaf0]">{project.project_name}</p>
                  <p className="mt-1 text-xs text-[#c9b9a6]/56">
                    {PROJECT_STATUS_LABELS[project.status]} - {formatDateTime(project.updated_at)}
                  </p>
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      </section>
    </div>
  );
}
