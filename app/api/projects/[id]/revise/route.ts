import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, triggerJobProcessing } from "@/lib/jobs";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  floorId: z.string().uuid(),
  notes: z.string().min(3)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await context.params;
    const input = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    await supabase.from("floors").update({ status: "revision_requested" }).eq("id", input.floorId);
    await supabase.from("conversations").insert({ project_id: projectId, floor_id: input.floorId, sender: "admin", message: `Revision requested: ${input.notes}` });
    const job = await createJob("revision_design", { projectId, floorId: input.floorId, improvementRequest: input.notes });
    void triggerJobProcessing();
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Revision request failed" }, { status: 400 });
  }
}
