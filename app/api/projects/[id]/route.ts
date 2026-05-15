import { NextResponse } from "next/server";
import { getProjectBundle } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const bundle = await getProjectBundle(id);
  if (!bundle) return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...bundle });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project deletion failed" }, { status: 400 });
  }
}
