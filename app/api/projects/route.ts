import { NextResponse } from "next/server";
import { z } from "zod";
import { makeProjectCode } from "@/lib/constants";
import { getProjects } from "@/lib/data";
import { getEnv } from "@/lib/env";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase";
import { sendProjectInvite } from "@/lib/telegram";
import { normalizeTelegramUsername, parseTelegramGroupInput } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createProjectSchema = z.object({
  projectName: z.string().min(2),
  architectName: z.string().min(2),
  architectTelegramUsername: z.string().optional().nullable(),
  companyName: z.string().optional(),
  buildingPurpose: z.string().optional(),
  groupChatId: z.union([z.string(), z.number()]).optional().nullable(),
  telegramGroupInviteLink: z.string().optional().nullable(),
  buildingAddress: z.string().optional(),
  notes: z.string().optional()
});

function botStartLink(projectCode?: string | null) {
  const username = getEnv("TELEGRAM_BOT_USERNAME") ?? "awolaibot";
  return `https://t.me/${username}${projectCode ? `?start=${encodeURIComponent(projectCode)}` : ""}`;
}

type ProjectInsert = {
  project_name: string;
  project_code: string;
  architect_name: string;
  architect_telegram_username: string;
  company_name: string | null;
  building_purpose: string | null;
  building_address: string | null;
  notes: string | null;
  group_chat_id: number | null;
  status: "created" | "awaiting_verification";
  telegram_group_invite_link?: string | null;
  telegram_outreach_status?: string | null;
};

async function insertProject(supabase: ReturnType<typeof getSupabaseAdmin>, row: ProjectInsert) {
  const insert = async (payload: ProjectInsert | Omit<ProjectInsert, "telegram_group_invite_link" | "telegram_outreach_status">) =>
    supabase.from("projects").insert(payload).select("*").single();

  const result = await insert(row);
  if (!result.error) return result;

  const message = `${result.error.message ?? ""} ${result.error.details ?? ""}`;
  if (!/telegram_group_invite_link|telegram_outreach_status|schema cache|column/i.test(message)) {
    return result;
  }

  const { telegram_group_invite_link: _inviteLink, telegram_outreach_status: _outreachStatus, ...legacyRow } = row;
  return insert(legacyRow);
}

async function updateOutreachStatus(supabase: ReturnType<typeof getSupabaseAdmin>, projectId: string, status: string) {
  await supabase.from("projects").update({ telegram_outreach_status: status }).eq("id", projectId);
}

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
    const architectTelegramUsername = input.architectTelegramUsername?.trim()
      ? normalizeTelegramUsername(input.architectTelegramUsername)
      : `pending-${Date.now()}`;
    const { data: project, error } = await insertProject(supabase, {
      project_name: input.projectName,
      project_code: makeProjectCode(input.projectName),
      architect_name: input.architectName,
      architect_telegram_username: architectTelegramUsername,
      company_name: input.companyName || null,
      building_purpose: input.buildingPurpose || null,
      building_address: input.buildingAddress || null,
      notes: input.notes || null,
      group_chat_id: parsedGroup.chatId,
      telegram_group_invite_link: telegramInviteLink || null,
      telegram_outreach_status: parsedGroup.chatId ? "pending" : "awaiting_bind",
      status: parsedGroup.chatId ? "awaiting_verification" : "created"
    });
    if (error) throw error;

    let warning: string | null = null;
    if (parsedGroup.chatId && architectTelegramUsername) {
      try {
        await sendProjectInvite(parsedGroup.chatId, architectTelegramUsername, input.architectName);
        await updateOutreachStatus(supabase, project.id, "invite_sent").catch(() => undefined);
      } catch (telegramError) {
        warning = telegramError instanceof Error ? telegramError.message : "Telegram outreach failed";
        await updateOutreachStatus(supabase, project.id, "invite_failed").catch(() => undefined);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        project,
        botStartLink: botStartLink(project.project_code),
        bindCommand: `/bind ${project.project_code}`,
        warning: warning ?? "Project created. Send the bot start link to the architect; the bot will verify full name and project name."
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Project creation failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to create project" }, { status: 400 });
  }
}
