import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { DesignViewer } from "@/components/ui/DesignViewer";
import { FloorTimeline } from "@/components/ui/FloorTimeline";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NeonButton } from "@/components/ui/NeonButton";
import { ProjectActions } from "@/components/ui/ProjectActions";
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
      <GlassPanel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href={`/project/${id}`} className="mono-font inline-flex items-center gap-2 text-sm text-cyan-100/62 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              Back to project
            </Link>
            <h1 className="tech-font mt-3 text-4xl font-semibold text-white">{bundle.floor.floor_name}</h1>
            <p className="mt-2 text-cyan-50/62">
              {bundle.project.project_name} · Version {currentDesign?.version ?? "pending"} · Updated {formatDateTime(bundle.floor.updated_at)}
            </p>
          </div>
          <Link href={`/project/${id}/chat`}>
            <NeonButton variant="ghost">
              <MessageSquare className="h-4 w-4" />
              Ask AI
            </NeonButton>
          </Link>
        </div>
      </GlassPanel>

      <FloorTimeline projectId={id} floors={bundle.floors} selectedFloorId={bundle.floor.id} />

      <div className="grid gap-5 2xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <DesignViewer design={currentDesign} />
          {previousDesign ? (
            <GlassPanel>
              <p className="tech-font text-lg font-semibold text-white">Previous Version</p>
              <p className="mono-font mt-1 text-xs text-cyan-100/50">Version {previousDesign.version} retained for revision comparison.</p>
              <div className="mt-4">
                <DesignViewer design={previousDesign} />
              </div>
            </GlassPanel>
          ) : null}
        </div>
        <div className="space-y-5">
          <ProjectActions projectId={id} floor={bundle.floor} design={currentDesign} />
          <GlassPanel>
            <p className="tech-font text-sm font-semibold text-white">Clarifying Questions</p>
            <div className="mt-3 space-y-2">
              {(bundle.floor.ai_questions ?? []).map((question, index) => (
                <p key={`${question}-${index}`} className="rounded border border-cyan-300/12 bg-white/[0.03] p-3 text-sm text-cyan-50/70">
                  {index + 1}. {question}
                </p>
              ))}
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
