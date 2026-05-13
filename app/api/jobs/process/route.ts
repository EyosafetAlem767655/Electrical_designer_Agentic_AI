import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { processNextJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = getEnv("JOB_SECRET");
  if (secret && request.headers.get("x-job-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processNextJob();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Job processing failed" }, { status: 500 });
  }
}
