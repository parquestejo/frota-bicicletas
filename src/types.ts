export type Role='admin'|'funcionario'|'manutencao';
export type BikeStatus='Disponível'|'Alugada'|'Avariada'|'Em manutenção'|'Indisponível';
export interface User {id:string; full_name:string; username:string; role:Role; usual_kiosk_id?:string; active:boolean; last_login_at?:string}
export interface Kiosk {id:string; name:string; allows_rentals?:boolean}
export interface Bike {id:string; code:string; model:string; photo_url?:string; kiosk_id:string; status:BikeStatus; notes?:string; active:boolean; kiosk?:Kiosk; created_at:string; updated_at:string}
export interface RentalItem {id:string; bike_id:string; returned_at?:string; anomaly:boolean; anomaly_description?:string; bike?:Bike; return_kiosk?:Kiosk; returned_by_user?:User; rental?:Rental}
export interface Rental {id:string; reference:string; customer_ref:string; start_kiosk_id:string; status:'Em aberto'|'Concluído'; started_at:string; returned_at?:string; items:RentalItem[]; start_kiosk?:Kiosk; started_by_user?:User; returned_by_user?:User}
export interface MaintenanceIntervention {id:string; intervention_date:string; description:string; technician_supplier?:string; cost?:number; parts_materials?:string; notes?:string; created_at:string; created_by_user?:User}
export interface Fault {id:string; bike_id:string; bike?:Bike; origin:string; category:string; description:string; severity:string; usable:boolean; status:string; created_at:string; notes?:string; created_by_user?:User; interventions?:MaintenanceIntervention[]}
