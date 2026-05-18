import { createJob, triggerJobProcessing } from "@/lib/jobs";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isPersonNameMatch, isProjectNameMatch, parseBindCommand, parseFloorNames, parsePositiveInteger, parseStartPayload, parseVerificationDetails } from "@/lib/state-machine";
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

function normalizeProjectCode(value: string) {
  return value.trim().toUpperCase();
}

function startLinkRequiredMessage() {
  return "Please open the project-specific Telegram start link from your project admin before verifying. The link includes the project start code I need to identify the assignment.";
}

async function findProjectForVerification(fullName: string, projectName: string, username?: string | null, projectHint?: string | null) {
  if (!projectHint) return null;

  const supabase = getSupabaseAdmin();
  const normalizedUsername = username ? normalizeTelegramUsername(username) : null;
  const normalizedHint = normalizeProjectCode(projectHint);
  const query = supabase.from("projects").select("*").in("status", ["created", "awaiting_verification", "verified", "in_progress"]);
  const { data, error } = await query;
  if (error) throw error;
  return (
    ((data ?? []) as Project[]).find((project) => {
      const storedUsername = project.architect_telegram_username ? normalizeTelegramUsername(project.architect_telegram_username) : "";
      const usernameMatches = !storedUsername || storedUsername.startsWith("pending-") || Boolean(normalizedUsername && storedUsername === normalizedUsername);
      const hintMatches = project.id === projectHint || (project.project_code ? normalizeProjectCode(project.project_code) === normalizedHint : false);
      return hintMatches && usernameMatches && isProjectNameMatch(projectName, project.project_name) && isPersonNameMatch(fullName, project.architect_name);
    }) ??
    null
  );
}

async function verifyProject(project: Project, message: TelegramMessage, session: BotSession) {
  const supabase = getSupabaseAdmin();
  const update = {
    status: "verified",
    telegram_chat_id: message.chat.id,
    telegram_user_id: message.from?.id,
    architect_telegram_username: session.telegram_username ?? project.architect_telegram_username
  };

  const { error } = await supabase.from("projects").update(update).eq("id", project.id);
  if (!error) return;

  const errorText = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!/telegram_user_id|schema cache|column/i.test(errorText)) throw error;
  const { error: legacyError } = await supabase
    .from("projects")
    .update({
      status: "verified",
      telegram_chat_id: message.chat.id,
      architect_telegram_username: session.telegram_username ?? project.architect_telegram_username
    })
    .eq("id", project.id);
  if (legacyError) throw legacyError;
}

async function updateOutreachStatus(projectId: string, status: string) {
  const supabase = getSupabaseAdmin();
  await supabase.from("projects").update({ telegram_outreach_status: status }).eq("id", projectId);
}

