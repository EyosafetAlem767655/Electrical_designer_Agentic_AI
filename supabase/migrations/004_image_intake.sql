alter table floors drop constraint if exists floors_status_check;
alter table floors
  add constraint floors_status_check
  check (status in ('pending', 'pdf_received', 'image_received', 'analyzing', 'questions_sent', 'designing', 'design_ready', 'revision_requested', 'approved'));

alter table files drop constraint if exists files_file_type_check;
alter table files
  add constraint files_file_type_check
  check (file_type in ('architectural_pdf', 'architectural_image', 'floor_screenshot', 'electrical_design', 'final_pdf'));

alter table jobs drop constraint if exists jobs_type_check;
alter table jobs
  add constraint jobs_type_check
  check (type in ('telegram_pdf', 'telegram_image', 'analyze_floor', 'generate_design', 'revision_design', 'pdf_export', 'pdf_compile'));
