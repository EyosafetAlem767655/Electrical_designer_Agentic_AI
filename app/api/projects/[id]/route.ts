import { NextResponse } from "next/server";
import { getProjectBundle } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const bundle = await getProjectBundle(id);
  if (!bundle) return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...bundle });
}
