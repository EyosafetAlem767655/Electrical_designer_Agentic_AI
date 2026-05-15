create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid default gen_random_uuid() primary key,
  project_name text not null unique,
  project_code text,
  architect_name text not null,
  architect_telegram_username text not null,
  company_name text,
  building_purpose text,
  special_requirements text,
  building_address text,
  notes text,
  total_floors integer,
  floor_sequence jsonb default '[]'::jsonb,
  current_floor integer default 0,
  status text default 'created' check (status in ('created', 'awaiting_verification', 'verified', 'in_progress', 'completed')),
  telegram_chat_id bigint,
  telegram_user_id bigint,
  group_chat_id bigint,
  telegram_group_invite_link text,
  telegram_group_title text,
  telegram_group_bound_at timestamptz,
  telegram_outreach_status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists floors (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  floor_number integer not null,
  floor_name text not null,
  architectural_pdf_url text,
  architectural_image_url text,
  architectural_pdf_path text,
  architectural_image_path text,
  status text default 'pending' check (status in ('pending', 'pdf_received', 'analyzing', 'questions_sent', 'designing', 'design_ready', 'revision_requested', 'approved')),
  architect_answers jsonb default '{}'::jsonb,
  ai_questions jsonb default '[]'::jsonb,
  ai_analysis jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, floor_number)
);

create table if not exists designs (
  id uuid default gen_random_uuid() primary key,
  floor_id uuid references floors(id) on delete cascade,
  version integer default 1,
  design_image_url text,
  design_image_path text,
  design_pdf_url text,
  design_pdf_path text,
  annotations jsonb default '[]'::jsonb,
  symbol_legend jsonb default '[]'::jsonb,
  revision_notes text,
  improvement_request text,
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  floor_id uuid references floors(id),
  sender text not null check (sender in ('bot', 'architect', 'admin')),
  message text not null,
  message_type text default 'text' check (message_type in ('text', 'document', 'photo', 'command')),
  telegram_message_id bigint,
  created_at timestamptz default now()
);

create table if not exists files (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  floor_id uuid references floors(id),
  file_type text not null check (file_type in ('architectural_pdf', 'floor_screenshot', 'electrical_design', 'final_pdf')),
  storage_path text not null,
  public_url text,
  original_filename text,
  created_at timestamptz default now()
);

create table if not exists bot_sessions (
  id uuid default gen_random_uuid() primary key,
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  telegram_username text,
  project_id uuid references projects(id) on delete set null,
  current_floor_id uuid references floors(id) on delete set null,
  state text not null default 'AWAITING_VERIFICATION',
  pending_prompt text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists jobs (
  id uuid default gen_random_uuid() primary key,
  type text not null check (type in ('telegram_pdf', 'analyze_floor', 'generate_design', 'revision_design', 'pdf_export', 'pdf_compile')),
  status text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer default 0,
  error text,
  run_after timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_projects_status on projects(status);
create index if not exists idx_floors_project on floors(project_id, floor_number);
create index if not exists idx_designs_floor on designs(floor_id, version desc);
create index if not exists idx_jobs_status_run_after on jobs(status, run_after);
create index if not exists idx_conversations_project_floor on conversations(project_id, floor_id, created_at);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at before update on projects for each row execute function set_updated_at();

drop trigger if exists floors_updated_at on floors;
create trigger floors_updated_at before update on floors for each row execute function set_updated_at();

drop trigger if exists bot_sessions_updated_at on bot_sessions;
create trigger bot_sessions_updated_at before update on bot_sessions for each row execute function set_updated_at();

drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at before update on jobs for each row execute function set_updated_at();
