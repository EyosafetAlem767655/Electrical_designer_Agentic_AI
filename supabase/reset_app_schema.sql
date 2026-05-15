-- DANGER: This resets the Elec Nova Tech app schema.
-- It drops these app tables and all data in them:
-- projects, floors, designs, conversations, files, bot_sessions, jobs.
--
-- Use this when an existing Supabase database has incompatible pre-existing
-- tables, for example a projects table without architect_name.

create extension if not exists pgcrypto;

drop table if exists jobs cascade;
drop table if exists bot_sessions cascade;
drop table if exists files cascade;
drop table if exists conversations cascade;
drop table if exists designs cascade;
drop table if exists floors cascade;
drop table if exists projects cascade;

drop function if exists set_updated_at();

create table projects (
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

create table floors (
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

create table designs (
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

create table conversations (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  floor_id uuid references floors(id),
  sender text not null check (sender in ('bot', 'architect', 'admin')),
  message text not null,
  message_type text default 'text' check (message_type in ('text', 'document', 'photo', 'command')),
  telegram_message_id bigint,
  created_at timestamptz default now()
);

create table files (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  floor_id uuid references floors(id),
  file_type text not null check (file_type in ('architectural_pdf', 'floor_screenshot', 'electrical_design', 'final_pdf')),
  storage_path text not null,
  public_url text,
  original_filename text,
  created_at timestamptz default now()
);

create table bot_sessions (
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

create table jobs (
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

create index idx_projects_status on projects(status);
create index idx_floors_project on floors(project_id, floor_number);
create index idx_designs_floor on designs(floor_id, version desc);
create index idx_jobs_status_run_after on jobs(status, run_after);
create index idx_conversations_project_floor on conversations(project_id, floor_id, created_at);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at before update on projects for each row execute function set_updated_at();
create trigger floors_updated_at before update on floors for each row execute function set_updated_at();
create trigger bot_sessions_updated_at before update on bot_sessions for each row execute function set_updated_at();
create trigger jobs_updated_at before update on jobs for each row execute function set_updated_at();

alter table projects disable row level security;
alter table floors disable row level security;
alter table designs disable row level security;
alter table conversations disable row level security;
alter table files disable row level security;
alter table bot_sessions disable row level security;
alter table jobs disable row level security;

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', true)
on conflict (id) do update set public = excluded.public;
