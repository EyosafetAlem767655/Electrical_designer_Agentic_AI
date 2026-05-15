import Link from "next/link";
import { ArrowUpRight, Bot, CheckCircle2, ClipboardList, FileCheck2, FolderPlus, MessageSquare, TimerReset, type LucideIcon } from "lucide-react";
import { NeonButton } from "@/components/ui/NeonButton";
import { StatusPulse } from "@/components/ui/StatusPulse";
import { StudioSticker } from "@/components/ui/StudioSticker";
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
  const featured = projects[0];
  const active = projects.filter((project) => project.status !== "completed").length;
  const inReview = projects.filter((project) => project.status === "in_progress").length;
  const completed = projects.filter((project) => project.status === "completed").length;
  const metrics: Array<{ label: string; value: string | number; icon: LucideIcon; note: string }> = [
    { label: "Open", value: active, icon: ClipboardList, note: "projects in motion" },
    { label: "Designing", value: inReview, icon: TimerReset, note: "active floor cycles" },
    { label: "Issued", value: completed, icon: CheckCircle2, note: "completed packages" }
  ];
  const queue: Array<{ title: string; copy: string; icon: LucideIcon }> = [
    { title: "Architect intake", copy: "Verification, floor order, and first PDF handoff.", icon: MessageSquare },
    { title: "AI drafting", copy: "Plan analysis, clarifications, drawing generation.", icon: Bot },
    { title: "Engineer issue", copy: "Review, revise, approve, and export package.", icon: FileCheck2 }
  ];

  return (
    <div className="space-y-10">
      <section className="grid min-h-[520px] gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="studio-surface studio-organic relative overflow-hidden p-8 sm:p-10">
          <StudioSticker kind="drafting" className="absolute -right-4 bottom-4 hidden opacity-95 lg:block" />
          <div className="relative max-w-3xl">
            <p className="studio-eyebrow">Elec Nova Tech AI</p>
            <h1 className="studio-title mt-5">Electrical design, composed like a studio workflow.</h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#1f2a33]/62">
              A calmer workspace for architectural intake, AI-assisted electrical drafting, engineering review, and drawing issue. The interface now emphasizes the work, not the machinery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/project/new">
                <NeonButton>
                  <FolderPlus className="h-4 w-4" />
                  Start assignment
                </NeonButton>
              </Link>
              {featured ? (
                <Link href={`/project/${featured.id}`}>
                  <NeonButton variant="ghost">
                    Continue latest
                    <ArrowUpRight className="h-4 w-4" />
                  </NeonButton>
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="studio-surface rounded-[18px_34px_14px_30px] p-6">
            <p className="studio-eyebrow">Studio Signals</p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {metrics.map(({ label, value, icon: Icon, note }) => (
                <div key={label} className="rounded-[20px_8px_18px_12px] bg-white/60 p-4">
                  <Icon className="h-5 w-5 text-[#2f8178]" />
                  <p className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#1f2a33]">{value}</p>
                  <p className="mt-1 text-sm font-semibold text-[#1f2a33]">{label}</p>
                  <p className="mt-1 text-xs text-[#1f2a33]/48">{note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="studio-surface rounded-[32px_12px_26px_16px] p-6">
            <StudioSticker kind="handoff" className="float-right -mr-2 -mt-2 w-28 opacity-90" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="studio-eyebrow">Current Brief</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#1f2a33]">{featured?.project_name ?? "No active project"}</h2>
              </div>
              {featured ? <StatusPulse tone={projectTone(featured.status)} /> : null}
            </div>
            {featured ? (
              <div className="mt-6 space-y-4">
                <div className="h-2 overflow-hidden rounded-full bg-[#1f2a33]/8">
                  <div
                    className="h-full rounded-full bg-[#2f8178]"
                    style={{ width: featured.total_floors ? `${(Math.min(featured.total_floors, featured.current_floor + 1) / featured.total_floors) * 100}%` : "12%" }}
                  />
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm text-[#1f2a33]/56">{featured.architect_name}</p>
                    <p className="text-xs text-[#1f2a33]/44">{PROJECT_STATUS_LABELS[featured.status]} - {formatDateTime(featured.updated_at)}</p>
                  </div>
                  <Link href={`/project/${featured.id}`} className="text-sm font-semibold text-[#2f8178] hover:text-[#156a63]">
                    Review
                  </Link>
                </div>
              </div>
            ) : (
              <p className="mt-6 text-sm leading-6 text-[#1f2a33]/56">Create the first assignment to open the studio board.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="studio-eyebrow">Project Wall</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#1f2a33]">Assignments</h2>
            </div>
            <Link href="/project/new">
              <NeonButton variant="ghost">
                <FolderPlus className="h-4 w-4" />
                Add
              </NeonButton>
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((project, index) => {
              const total = project.total_floors ?? 0;
              const current = total ? Math.min(total, project.current_floor + 1) : 0;
              return (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="studio-surface group overflow-hidden p-5 transition hover:-translate-y-1 hover:shadow-[0_26px_70px_rgba(31,42,51,0.12)]"
                  style={{ borderRadius: index % 2 === 0 ? "30px 12px 24px 14px" : "14px 30px 16px 26px" }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1f2a33]/42">{project.building_purpose ?? "Design brief"}</p>
                      <h3 className="mt-3 truncate text-2xl font-semibold tracking-[-0.03em] text-[#1f2a33]">{project.project_name}</h3>
                    </div>
                    <StatusPulse tone={projectTone(project.status)} />
                  </div>
                  <div className="mt-7 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-sm text-[#1f2a33]/58">{project.architect_name}</p>
                      <p className="text-xs text-[#1f2a33]/42">@{project.architect_telegram_username}</p>
                    </div>
                    <span className="studio-pill px-3 py-1 text-xs text-[#1f2a33]/64">{PROJECT_STATUS_LABELS[project.status]}</span>
                  </div>
                  <div className="mt-5 h-1.5 rounded-full bg-[#1f2a33]/8">
                    <div className="h-full rounded-full bg-[#6d5a87]" style={{ width: total ? `${(current / total) * 100}%` : "10%" }} />
                  </div>
                  <p className="mt-3 text-xs text-[#1f2a33]/44">
                    Floor {current}/{total || "?"} - {formatDateTime(project.updated_at)}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="studio-surface rounded-[34px_12px_28px_18px] p-6">
            <StudioSticker kind="package" className="float-right -mr-3 -mt-4 w-28 opacity-85" />
            <p className="studio-eyebrow">Workflow</p>
            <div className="mt-5 space-y-4">
              {queue.map(({ title, copy, icon: Icon }, index) => (
                <div key={title} className="flex gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2f8178]/10 text-sm font-semibold text-[#2f8178]">{index + 1}</div>
                  <div className="min-w-0 border-b border-[#1f2a33]/8 pb-4">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-[#6d5a87]" />
                      <p className="font-semibold text-[#1f2a33]">{title}</p>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[#1f2a33]/56">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="studio-surface rounded-[16px_34px_14px_28px] p-6">
            <p className="studio-eyebrow">Recent Movement</p>
            <div className="mt-5 space-y-4">
              {projects.slice(0, 5).map((project) => (
                <div key={project.id} className="border-l-2 border-[#d66f61]/40 pl-4">
                  <p className="text-sm font-semibold text-[#1f2a33]">{project.project_name}</p>
                  <p className="mt-1 text-xs text-[#1f2a33]/48">
                    {PROJECT_STATUS_LABELS[project.status]} - {formatDateTime(project.updated_at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
