import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const [{ data: floor, error: floorError }, { data: designs, error: designsError }] = await Promise.all([
      supabase.from("floors").select("*").eq("id", id).single(),
      supabase.from("designs").select("*").eq("floor_id", id).order("version", { ascending: false })
    ]);
    if (floorError) throw floorError;
    if (designsError) throw designsError;
    return NextResponse.json({ ok: true, floor, designs });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Floor lookup failed" }, { status: 404 });
  }
}
