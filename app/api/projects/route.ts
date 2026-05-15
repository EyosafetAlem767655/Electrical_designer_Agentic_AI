import { NextResponse } from "next/server";
import { z } from "zod";
import { makeProjectCode } from "@/lib/constants";
import { getProjects } from "@/lib/data";
import { getEnv, getRequestBaseUrl } from "@/lib/env";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase";
import { ensureTelegramWebhook, sendProjectInvite } from "@/lib/telegram";
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
  const insert = async (payload: Record<string, unknown>) =>
    supabase.from("projects").insert(payload).select("*").single();

  const result = await insert(row);
  if (!result.error) return result;

  const message = `${result.error.message ?? ""} ${result.error.details ?? ""}`;
  if (!/project_code|building_address|notes|telegram_group_invite_link|telegram_outreach_status|schema cache|column/i.test(message)) {
    return result;
  }

  const legacyRow: Record<string, unknown> = { ...row };
  delete legacyRow.telegram_group_invite_link;
  delete legacyRow.telegram_outreach_status;
  const retry = await insert(legacyRow);
  if (!retry.error) return retry;

  const retryMessage = `${retry.error.message ?? ""} ${retry.error.details ?? ""}`;
  if (!/project_code|building_address|notes|schema cache|column/i.test(retryMessage)) {
    return retry;
  }

  return insert({
    project_name: row.project_name,
    architect_name: row.architect_name,
    architect_telegram_username: row.architect_telegram_username,
    company_name: row.company_name,
    building_purpose: row.building_purpose,
    status: row.status
  });
}

async function updateOutreachStatus(supabase: ReturnType<typeof getSupabaseAdmin>, projectId: string, status: string) {
  await supabase.from("projects").update({ telegram_outreach_status: status }).eq("id", projectId);
}

function webhookUrl(request: Request) {
  return `${getRequestBaseUrl(request)}/api/telegram/webhook`;
}

async function ensureWebhookIfPossible(request: Request) {
  if (!getEnv("TELEGRAM_BOT_TOKEN") && !getEnv("INSTALLER_TELEGRAM_BOT_TOKEN")) {
    return { ok: false, warning: "TELEGRAM_BOT_TOKEN is missing, so the bot webhook could not be registered." };
  }
  try {
    return { ok: true, result: await ensureTelegramWebhook(webhookUrl(request), getEnv("TELEGRAM_WEBHOOK_SECRET")) };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : "Telegram webhook registration failed." };
  }
}

function errorText(error: unknown, key: "message" | "details" | "hint" | "code") {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function projectErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : errorText(error, "message") ?? String(error);
  if (/duplicate key|projects_project_name_key|unique/i.test(message)) {
    return "A project with this name already exists. Use a different project name.";
  }
  if (/row-level security|permission denied|violates row-level security/i.test(message)) {
    return "Supabase rejected the insert. Set SUPABASE_SERVICE_ROLE_KEY in Vercel or disable RLS for this prototype.";
  }
  if (/Could not find the .* column|schema cache|column/i.test(message)) {
    return `${message}. Apply the Supabase migrations or use the original schema-compatible fields.`;
  }
  return message || "Failed to create project";
}

function projectErrorDetails(error: unknown) {
  if (error instanceof Error) return undefined;
  const parts = [
    errorText(error, "details"),
    errorText(error, "hint"),
    errorText(error, "code") ? `Code: ${errorText(error, "code")}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
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
    const webhook = await ensureWebhookIfPossible(request);
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
        botStartLink: botStartLink(project.project_code ?? project.id),
        bindCommand: `/bind ${project.project_code ?? project.id}`,
        webhook,
        warning: warning ?? webhook.warning ?? "Project created. Send the bot start link to the architect; the bot will verify full name and project name."
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Project creation failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: projectErrorMessage(error),
        details: projectErrorDetails(error),
        diagnostics: {
          hasSupabaseServerEnv: hasSupabaseServerEnv(),
          hasServiceRoleKey: Boolean(getEnv("SUPABASE_SERVICE_ROLE_KEY")),
          hasAnonKey: Boolean(getEnv("SUPABASE_ANON_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
          hasTelegramBotToken: Boolean(getEnv("TELEGRAM_BOT_TOKEN") || getEnv("INSTALLER_TELEGRAM_BOT_TOKEN"))
        }
      },
      { status: 400 }
    );
  }
}