async function bindGroup(project: Project, message: TelegramMessage) {
  const supabase = getSupabaseAdmin();
  const update = {
    group_chat_id: message.chat.id,
    telegram_group_title: message.chat.title ?? null,
    telegram_group_bound_at: new Date().toISOString(),
    telegram_outreach_status: "bound",
    status: project.status === "created" ? "awaiting_verification" : project.status
  };
  const { error } = await supabase.from("projects").update(update).eq("id", project.id);
  if (!error) return;

  const messageText = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!/telegram_group_title|telegram_group_bound_at|telegram_outreach_status|schema cache|column/i.test(messageText)) throw error;
  const { error: legacyError } = await supabase
    .from("projects")
    .update({
      group_chat_id: message.chat.id,
      status: project.status === "created" ? "awaiting_verification" : project.status
    })
    .eq("id", project.id);
  if (legacyError) throw legacyError;
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

  await bindGroup(project as Project, message);

  await logMessage(project.id, null, "bot", `Telegram group bound: ${message.chat.title ?? message.chat.id}`, "command", message.message_id);
  try {
    await sendProjectInvite(message.chat.id, project.architect_telegram_username, project.architect_name, project.project_code ?? project.id);
    await updateOutreachStatus(project.id, "invite_sent").catch(() => undefined);
  } catch (error) {
    await updateOutreachStatus(project.id, "invite_failed").catch(() => undefined);
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

function imageAttachment(message: TelegramMessage) {
  const photo = message.photo?.slice().sort((a, b) => (b.width * b.height || b.file_size || 0) - (a.width * a.height || a.file_size || 0))[0];
  if (photo?.file_id) {
    return { fileId: photo.file_id, filename: "floor-plan.jpg", contentType: "image/jpeg" };
  }

  const document = message.document;
  if (!document?.file_id) return null;
  const descriptor = `${document.mime_type ?? ""} ${document.file_name ?? ""}`;
  if (!/(^|\s)image\/(png|jpe?g)|\.(png|jpe?g)$/i.test(descriptor)) return null;
  return {
    fileId: document.file_id,
    filename: document.file_name ?? "floor-plan-image",
    contentType: document.mime_type && /^image\//i.test(document.mime_type) ? document.mime_type : "image/png"
  };
}

async function markFloorImageReceived(floorId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("floors").update({ status: "image_received" }).eq("id", floorId);
  if (!error) return;
  if (!/status|check constraint|violates|schema cache/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) throw error;
  await supabase.from("floors").update({ status: "pdf_received" }).eq("id", floorId);
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return { ok: true, ignored: true };
  if (message.chat.type !== "private") return handleGroupMessage(message);

  const supabase = getSupabaseAdmin();
  let session = await getOrCreateSession(message);
  const text = message.text?.trim() ?? "";
  await logMessage(
    session.project_id,
    session.current_floor_id,
    "architect",
    text || message.document?.file_name || (message.photo?.length ? "Image attachment" : "Attachment"),
    message.photo?.length ? "photo" : message.document ? "document" : "text",
    message.message_id
  );

  if (text.startsWith("/start")) {
    const projectHint = parseStartPayload(text);
    session = await updateSession(session.id, {
      project_id: null,
      current_floor_id: null,
      state: "AWAITING_VERIFICATION",
      telegram_chat_id: message.chat.id,
      data: projectHint ? { projectHint } : {}
    });
    await botReply(
      message.chat.id,
      null,
      null,
      projectHint
        ? "Project link received. To verify your identity, please send your exact full name and exact project name like this:\nFull name: Your Name\nProject: Project Name"
        : startLinkRequiredMessage()
    );
    return { ok: true };
  }

  if (!session.project_id || session.state === "AWAITING_VERIFICATION") {
    const projectHint = typeof session.data?.projectHint === "string" ? session.data.projectHint : null;
    if (!projectHint) {
      await botReply(message.chat.id, null, null, startLinkRequiredMessage());
      return { ok: true };
    }

    if (!text) {
      await botReply(message.chat.id, null, null, "Please send your exact full name and exact project name like this:\nFull name: Your Name\nProject: Project Name");
      return { ok: true };
    }

    const details = parseVerificationDetails(text);
    if (!details.fullName || !details.projectName) {
      await botReply(message.chat.id, null, null, "Please send your exact full name and exact project name like this:\nFull name: Your Name\nProject: Project Name");
      return { ok: true };
    }

    const project = await findProjectForVerification(details.fullName, details.projectName, session.telegram_username, projectHint);
    if (!project) {
      await botReply(message.chat.id, null, null, "I'm sorry, I could not verify that start code, full name, and project name. Please check the project-specific link and exact assignment details with your project admin.");
      return { ok: true };
    }

    await verifyProject(project, message, session);
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
    await updateSession(session.id, { state: "AWAITING_IMAGE", current_floor_id: floor.id });
    await botReply(message.chat.id, project.id, floor.id, `Let's begin with the lowest floor. Please send a clear PNG or JPG image of the architectural floor plan for ${floor.floor_name}. For best accuracy, send the original exported image as a file rather than a blurry photo.`);
    return { ok: true };
  }

  if (session.state === "AWAITING_IMAGE" || session.state === "AWAITING_PDF") {
    const image = imageAttachment(message);
    if (!image) {
      await botReply(message.chat.id, project.id, session.current_floor_id, "Please upload the architectural floor plan as a clear PNG or JPG image only. PDFs are no longer accepted for this workflow.");
      return { ok: true };
    }

    const floor = session.current_floor_id ? ({ id: session.current_floor_id } as Floor) : await currentFloor(project.id, project.current_floor);
    await markFloorImageReceived(floor.id);
    await createJob("telegram_image", {
      projectId: project.id,
      floorId: floor.id,
      fileId: image.fileId,
      filename: image.filename,
      contentType: image.contentType
    });
    void triggerJobProcessing();
    await updateSession(session.id, { state: "ANALYZING", current_floor_id: floor.id });
    await botReply(message.chat.id, project.id, floor.id, "Image received. I am analyzing the floor plan now.");
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
