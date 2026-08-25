insert into kiosks(name) values('Praia da Torre'),('Terrapleno de Algés') on conflict do nothing;
insert into bikes(code,model,kiosk_id)
select 'C'||lpad(n::text,3,'0'),'Bicicleta convencional '||lpad(n::text,3,'0'),(select id from kiosks where name=case when n<=10 then 'Praia da Torre' else 'Terrapleno de Algés' end)
from generate_series(1,20)n on conflict(code) do nothing;
insert into bike_status_history(bike_id,status,kiosk_id,note) select id,status,kiosk_id,'Criação inicial' from bikes where not exists(select 1 from bike_status_history h where h.bike_id=bikes.id);
