import { DEFAULT_SYMBOL_LEGEND } from "@/lib/constants";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase";
import type { Conversation, Design, Floor, Project, ProjectBundle } from "@/types";

const demoProject: Project = {
  id: "demo-project",
  project_name: "Nova Tower Prototype",
  project_code: "NOVAT0",
  architect_name: "Demo Architect",
  architect_telegram_username: "awolaibot",
  company_name: "Elec Nova Tech",
  building_purpose: "Mixed-use",
  special_requirements: "Backup generator, EV charging, emergency lighting",
  building_address: null,
  notes: null,
  total_floors: 4,
  floor_sequence: ["Basement", "Ground Floor", "First Floor", "Rooftop"],
  current_floor: 1,
  status: "in_progress",
  telegram_chat_id: null,
  telegram_user_id: null,
  group_chat_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const demoFloors: Floor[] = ["Basement", "Ground Floor", "First Floor", "Rooftop"].map((name, index) => ({
  id: `demo-floor-${index}`,
  project_id: demoProject.id,
  floor_number: index,
  floor_name: name,
  architectural_pdf_url: null,
  architectural_image_url: null,
  architectural_pdf_path: null,
  architectural_image_path: null,
  status: index === 0 ? "approved" : index === 1 ? "design_ready" : "pending",
  architect_answers: {},
  ai_questions: ["Confirm special equipment rooms.", "Confirm emergency lighting requirements."],
  ai_analysis: { summary: "Demo analysis placeholder for design review." },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}));

const demoDesigns: Design[] = [
  {
    id: "demo-design",
    floor_id: "demo-floor-1",
    version: 1,
    design_image_url: null,
    design_image_path: null,
    design_pdf_url: null,
    design_pdf_path: null,
    annotations: [
      { label: "DB-G", x: 86, y: 16, targetX: 55, targetY: 38, type: "distribution_board" },
      { label: "L1 lighting", x: 7, y: 20, targetX: 42, targetY: 44, type: "lighting" },
      { label: "P1 sockets", x: 7, y: 76, targetX: 58, targetY: 65, type: "power" }
    ],
    symbol_legend: DEFAULT_SYMBOL_LEGEND,
    revision_notes: null,
    improvement_request: null,
    created_at: new Date().toISOString()
  }
];

export async function getProjects(): Promise<Project[]> {
  if (!hasSupabaseServerEnv()) return [demoProject];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function getProjectBundle(projectId: string): Promise<ProjectBundle | null> {
  if (!hasSupabaseServerEnv() || projectId === "demo-project") {
    return {
      project: demoProject,
      floors: demoFloors,
      designs: demoDesigns,
      conversations: [
        {
          id: "demo-conversation",
          project_id: demoProject.id,
          floor_id: "demo-floor-1",
          sender: "bot",
          message: "The electrical design has been generated and sent for engineering review.",
          message_type: "text",
          telegram_message_id: null,
          created_at: new Date().toISOString()
        }
      ]
    };
  }

  const supabase = getSupabaseAdmin();
  const [{ data: project, error: projectError }, { data: floors, error: floorsError }, { data: conversations, error: conversationsError }] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("floors").select("*").eq("project_id", projectId).order("floor_number", { ascending: true }),
      supabase.from("conversations").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(50)
    ]);

  if (projectError) return null;
  if (floorsError) throw floorsError;
  if (conversationsError) throw conversationsError;

  const floorIds = (floors ?? []).map((floor) => floor.id);
  const { data: designs, error: designsError } = floorIds.length
    ? await supabase.from("designs").select("*").in("floor_id", floorIds).order("version", { ascending: false })
    : { data: [], error: null };
  if (designsError) throw designsError;

  return {
    project: project as Project,
    floors: (floors ?? []) as Floor[],
    designs: (designs ?? []) as Design[],
    conversations: (conversations ?? []) as Conversation[]
  };
}

export async function getFloorBundle(projectId: string, floorId: string) {
  const bundle = await getProjectBundle(projectId);
  if (!bundle) return null;
  const floor = bundle.floors.find((item) => item.id === floorId);
  if (!floor) return null;
  const designs = bundle.designs.filter((item) => item.floor_id === floorId).sort((a, b) => b.version - a.version);
  return { ...bundle, floor, designs };
}
