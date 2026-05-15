import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Bot, Building2, FileText, Link2, MessageSquare, MoveUpRight, Send, Sparkles } from "lucide-react";
import { DesignViewer } from "@/components/ui/DesignViewer";
import { FloorTimeline } from "@/components/ui/FloorTimeline";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NeonButton } from "@/components/ui/NeonButton";
import { ProjectActions } from "@/components/ui/ProjectActions";
import { FLOOR_STATUS_LABELS, PROJECT_STATUS_LABELS } from "@/lib/constants";
import { getProjectBundle } from "@/lib/data";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/utils";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getProjectBundle(id);
  if (!bundle) notFound();

  const selectedFloor = bundle.floors.find((floor) => floor.floor_number === bundle.project.current_floor) ?? bundle.floors[0] ?? null;
  const selectedDesign = selectedFloor ? bundle.designs.find((design) => design.floor_id === selectedFloor.id) ?? null : null;
  const floorConversations = selectedFloor ? bundle.conversations.filter((item) => item.floor_id === selectedFloor.id || !item.floor_id) : bundle.conversations;
  const approved = bundle.floors.filter((floor) => floor.status === "approved").length;
  const botUsername = getEnv("TELEGRAM_BOT_USERNAME") ?? "awolaibot";
  const botStartLink = `https://t.me/${botUsername}?start=${encodeURIComponent(bundle.project.project_code ?? bundle.project.id)}`;
  const failedJobs = bundle.jobs.filter((job) => job.status === "failed");
  const activeJobs = bundle.jobs.filter((job) => job.status === "pending" || job.status === "processing");

  return (
    <div className="space-y-5">
      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <GlassPanel className="p-0">
          <div className="border-b border-[#c6a171]/14 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c9b9a6]/54">Project Dossier</p>
                <h1 className="mt-2 text-3xl font-semibold text-[#fffaf0]">{bundle.project.project_name}</h1>
                <p className="mt-2 text-sm text-[#efe4d4]/64">
                  {bundle.project.architect_name} - {bundle.project.company_name ?? "Company pending"} - {bundle.project.building_purpose ?? "Purpose pending"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/project/${id}/chat`}>
                  <NeonButton variant="ghost">
                    <MessageSquare className="h-4 w-4" />
                    Ask AI
                  </NeonButton>
                </Link>
                {selectedFloor ? (
                  <Link href={`/project/${id}/floor/${selectedFloor.id}`}>
                    <NeonButton>
                      <Sparkles className="h-4 w-4" />
                      Open Floor Review
                    </NeonButton>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
          <div className="grid gap-px bg-[#c6a171]/10 md:grid-cols-4">
            {[
              ["Project Status", PROJECT_STATUS_LABELS[bundle.project.status], Building2],
              ["Approved Floors", `${approved}/${bundle.floors.length || "?"}`, FileText],
              ["Current Floor", selectedFloor?.floor_name ?? "Not started", MoveUpRight],
              ["Last Update", formatDateTime(bundle.project.updated_at), Bot]
            ].map(([label, value, Icon]) => (
              <div key={label as string} className="bg-[#211812]/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#c9b9a6]/46">{label as string}</p>
                  <Icon className="h-4 w-4 text-[#d6b17d]/62" />
                </div>
                <p className="mt-2 truncate text-base font-semibold text-[#fffaf0]">{value as string}</p>
              </div>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel>
          <p className="text-lg font-semibold text-[#fffaf0]">Current Review</p>
          <div className="mt-4 rounded border border-[#c6a171]/16 bg-white/[0.025] p-4">
            <p className="text-sm text-[#c9b9a6]/58">Floor</p>
            <p className="mt-1 text-xl font-semibold text-[#fffaf0]">{selectedFloor?.floor_name ?? "No floor selected"}</p>
            <p className="mt-2 text-sm text-[#efe4d4]/62">{selectedFloor ? FLOOR_STATUS_LABELS[selectedFloor.status] : "Pending setup"}</p>
          </div>
          <div className="mt-4">
            <ProjectActions projectId={id} floor={selectedFloor} design={selectedDesign} />
          </div>
        </GlassPanel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <GlassPanel>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#d6b17d]/24 bg-[#d6b17d]/10">
              <Link2 className="h-5 w-5 text-[#d6b17d]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#fffaf0]">Architect Bot Start</p>
              <p className="mt-1 text-sm text-[#efe4d4]/62">Send this link to {bundle.project.architect_name}. The bot will verify full name and project name before continuing.</p>
              <div className="mt-3 rounded border border-[#c6a171]/16 bg-white/[0.025] p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/48">Bot start link</p>
                <code className="mt-2 block select-all break-all text-sm font-semibold text-[#fffaf0]">{botStartLink}</code>
                <a href={botStartLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#d6b17d] hover:text-[#fffaf0]">
                  <Send className="h-4 w-4" />
                  Open bot link
                </a>
              </div>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#8fa37c]/24 bg-[#8fa37c]/10">
              <Bot className="h-5 w-5 text-[#dfe8d7]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#fffaf0]">Automation Queue</p>
              <p className="mt-1 text-sm text-[#efe4d4]/62">{activeJobs.length} active job{activeJobs.length === 1 ? "" : "s"} - {failedJobs.length} failed</p>
              {failedJobs[0] ? (
                <p className="mt-3 rounded border border-rose-300/24 bg-rose-500/10 p-3 text-sm leading-5 text-rose-100">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {failedJobs[0].type}: {failedJobs[0].error ?? "Unknown failure"}
                </p>
              ) : (
                <p className="mt-3 text-xs text-[#c9b9a6]/52">Cron and enqueue triggers process PDF, AI, revision, and package jobs automatically.</p>
              )}
            </div>
          </div>
        </GlassPanel>
      </section>

      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-[#fffaf0]">Floor Workflow</p>
            <p className="text-sm text-[#efe4d4]/54">Lowest level through rooftop, with current review highlighted.</p>
          </div>
        </div>
        <FloorTimeline projectId={id} floors={bundle.floors} selectedFloorId={selectedFloor?.id} />
      </GlassPanel>

      <section className="grid gap-5 2xl:grid-cols-[1fr_390px]">
        <div className="space-y-5">
          <DesignViewer design={selectedDesign} />
          <GlassPanel className="p-0">
            <div className="border-b border-[#c6a171]/14 px-5 py-4">
              <p className="text-lg font-semibold text-[#fffaf0]">AI Analysis Evidence</p>
              <p className="text-sm text-[#efe4d4]/54">Structured data used to generate the current drawing.</p>
            </div>
            <pre className="scrollbar-thin max-h-72 overflow-auto p-5 text-xs leading-5 text-[#efe4d4]/68">
              {JSON.stringify(selectedFloor?.ai_analysis ?? {}, null, 2)}
            </pre>
          </GlassPanel>
        </div>

        <GlassPanel className="p-0">
          <div className="flex items-center gap-2 border-b border-[#c6a171]/14 px-5 py-4">
            <Bot className="h-4 w-4 text-[#d6b17d]/70" />
            <div>
              <p className="text-sm font-semibold text-[#fffaf0]">Architect Conversation</p>
              <p className="text-xs text-[#c9b9a6]/54">Messages related to current floor intake and review.</p>
            </div>
          </div>
          <div className="scrollbar-thin max-h-[760px] space-y-3 overflow-auto p-4">
            {floorConversations.map((item) => (
              <div key={item.id} className="rounded border border-[#c6a171]/12 bg-white/[0.025] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold capitalize text-[#fffaf0]">{item.sender}</p>
                  <p className="text-[11px] text-[#c9b9a6]/46">{formatDateTime(item.created_at)}</p>
                </div>
                <p className="mt-2 text-sm leading-5 text-[#efe4d4]/66">{item.message}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}
