import { NextResponse } from "next/server";
import { z } from "zod";
import { createFloorPdf } from "@/lib/pdf-utils";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Design, Floor, Project } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  projectId: z.string(),
  floorId: z.string(),
  designId: z.string()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const [{ data: project, error: projectError }, { data: floor, error: floorError }, { data: design, error: designError }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", input.projectId).single(),
      supabase.from("floors").select("*").eq("id", input.floorId).single(),
      supabase.from("designs").select("*").eq("id", input.designId).single()
    ]);
    if (projectError) throw projectError;
    if (floorError) throw floorError;
    if (designError) throw designError;

    const buffer = await createFloorPdf(project as Project, floor as Floor, design as Design);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${(floor as Floor).floor_name.replace(/[^a-z0-9]+/gi, "-")}-electrical.pdf"`
      }
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PDF export failed" }, { status: 400 });
  }
}
