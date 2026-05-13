import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ChatInterface } from "@/components/ui/ChatInterface";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { getProjectBundle } from "@/lib/data";

export default async function ProjectChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getProjectBundle(id);
  if (!bundle) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <GlassPanel>
        <Link href={`/project/${id}`} className="mono-font inline-flex items-center gap-2 text-sm text-cyan-100/62 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
        <h1 className="tech-font mt-3 text-4xl font-semibold text-white">Design Intelligence Chat</h1>
        <p className="mt-2 text-cyan-50/64">
          Ask about {bundle.project.project_name}, including floor plans, design versions, circuit strategy, emergency systems, and architect conversation history.
        </p>
      </GlassPanel>
      <ChatInterface projectId={id} />
    </div>
  );
}
