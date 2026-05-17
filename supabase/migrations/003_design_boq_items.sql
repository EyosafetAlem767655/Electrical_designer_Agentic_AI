alter table designs add column if not exists boq_items jsonb default '[]'::jsonb;
