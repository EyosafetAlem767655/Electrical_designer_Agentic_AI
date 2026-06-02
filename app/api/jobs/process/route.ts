import { after, NextResponse } from "next/server";
import { proxyToBackend } from "@/lib/backend";
import { getEnv } from "@/lib/env";
import { processJobs } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const url = new URL(request.url);
  const proxied = await proxyToBackend(`/jobs/process${url.search}`, {
    method: "POST",
    headers: {
      ...(request.headers.get("x-job-secret") ? { "x-job-secret": request.headers.get("x-job-secret") as string } : {}),
      ...(request.headers.get("x-job-mode") ? { "x-job-mode": request.headers.get("x-job-mode") as string } : {})
    }
  });
  if (proxied) return NextResponse.json(proxied.body, { status: proxied.response.status });

  const background = url.searchParams.get("mode") === "background" || request.headers.get("x-job-mode") === "background";
  if (background) {
    after(async () => {
      try {
        await processJobs({ maxMs: 280_000 });
      } catch (error) {
        console.error("Background job processing failed", error);
      }
    });
    return NextResponse.json({ ok: true, accepted: true });
  }

  try {
    const result = await processJobs({ maxMs: 280_000 });
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
