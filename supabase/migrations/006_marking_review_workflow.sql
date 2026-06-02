alter table floors drop constraint if exists floors_status_check;
alter table floors
  add constraint floors_status_check
  check (status in ('pending', 'pdf_received', 'image_received', 'analyzing', 'marking_review', 'questions_sent', 'designing', 'design_ready', 'revision_requested', 'approved'));

alter table floors
  add column if not exists design_markings jsonb default '{}'::jsonb,
  add column if not exists review_answers jsonb default '{}'::jsonb;
