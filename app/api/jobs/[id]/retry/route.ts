import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { retryFailedJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secrets = [getEnv("JOB_SECRET"), getEnv("CRON_SECRET"), getEnv("TELEGRAM_SETUP_SECRET")].filter((value): value is string => Boolean(value));
  if (!secrets.length) return true;
  const jobHeader = request.headers.get("x-job-secret");
  const setupHeader = request.headers.get("x-setup-secret");
  const authHeader = request.headers.get("authorization");
  return secrets.some((secret) => jobHeader === secret || setupHeader === secret || authHeader === `Bearer ${secret}`);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const job = await retryFailedJob(id);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Job retry failed" }, { status: 500 });
  }
}
