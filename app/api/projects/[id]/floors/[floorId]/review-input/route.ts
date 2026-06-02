import { NextResponse } from "next/server";
import { proxyToBackend } from "@/lib/backend";
import { reviewInputSchema } from "@/lib/design-markings";
import { createJob, triggerJobProcessing } from "@/lib/jobs";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string; floorId: string }> }) {
  try {
    const { id: projectId, floorId } = await context.params;
    const input = reviewInputSchema.parse(await request.json());
    const backend = await proxyToBackend(`/projects/${projectId}/floors/${floorId}/review-input`, {
      method: "POST",
      body: JSON.stringify(input)
    });
    if (backend) {
      return NextResponse.json(backend.body, { status: backend.response.status });
    }

    const supabase = getSupabaseAdmin();
    const { data: floor, error: floorError } = await supabase.from("floors").select("*").eq("project_id", projectId).eq("id", floorId).single();
    if (floorError) throw floorError;
    const previous = floor.design_markings && typeof floor.design_markings === "object" ? floor.design_markings : {};
    const designMarkings = { ...previous, confirmed: input.markings };
    const status = input.queueGeneration ? "designing" : "marking_review";
    const { error } = await supabase
      .from("floors")
      .update({ design_markings: designMarkings, review_answers: input.answers, status })
      .eq("project_id", projectId)
      .eq("id", floorId);
    if (error) throw error;
    await supabase.from("conversations").insert({
      project_id: projectId,
      floor_id: floorId,
      sender: "admin",
      message: "Engineering review confirmed floor markings and clarification answers."
    });
    if (input.queueGeneration) {
      await createJob("generate_design", { projectId, floorId });
      await triggerJobProcessing();
    }
    return NextResponse.json({ ok: true, status, markings: designMarkings });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Review input failed" }, { status: 400 });
  }
}
