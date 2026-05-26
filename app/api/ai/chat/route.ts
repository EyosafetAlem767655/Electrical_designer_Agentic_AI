import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjectBundle } from "@/lib/data";
import { getEnv } from "@/lib/env";
import { chatWithProjectContext } from "@/lib/xai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  projectId: z.string(),
  question: z.string().min(2)
});

function hasOpenAiKey() {
  return Boolean(getEnv("OPENAI_API_KEY") ?? getEnv("OPEN_AI_KEY"));
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const bundle = await getProjectBundle(input.projectId);
    if (!bundle) return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });

    if (!hasOpenAiKey()) {
      return NextResponse.json({
        ok: true,
        answer: `OpenAI is not configured locally. Project ${bundle.project.project_name} has ${bundle.floors.length} floor records and ${bundle.designs.length} design records available for chat once OPENAI_API_KEY is set.`
      });
    }

    const answer = await chatWithProjectContext(input.question, bundle);
    return NextResponse.json({ ok: true, answer });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AI chat failed" }, { status: 400 });
  }
}
