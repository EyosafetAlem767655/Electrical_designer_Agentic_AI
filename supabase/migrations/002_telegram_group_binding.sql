alter table projects add column if not exists telegram_group_invite_link text;
alter table projects add column if not exists telegram_group_title text;
alter table projects add column if not exists telegram_group_bound_at timestamptz;
alter table projects add column if not exists telegram_outreach_status text;
