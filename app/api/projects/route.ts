import { NextResponse } from "next/server";
import { z } from "zod";
import { makeProjectCode } from "@/lib/constants";
import { getProjects } from "@/lib/data";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase";
import { sendProjectInvite } from "@/lib/telegram";
import { normalizeTelegramUsername, parseTelegramGroupInput } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createProjectSchema = z.object({
  projectName: z.string().min(2),
  architectName: z.string().min(2),
  architectTelegramUsername: z.string().min(2),
  companyName: z.string().optional(),
  buildingPurpose: z.string().optional(),
  groupChatId: z.union([z.string(), z.number()]).optional().nullable(),
  telegramGroupInviteLink: z.string().optional().nullable(),
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
    const parsedGroup = parseTelegramGroupInput(input.groupChatId);
    const telegramInviteLink = input.telegramGroupInviteLink?.trim() || parsedGroup.inviteLink;
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
        group_chat_id: parsedGroup.chatId,
        telegram_group_invite_link: telegramInviteLink || null,
        telegram_outreach_status: parsedGroup.chatId ? "pending" : "awaiting_bind",
        status: parsedGroup.chatId ? "awaiting_verification" : "created"
      })
      .select("*")
      .single();
    if (error) throw error;

    let warning: string | null = null;
    if (parsedGroup.chatId) {
      try {
        await sendProjectInvite(parsedGroup.chatId, input.architectTelegramUsername);
        await supabase.from("projects").update({ telegram_outreach_status: "invite_sent" }).eq("id", project.id);
      } catch (telegramError) {
        warning = telegramError instanceof Error ? telegramError.message : "Telegram outreach failed";
        await supabase.from("projects").update({ telegram_outreach_status: "invite_failed" }).eq("id", project.id);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        project,
        bindCommand: `/bind ${project.project_code}`,
        warning: warning ?? (!parsedGroup.chatId ? "Project created. Add the bot to the Telegram group, then send the bind command in that group." : null)
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to create project" }, { status: 400 });
  }
}
