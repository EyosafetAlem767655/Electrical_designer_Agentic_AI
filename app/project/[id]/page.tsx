import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, MessageSquare, Sparkles } from "lucide-react";
import { DesignViewer } from "@/components/ui/DesignViewer";
import { FloorTimeline } from "@/components/ui/FloorTimeline";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NeonButton } from "@/components/ui/NeonButton";
import { ProjectActions } from "@/components/ui/ProjectActions";
import { PROJECT_STATUS_LABELS } from "@/lib/constants";
import { getProjectBundle } from "@/lib/data";
import { formatDateTime } from "@/lib/utils";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getProjectBundle(id);
  if (!bundle) notFound();

  const selectedFloor = bundle.floors.find((floor) => floor.floor_number === bundle.project.current_floor) ?? bundle.floors[0] ?? null;
  const selectedDesign = selectedFloor ? bundle.designs.find((design) => design.floor_id === selectedFloor.id) ?? null : null;
  const floorConversations = selectedFloor ? bundle.conversations.filter((item) => item.floor_id === selectedFloor.id || !item.floor_id) : bundle.conversations;

  return (
    <div className="space-y-5">
      <GlassPanel>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="mono-font text-sm uppercase text-cyan-100/60">Project Detail</p>
            <h1 className="tech-font mt-2 text-4xl font-semibold text-white">{bundle.project.project_name}</h1>
            <p className="mt-2 text-cyan-50/66">
              {bundle.project.architect_name} · @{bundle.project.architect_telegram_username} · {bundle.project.building_purpose ?? "Purpose pending"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/project/${id}/chat`}>
              <NeonButton variant="ghost">
                <MessageSquare className="h-4 w-4" />
                Project Chat
              </NeonButton>
            </Link>
            {selectedFloor ? (
              <Link href={`/project/${id}/floor/${selectedFloor.id}`}>
                <NeonButton>
                  <Sparkles className="h-4 w-4" />
                  Full Viewer
                </NeonButton>
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            ["Status", PROJECT_STATUS_LABELS[bundle.project.status]],
            ["Floors", `${bundle.project.current_floor + 1}/${bundle.project.total_floors ?? "?"}`],
            ["Company", bundle.project.company_name ?? "Not set"],
            ["Updated", formatDateTime(bundle.project.updated_at)]
          ].map(([label, value]) => (
            <div key={label} className="rounded border border-cyan-300/14 bg-white/[0.03] p-3">
              <p className="mono-font text-xs text-cyan-100/46">{label}</p>
              <p className="mt-1 truncate text-base font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="tech-font text-lg font-semibold text-white">Floor Timeline</p>
            <p className="mono-font text-xs text-cyan-100/52">Bottom-to-top workflow</p>
          </div>
        </div>
        <FloorTimeline projectId={id} floors={bundle.floors} selectedFloorId={selectedFloor?.id} />
      </GlassPanel>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <DesignViewer design={selectedDesign} />
          <GlassPanel>
            <p className="tech-font text-lg font-semibold text-white">AI Analysis Summary</p>
            <pre className="mono-font scrollbar-thin mt-4 max-h-72 overflow-auto rounded border border-cyan-300/14 bg-black/24 p-4 text-xs leading-5 text-cyan-50/72">
              {JSON.stringify(selectedFloor?.ai_analysis ?? {}, null, 2)}
            </pre>
          </GlassPanel>
        </div>
        <div className="space-y-5">
          <ProjectActions projectId={id} floor={selectedFloor} design={selectedDesign} />
          <GlassPanel>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-100/70" />
              <p className="tech-font text-sm font-semibold text-white">Conversation Log</p>
            </div>
            <div className="scrollbar-thin mt-4 max-h-[520px] space-y-3 overflow-auto pr-1">
              {floorConversations.map((item) => (
                <div key={item.id} className="rounded border border-cyan-300/12 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold capitalize text-white">{item.sender}</p>
                    <p className="mono-font text-[11px] text-cyan-100/42">{formatDateTime(item.created_at)}</p>
                  </div>
                  <p className="mt-2 text-sm text-cyan-50/66">{item.message}</p>
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
