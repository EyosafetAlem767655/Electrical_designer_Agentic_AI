import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, triggerJobProcessing } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  projectId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const job = await createJob("pdf_compile", input);
    void triggerJobProcessing();
    return NextResponse.json({ ok: true, job, note: "Full package compilation job queued." }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PDF compilation enqueue failed" }, { status: 400 });
  }
}
