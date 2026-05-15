-- DANGER: Deletes all Elec Nova Tech app data while keeping the schema.
-- Run in Supabase SQL editor only when you intentionally want an empty app.

truncate table
  jobs,
  bot_sessions,
  files,
  conversations,
  designs,
  floors,
  projects
restart identity cascade;
