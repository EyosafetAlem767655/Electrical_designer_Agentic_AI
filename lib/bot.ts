import { createJob, triggerJobProcessing } from "@/lib/jobs";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isProjectNameMatch, parseBindCommand, parseFloorNames, parsePositiveInteger } from "@/lib/state-machine";
import { sendProjectInvite, sendTelegramMessage, type TelegramMessage, type TelegramUpdate } from "@/lib/telegram";
import { normalizeTelegramUsername } from "@/lib/utils";
import type { BotSession, Floor, Project } from "@/types";

async function logMessage(projectId: string | null, floorId: string | null, sender: "bot" | "architect", message: string, messageType = "text", telegramMessageId?: number) {
  if (!projectId) return;
  const supabase = getSupabaseAdmin();
  await supabase.from("conversations").insert({
    project_id: projectId,
    floor_id: floorId,
    sender,
    message,
    message_type: messageType,
    telegram_message_id: telegramMessageId
  });
}

async function botReply(chatId: number, projectId: string | null, floorId: string | null, text: string) {
  await sendTelegramMessage(chatId, text);
  await logMessage(projectId, floorId, "bot", text);
}

async function getOrCreateSession(message: TelegramMessage) {
  const supabase = getSupabaseAdmin();
  const user = message.from;
  if (!user) throw new Error("Telegram message has no sender");
  const username = user.username ? normalizeTelegramUsername(user.username) : null;
  const { data: existing, error } = await supabase.from("bot_sessions").select("*").eq("telegram_user_id", user.id).maybeSingle();
  if (error) throw error;
  if (existing) return existing as BotSession;

  const { data, error: insertError } = await supabase
    .from("bot_sessions")
    .insert({
      telegram_user_id: user.id,
      telegram_chat_id: message.chat.id,
      telegram_username: username,
      state: "AWAITING_VERIFICATION"
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return data as BotSession;
}

async function updateSession(sessionId: string, values: Partial<BotSession>) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("bot_sessions").update(values).eq("id", sessionId).select("*").single();
  if (error) throw error;
  return data as BotSession;
}

async function findProjectForVerification(text: string, username?: string | null) {
  const supabase = getSupabaseAdmin();
  const normalizedUsername = username ? normalizeTelegramUsername(username) : null;
  let query = supabase.from("projects").select("*").in("status", ["created", "awaiting_verification", "verified", "in_progress"]);
  if (normalizedUsername) {
    query = query.ilike("architect_telegram_username", `%${normalizedUsername}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Project[]).find((project) => isProjectNameMatch(text, project.project_name)) ?? null;
}

async function handleGroupMessage(message: TelegramMessage) {
  const text = message.text?.trim() ?? "";
  const projectCode = parseBindCommand(text);
  if (!projectCode) return { ok: true, ignored: "non-bind group message" };

  const supabase = getSupabaseAdmin();
  const { data: project, error } = await supabase.from("projects").select("*").ilike("project_code", projectCode).maybeSingle();
  if (error) throw error;
  if (!project) {
    await sendTelegramMessage(message.chat.id, "I could not find a project for that bind code. Please copy the exact /bind command from the dashboard.");
    return { ok: false, error: "project_not_found" };
  }

  await supabase
    .from("projects")
    .update({
      group_chat_id: message.chat.id,
      telegram_group_title: message.chat.title ?? null,
      telegram_group_bound_at: new Date().toISOString(),
      telegram_outreach_status: "bound",
      status: project.status === "created" ? "awaiting_verification" : project.status
    })
    .eq("id", project.id);

  await logMessage(project.id, null, "bot", `Telegram group bound: ${message.chat.title ?? message.chat.id}`, "command", message.message_id);
  try {
    await sendProjectInvite(message.chat.id, project.architect_telegram_username);
    await supabase.from("projects").update({ telegram_outreach_status: "invite_sent" }).eq("id", project.id);
  } catch (error) {
    await supabase.from("projects").update({ telegram_outreach_status: "invite_failed" }).eq("id", project.id);
    await sendTelegramMessage(message.chat.id, `Group bound for ${project.project_name}, but I could not send the architect invite: ${error instanceof Error ? error.message : "Telegram send failed"}`);
    return { ok: false, error: "invite_failed" };
  }

  await logMessage(project.id, null, "bot", `Architect invite sent in Telegram group ${message.chat.title ?? message.chat.id}.`);
  return { ok: true, bound: true, projectId: project.id };
}

async function createFloors(project: Project, names: string[]) {
  const supabase = getSupabaseAdmin();
  const rows = names.map((floor_name, floor_number) => ({ project_id: project.id, floor_name, floor_number }));
  const { data, error } = await supabase.from("floors").upsert(rows, { onConflict: "project_id,floor_number" }).select("*").order("floor_number");
  if (error) throw error;
  return data as Floor[];
}

async function currentFloor(projectId: string, currentFloorIndex: number) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("floors")
    .select("*")
    .eq("project_id", projectId)
    .eq("floor_number", currentFloorIndex)
    .single();
  if (error) throw error;
  return data as Floor;
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return { ok: true, ignored: true };
  if (message.chat.type !== "private") return handleGroupMessage(message);

  const supabase = getSupabaseAdmin();
  let session = await getOrCreateSession(message);
  const text = message.text?.trim() ?? "";
  await logMessage(session.project_id, session.current_floor_id, "architect", text || message.document?.file_name || "Attachment", message.document ? "document" : "text", message.message_id);

  if (!session.project_id || session.state === "AWAITING_VERIFICATION") {
    if (!text || text.startsWith("/start")) {
      await botReply(
        message.chat.id,
        null,
        null,
        "Welcome! I'm the Elec Nova Tech electrical design assistant. To verify your identity, please tell me the project name you're working on."
      );
      await updateSession(session.id, { state: "AWAITING_VERIFICATION" });
      return { ok: true };
    }

    const project = await findProjectForVerification(text, session.telegram_username);
    if (!project) {
      await botReply(message.chat.id, null, null, "I'm sorry, I don't have a project with that name. Please check with your project coordinator and try again.");
      return { ok: true };
    }

    await supabase
      .from("projects")
      .update({
        status: "verified",
        telegram_chat_id: message.chat.id,
        telegram_user_id: message.from.id,
        architect_telegram_username: session.telegram_username ?? project.architect_telegram_username
      })
      .eq("id", project.id);
    session = await updateSession(session.id, { project_id: project.id, state: "COLLECTING_PURPOSE", telegram_chat_id: message.chat.id });
    await botReply(message.chat.id, project.id, null, `Great! You're verified for project ${project.project_name}. What is the primary purpose of this building? For example: residential, commercial, mixed-use, industrial, hospital, hotel, or school.`);
    return { ok: true };
  }

  const { data: projectData, error: projectError } = await supabase.from("projects").select("*").eq("id", session.project_id).single();
  if (projectError) throw projectError;
  const project = projectData as Project;

  if (session.state === "COLLECTING_PURPOSE") {
    await supabase.from("projects").update({ building_purpose: text }).eq("id", project.id);
    await updateSession(session.id, { state: "AWAITING_FLOOR_COUNT" });
    await botReply(message.chat.id, project.id, null, "How many total floors does this building have, including basements, ground floor, and rooftop if applicable?");
    return { ok: true };
  }

  if (session.state === "AWAITING_FLOOR_COUNT") {
    const count = parsePositiveInteger(text);
    if (!count) {
      await botReply(message.chat.id, project.id, null, "Please send the total floor count as a number, for example: 6.");
      return { ok: true };
    }
    session = await updateSession(session.id, { state: "AWAITING_FLOOR_NAMES", data: { totalFloors: count } });
    await supabase.from("projects").update({ total_floors: count, status: "in_progress" }).eq("id", project.id);
    await botReply(message.chat.id, project.id, null, `Please send the ${count} floor names in bottom-to-top order, one per line. Example:\nBasement\nGround Floor\nFirst Floor\nRooftop`);
    return { ok: true };
  }

  if (session.state === "AWAITING_FLOOR_NAMES") {
    const count = Number((session.data as { totalFloors?: number }).totalFloors ?? project.total_floors);
    const parsed = parseFloorNames(text, count);
    if (!parsed.ok) {
      await botReply(message.chat.id, project.id, null, `${parsed.error} Please resend the full list, one floor per line, from lowest to highest.`);
      return { ok: true };
    }
    const floors = await createFloors(project, parsed.names);
    await supabase.from("projects").update({ floor_sequence: parsed.names, current_floor: 0 }).eq("id", project.id);
    await updateSession(session.id, { state: "COLLECTING_SPECIAL_REQUIREMENTS", current_floor_id: floors[0]?.id ?? null });
    await botReply(message.chat.id, project.id, null, "Any special electrical requirements? Include backup generators, solar, EV charging, server rooms, industrial machinery, medical equipment, or similar loads.");
    return { ok: true };
  }

  if (session.state === "COLLECTING_SPECIAL_REQUIREMENTS") {
    const floor = await currentFloor(project.id, project.current_floor);
    await supabase.from("projects").update({ special_requirements: text }).eq("id", project.id);
    await updateSession(session.id, { state: "AWAITING_PDF", current_floor_id: floor.id });
    await botReply(message.chat.id, project.id, floor.id, `Let's begin with the lowest floor. Please send me the architectural floor plan PDF for ${floor.floor_name}.`);
    return { ok: true };
  }

  if (session.state === "AWAITING_PDF") {
    if (!message.document?.file_id || !/pdf/i.test(message.document.mime_type ?? message.document.file_name ?? "")) {
      await botReply(message.chat.id, project.id, session.current_floor_id, "Please upload the architectural floor plan as a PDF document.");
      return { ok: true };
    }

    const floor = session.current_floor_id ? ({ id: session.current_floor_id } as Floor) : await currentFloor(project.id, project.current_floor);
    await supabase.from("floors").update({ status: "pdf_received" }).eq("id", floor.id);
    await createJob("telegram_pdf", {
      projectId: project.id,
      floorId: floor.id,
      fileId: message.document.file_id,
      filename: message.document.file_name
    });
    void triggerJobProcessing();
    await updateSession(session.id, { state: "ANALYZING", current_floor_id: floor.id });
    await botReply(message.chat.id, project.id, floor.id, "PDF received. I am converting and analyzing the floor plan now.");
    return { ok: true };
  }

  if (session.state === "AWAITING_ANSWERS") {
    if (!text) {
      await botReply(message.chat.id, project.id, session.current_floor_id, "Please send your answers as text so I can generate the design.");
      return { ok: true };
    }
    await supabase.from("floors").update({ architect_answers: { raw: text }, status: "designing" }).eq("id", session.current_floor_id);
    await createJob("generate_design", { projectId: project.id, floorId: session.current_floor_id });
    void triggerJobProcessing();
    await updateSession(session.id, { state: "DESIGNING" });
    await botReply(message.chat.id, project.id, session.current_floor_id, "Thank you. I am generating the electrical design and will send it for engineering review.");
    return { ok: true };
  }

  await botReply(message.chat.id, project.id, session.current_floor_id, "Your current project step is being processed. I will message you when the next action is needed.");
  return { ok: true };
}
