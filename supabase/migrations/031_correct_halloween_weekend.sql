-- Corrige a campanha preparada na versão 2.7.0 para abranger todo o fim de semana:
-- 31 de outubro e 1 de novembro de 2026, em hora de Lisboa.
update commercial_campaigns
set starts_at = '2026-10-31 00:00:00 Europe/Lisbon'::timestamptz,
    ends_at = '2026-11-02 00:00:00 Europe/Lisbon'::timestamptz,
    updated_at = now()
where name = 'Halloween — 1 hora gratuita'
  and starts_at = '2026-10-30 00:00:00 Europe/Lisbon'::timestamptz
  and ends_at = '2026-11-01 00:00:00 Europe/Lisbon'::timestamptz;

insert into commercial_campaigns(
  name, description, starts_at, ends_at, benefit_type, benefit_value,
  applies_to_category, max_items, confirmation_label
)
select
  'Halloween — 1 hora gratuita',
  'Uma bicicleta com a primeira hora gratuita para clientes mascarados.',
  '2026-10-31 00:00:00 Europe/Lisbon'::timestamptz,
  '2026-11-02 00:00:00 Europe/Lisbon'::timestamptz,
  'free_hours', 1, 'bicycle', 1,
  'Confirmo que o cliente se apresentou mascarado'
where not exists (
  select 1 from commercial_campaigns
  where name = 'Halloween — 1 hora gratuita'
    and starts_at = '2026-10-31 00:00:00 Europe/Lisbon'::timestamptz
    and ends_at = '2026-11-02 00:00:00 Europe/Lisbon'::timestamptz
);
