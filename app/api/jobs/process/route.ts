import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { processJobs } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = getEnv("JOB_SECRET");
  const cronSecret = getEnv("CRON_SECRET") ?? secret;
  if (!secret && !cronSecret) return true;
  const jobHeader = request.headers.get("x-job-secret");
  const authHeader = request.headers.get("authorization");
  return Boolean((secret && jobHeader === secret) || (cronSecret && authHeader === `Bearer ${cronSecret}`));
}

async function process(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processJobs();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Job processing failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return process(request);
}

export async function POST(request: Request) {
  return process(request);
}
