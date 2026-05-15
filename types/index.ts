export type ProjectStatus = "created" | "awaiting_verification" | "verified" | "in_progress" | "completed";
export type FloorStatus =
  | "pending"
  | "pdf_received"
  | "analyzing"
  | "questions_sent"
  | "designing"
  | "design_ready"
  | "revision_requested"
  | "approved";

export type BotState =
  | "AWAITING_VERIFICATION"
  | "AWAITING_FLOOR_COUNT"
  | "AWAITING_FLOOR_NAMES"
  | "COLLECTING_PURPOSE"
  | "COLLECTING_SPECIAL_REQUIREMENTS"
  | "AWAITING_PDF"
  | "ANALYZING"
  | "AWAITING_ANSWERS"
  | "DESIGNING"
  | "AWAITING_APPROVAL"
  | "COMPLETED";

export type JobType =
  | "telegram_pdf"
  | "analyze_floor"
  | "generate_design"
  | "revision_design"
  | "pdf_export"
  | "pdf_compile";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export type Project = {
  id: string;
  project_name: string;
  project_code: string | null;
  architect_name: string;
  architect_telegram_username: string;
  company_name: string | null;
  building_purpose: string | null;
  special_requirements: string | null;
  building_address: string | null;
  notes: string | null;
  total_floors: number | null;
  floor_sequence: string[] | null;
  current_floor: number;
  status: ProjectStatus;
  telegram_chat_id: number | null;
  telegram_user_id: number | null;
  group_chat_id: number | null;
  telegram_group_invite_link: string | null;
  telegram_group_title: string | null;
  telegram_group_bound_at: string | null;
  telegram_outreach_status: string | null;
  created_at: string;
  updated_at: string;
};

export type Floor = {
  id: string;
  project_id: string;
  floor_number: number;
  floor_name: string;
  architectural_pdf_url: string | null;
  architectural_image_url: string | null;
  architectural_pdf_path: string | null;
  architectural_image_path: string | null;
  status: FloorStatus;
  architect_answers: Record<string, unknown>;
  ai_questions: string[];
  ai_analysis: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DesignAnnotation = {
  label: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  type: string;
  description?: string;
};

export type SymbolLegendItem = {
  symbol: string;
  label: string;
  color: string;
  description: string;
};

export type Design = {
  id: string;
  floor_id: string;
  version: number;
  design_image_url: string | null;
  design_image_path: string | null;
  design_pdf_url: string | null;
  design_pdf_path: string | null;
  annotations: DesignAnnotation[];
  symbol_legend: SymbolLegendItem[];
  revision_notes: string | null;
  improvement_request: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  project_id: string;
  floor_id: string | null;
  sender: "bot" | "architect" | "admin";
  message: string;
  message_type: "text" | "document" | "photo" | "command";
  telegram_message_id: number | null;
  created_at: string;
};

export type BotSession = {
  id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  telegram_username: string | null;
  project_id: string | null;
  current_floor_id: string | null;
  state: BotState;
  pending_prompt: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  error: string | null;
  run_after: string;
  created_at: string;
  updated_at: string;
};

export type ProjectBundle = {
  project: Project;
  floors: Floor[];
  designs: Design[];
  conversations: Conversation[];
  jobs: Job[];
};
