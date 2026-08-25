begin;

-- Os códigos passam a identificar o tipo: E = elétrica; C = convencional.
alter table bikes drop constraint if exists bikes_code_check;
update bikes set code='C'||lpad(code,3,'0') where code ~ '^\d+$';
alter table bikes add constraint bikes_code_check check(code ~ '^[EC]\d{3,6}$');

commit;
