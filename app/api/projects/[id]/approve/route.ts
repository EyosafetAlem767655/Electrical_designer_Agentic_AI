import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import type { Floor, Project } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  floorId: z.string().uuid()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await context.params;
    const { floorId } = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const [{ data: projectData, error: projectError }, { data: floorData, error: floorError }, { data: floorsData, error: floorsError }] =
      await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("floors").select("*").eq("id", floorId).single(),
        supabase.from("floors").select("*").eq("project_id", projectId).order("floor_number", { ascending: true })
      ]);
    if (projectError) throw projectError;
    if (floorError) throw floorError;
    if (floorsError) throw floorsError;

    const project = projectData as Project;
    const floor = floorData as Floor;
    const floors = floorsData as Floor[];
    const nextFloor = floors.find((item) => item.floor_number > floor.floor_number);

    await supabase.from("floors").update({ status: "approved" }).eq("id", floorId);
    await supabase.from("conversations").insert({ project_id: projectId, floor_id: floorId, sender: "admin", message: `Approved ${floor.floor_name}.` });

    if (nextFloor) {
      await supabase.from("projects").update({ current_floor: nextFloor.floor_number, status: "in_progress" }).eq("id", projectId);
      await supabase.from("bot_sessions").update({ state: "AWAITING_PDF", current_floor_id: nextFloor.id }).eq("project_id", projectId);
      if (project.telegram_chat_id) {
        const message = `The design for ${floor.floor_name} has been approved! Please now send the floor plan PDF for the next floor: ${nextFloor.floor_name}.`;
        await sendTelegramMessage(project.telegram_chat_id, message);
        await supabase.from("conversations").insert({ project_id: projectId, floor_id: nextFloor.id, sender: "bot", message });
      }
    } else {
      await supabase.from("projects").update({ status: "completed" }).eq("id", projectId);
      await supabase.from("bot_sessions").update({ state: "COMPLETED" }).eq("project_id", projectId);
      if (project.telegram_chat_id) {
        const message = `All floor designs are complete! The full electrical design package for ${project.project_name} is being compiled. Thank you for your collaboration!`;
        await sendTelegramMessage(project.telegram_chat_id, message);
        await supabase.from("conversations").insert({ project_id: projectId, floor_id: floorId, sender: "bot", message });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Approval failed" }, { status: 400 });
  }
}
