import { NextResponse } from "next/server";
import { z } from "zod";
import { makeProjectCode } from "@/lib/constants";
import { getProjects } from "@/lib/data";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase";
import { sendProjectInvite } from "@/lib/telegram";
import { normalizeTelegramUsername } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createProjectSchema = z.object({
  projectName: z.string().min(2),
  architectName: z.string().min(2),
  architectTelegramUsername: z.string().min(2),
  companyName: z.string().optional(),
  buildingPurpose: z.string().optional(),
  groupChatId: z.union([z.string(), z.number()]).optional().nullable(),
  buildingAddress: z.string().optional(),
  notes: z.string().optional()
});

export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json({ ok: true, projects });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to list projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseServerEnv()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are required to create projects." }, { status: 503 });
    }

    const input = createProjectSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const groupChatId = input.groupChatId ? Number(input.groupChatId) : null;
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        project_name: input.projectName,
        project_code: makeProjectCode(input.projectName),
        architect_name: input.architectName,
        architect_telegram_username: normalizeTelegramUsername(input.architectTelegramUsername),
        company_name: input.companyName || null,
        building_purpose: input.buildingPurpose || null,
        building_address: input.buildingAddress || null,
        notes: input.notes || null,
        group_chat_id: Number.isFinite(groupChatId) ? groupChatId : null,
        status: groupChatId ? "awaiting_verification" : "created"
      })
      .select("*")
      .single();
    if (error) throw error;

    if (groupChatId) {
      await sendProjectInvite(groupChatId, input.architectTelegramUsername);
    }

    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to create project" }, { status: 400 });
  }
}
