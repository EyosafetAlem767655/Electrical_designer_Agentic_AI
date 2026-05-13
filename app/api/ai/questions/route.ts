import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { generateQuestions } from "@/lib/xai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  analysis: z.record(z.string(), z.unknown()),
  context: z.record(z.string(), z.unknown()).default({})
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (!getEnv("XAI_API_KEY")) {
      return NextResponse.json({ ok: true, questions: ["Please confirm room purposes, special equipment, lighting preferences, and outlet requirements."] });
    }
    const questions = await generateQuestions(input.analysis, input.context);
    return NextResponse.json({ ok: true, questions });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Question generation failed" }, { status: 400 });
  }
}
