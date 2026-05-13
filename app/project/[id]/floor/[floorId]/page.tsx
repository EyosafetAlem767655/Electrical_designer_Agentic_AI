import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FileClock, MessageSquare } from "lucide-react";
import { DesignViewer } from "@/components/ui/DesignViewer";
import { FloorTimeline } from "@/components/ui/FloorTimeline";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NeonButton } from "@/components/ui/NeonButton";
import { ProjectActions } from "@/components/ui/ProjectActions";
import { FLOOR_STATUS_LABELS } from "@/lib/constants";
import { getFloorBundle } from "@/lib/data";
import { formatDateTime } from "@/lib/utils";

export default async function FloorDesignPage({ params }: { params: Promise<{ id: string; floorId: string }> }) {
  const { id, floorId } = await params;
  const bundle = await getFloorBundle(id, floorId);
  if (!bundle) notFound();
  const currentDesign = bundle.designs[0] ?? null;
  const previousDesign = bundle.designs[1] ?? null;

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4 border-b border-[#c6a171]/14 pb-5">
        <div>
          <Link href={`/project/${id}`} className="inline-flex items-center gap-2 text-sm font-medium text-[#c9b9a6]/68 hover:text-[#fffaf0]">
            <ArrowLeft className="h-4 w-4" />
            Back to project dossier
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-[#fffaf0]">{bundle.floor.floor_name}</h1>
          <p className="mt-2 text-sm text-[#efe4d4]/62">
            {bundle.project.project_name} - Version {currentDesign?.version ?? "pending"} - Updated {formatDateTime(bundle.floor.updated_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/project/${id}/chat`}>
            <NeonButton variant="ghost">
              <MessageSquare className="h-4 w-4" />
              Ask AI
            </NeonButton>
          </Link>
        </div>
      </section>

      <GlassPanel className="p-4">
        <FloorTimeline projectId={id} floors={bundle.floors} selectedFloorId={bundle.floor.id} />
      </GlassPanel>

      <section className="grid gap-5 2xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <DesignViewer design={currentDesign} />
          {previousDesign ? (
            <GlassPanel className="p-0">
              <div className="flex items-center gap-2 border-b border-[#c6a171]/14 px-5 py-4">
                <FileClock className="h-4 w-4 text-[#d6b17d]/70" />
                <div>
                  <p className="text-lg font-semibold text-[#fffaf0]">Previous Design Version</p>
                  <p className="text-sm text-[#efe4d4]/54">Version {previousDesign.version} retained for comparison before issuing revisions.</p>
                </div>
              </div>
              <div className="p-4">
                <DesignViewer design={previousDesign} />
              </div>
            </GlassPanel>
          ) : null}
        </div>

        <aside className="space-y-5">
          <GlassPanel>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-[#d6b17d]/70" />
              <p className="text-lg font-semibold text-[#fffaf0]">Review Control</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/48">Status</p>
                <p className="mt-2 font-semibold text-[#fffaf0]">{FLOOR_STATUS_LABELS[bundle.floor.status]}</p>
              </div>
              <div className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/48">Revision</p>
                <p className="mt-2 font-semibold text-[#fffaf0]">{currentDesign?.version ?? "Pending"}</p>
              </div>
            </div>
            <div className="mt-4">
              <ProjectActions projectId={id} floor={bundle.floor} design={currentDesign} />
            </div>
          </GlassPanel>

          <GlassPanel>
            <p className="text-lg font-semibold text-[#fffaf0]">Architect Clarifications</p>
            <p className="mt-1 text-sm text-[#efe4d4]/54">Questions generated from AI floor-plan analysis.</p>
            <div className="mt-4 space-y-2">
              {(bundle.floor.ai_questions ?? []).length ? (
                bundle.floor.ai_questions.map((question, index) => (
                  <p key={`${question}-${index}`} className="rounded border border-[#c6a171]/12 bg-white/[0.025] p-3 text-sm leading-5 text-[#efe4d4]/70">
                    {index + 1}. {question}
                  </p>
                ))
              ) : (
                <p className="rounded border border-[#c6a171]/12 bg-white/[0.025] p-3 text-sm text-[#efe4d4]/56">No clarification questions recorded yet.</p>
              )}
            </div>
          </GlassPanel>
        </aside>
      </section>
    </div>
  );
}
