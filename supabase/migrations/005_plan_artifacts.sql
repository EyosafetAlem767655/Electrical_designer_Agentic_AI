alter table files drop constraint if exists files_file_type_check;
alter table files
  add constraint files_file_type_check
  check (file_type in ('architectural_pdf', 'architectural_image', 'floor_screenshot', 'electrical_design', 'final_pdf', 'plan_spec', 'debug_overlay'));
