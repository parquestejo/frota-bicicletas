-- Correção da 2.6: a participação no programa de pontos é automática.
alter table customer_profiles alter column gamification_opt_in set default true;

update customer_profiles
set gamification_opt_in=true,
    public_ranking_opt_in=false,
    gamification_consent_at=null,
    gamification_consent_by=null
where gamification_opt_in is distinct from true
   or public_ranking_opt_in is distinct from false
   or gamification_consent_at is not null
   or gamification_consent_by is not null;

create or replace function gamification_dashboard()
returns jsonb language sql security definer set search_path=public as $$
with rental_days as (
  select r.customer_profile_id,(r.returned_at at time zone 'Europe/Lisbon')::date rental_day,
    count(*) rental_count,coalesce(sum(r.estimated_distance_km),0) km,coalesce(sum(r.estimated_co2_kg),0) co2
  from rentals r where r.status='Concluído' and r.customer_profile_id is not null
  group by r.customer_profile_id,(r.returned_at at time zone 'Europe/Lisbon')::date
), stats as (
  select p.id,p.kind,p.name,p.school,p.membership_code,p.public_ranking_opt_in,
    coalesce(sum(d.rental_count),0)::integer rental_count,round(coalesce(sum(d.km),0),2) km,round(coalesce(sum(d.co2),0),3) co2,
    coalesce(sum(10+least(30,floor(d.km)::integer)),0)::integer earned_points
  from customer_profiles p left join rental_days d on d.customer_profile_id=p.id
  where p.active
  group by p.id
), spent as (
  select customer_profile_id,coalesce(sum(points_spent),0)::integer points_spent from gamification_redemptions group by customer_profile_id
), ranked as (
  select s.*,greatest(0,s.earned_points-coalesce(sp.points_spent,0)) available_points,
    case when s.earned_points>=750 then 'Embaixador' when s.earned_points>=300 then 'Explorador' when s.earned_points>=100 then 'Pedalante' else 'Iniciante' end level
  from stats s left join spent sp on sp.customer_profile_id=s.id
), schools as (
  select school,count(*) participants,sum(rental_count)::integer rental_count,round(sum(km),2) km,round(sum(co2),3) co2,sum(earned_points)::integer points
  from ranked where kind='school' group by school
)
select jsonb_build_object(
  'customers',coalesce((select jsonb_agg(to_jsonb(ranked) order by earned_points desc,name) from ranked),'[]'::jsonb),
  'schools',coalesce((select jsonb_agg(to_jsonb(schools) order by points desc,school) from schools),'[]'::jsonb)
);
$$;

revoke execute on function gamification_dashboard() from public,anon,authenticated;
grant execute on function gamification_dashboard() to service_role;
