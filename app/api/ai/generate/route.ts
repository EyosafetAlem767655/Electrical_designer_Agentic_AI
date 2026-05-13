import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  projectId: z.string().uuid(),
  floorId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const job = await createJob("generate_design", input);
    return NextResponse.json({ ok: true, job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Design generation enqueue failed" }, { status: 400 });
  }
}
