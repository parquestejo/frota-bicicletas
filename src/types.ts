export type Role = "admin" | "funcionario" | "manutencao";
export type BikeStatus =
  | "Disponível"
  | "Alugada"
  | "Avariada"
  | "Em manutenção"
  | "Indisponível";
export type AssetType = string;
export interface EquipmentType { code:string; name:string; category:"bicycle"|"accessory"; prefix:string; default_model:string; deposit_amount:number; resident_free:boolean; included:boolean; active:boolean; }
export interface EquipmentPrice { id:string; asset_type:string; period:"hour"|"day"; amount:number; effective_from:string; created_at:string; }
export interface CommercialCampaign { id:string; name:string; description?:string; starts_at:string; ends_at:string; benefit_type:"free_hours"|"percentage"|"fixed_discount"|"free_rental"; benefit_value:number; applies_to_category:"bicycle"|"accessory"|"all"; max_items:number; confirmation_label:string; active:boolean; created_at:string; }
export interface User {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  usual_kiosk_id?: string;
  active: boolean;
  last_login_at?: string;
}
export interface Kiosk {
  id: string;
  name: string;
  allows_rentals?: boolean;
  closure_due_time?: string;
  closure_grace_minutes?: number;
  operating_days?: number[];
}
export interface Bike {
  id: string;
  code: string;
  asset_type: AssetType;
  model: string;
  photo_url?: string;
  kiosk_id: string;
  status: BikeStatus;
  notes?: string;
  active: boolean;
  kiosk?: Kiosk;
  created_at: string;
  updated_at: string;
}
export interface RentalItem {
  id: string;
  bike_id: string;
  returned_at?: string;
  return_kiosk_id?: string;
  anomaly: boolean;
  anomaly_description?: string;
  deposit_retained?: number;
  deposit_retention_reason?: string;
  bike?: Bike;
  return_kiosk?: Kiosk;
  returned_by_user?: User;
  rental?: Rental;
}
export interface Rental {
  id: string;
  reference: string;
  customer_ref: string;
  customer_contact?: string;
  charged_amount: number;
  expected_amount?: number;
  discount_amount?: number;
  commercial_campaign_id?: string;
  commercial_campaign_discount?: number;
  commercial_campaign_confirmed?: boolean;
  commercial_campaign?: CommercialCampaign;
  rental_kind?: "normal" | "resident" | "institutional" | "frequent" | "school";
  rental_period?: "hour" | "day" | null;
  rental_hours?: number | null;
  resident_proof_type?: "AT" | "Dístico de residente" | "Subscrição 120 minutos";
  oeiras_move_confirmed?: boolean;
  institutional_entity?: "Parques Tejo" | "Município de Oeiras";
  institutional_person?: string;
  price_override_reason?: string;
  start_kiosk_id: string;
  started_by?: string;
  status: "Em aberto" | "Concluído" | "Anulado";
  started_at: string;
  returned_at?: string;
  items: RentalItem[];
  start_kiosk?: Kiosk;
  started_by_user?: User;
  returned_by_user?: User;
  corrected_at?: string;
  correction_reason?: string;
  customer_profile_id?: string;
  deposit_authorization_id?: string;
  authorization_code?: string;
  estimated_distance_km?: number;
  estimated_co2_kg?: number;
  customer_profile?: CustomerProfile;
  deposit_authorization?: DepositAuthorization;
}
export interface DepositAuthorization {
  id: string;
  authorization_code: string;
  amount: number;
  authorized_at: string;
  expires_at: string;
  status: "active" | "cancelled" | "captured" | "expired";
}
export interface CustomerProfile {
  id: string;
  kind: "frequent" | "school";
  name: string;
  nif: string;
  masked_nif?: string;
  school?: string;
  phone?: string;
  email?: string;
  verified_at?: string;
  verified_by?: string;
  adult_present_confirmed?: boolean;
  active_authorization?: DepositAuthorization | null;
  last_authorization?: DepositAuthorization | null;
  activity?: { rental_count: number; estimated_distance_km: number; estimated_co2_kg: number };
  rentals?: CustomerRentalHistory[];
  history_loaded?: boolean;
  authorizations?: DepositAuthorization[];
  membership_code?: string;
  gamification_opt_in?: boolean;
  public_ranking_opt_in?: boolean;
  gamification_consent_at?: string;
  points?: { earned: number; spent: number; available: number; level: string };
  redemptions?: { id: string; points_spent: number; awarded_at: string; reward?: { name: string } }[];
  active?: boolean;
  created_at?: string;
}
export interface CustomerRentalHistory {
  id: string;
  reference: string;
  status: "Em aberto" | "Concluído";
  started_at: string;
  returned_at?: string;
  estimated_distance_km?: number;
  estimated_co2_kg?: number;
  start_kiosk?: { name: string };
  items?: { id: string; bike?: { code: string; asset_type: string }; return_kiosk?: { name: string } }[];
}
export interface RentalPeriodUpdate {
  additional_amount?: number;
  charged_amount: number;
  expected_amount: number;
  tariff_amount?: number;
  rental_period?: "hour" | "day";
  rental_hours?: number | null;
}
export interface MaintenanceIntervention {
  id: string;
  intervention_date: string;
  description: string;
  technician_supplier?: string;
  cost?: number;
  parts_materials?: string;
  notes?: string;
  created_at: string;
  created_by_user?: User;
}
export interface Fault {
  id: string;
  bike_id: string;
  bike?: Bike;
  origin: string;
  category: string;
  description: string;
  severity: string;
  usable: boolean;
  status: string;
  created_at: string;
  resolved_at?: string;
  notes?: string;
  created_by_user?: User;
  interventions?: MaintenanceIntervention[];
}
export interface DailyClosure {
  id: string;
  report_date: string;
  kiosk_id: string;
  user_id: string;
  rental_count: number;
  bike_count: number;
  electric_count: number;
  conventional_count: number;
  child_count: number;
  accessory_count: number;
  card_total: number;
  receipt_path?: string;
  receipt_name?: string;
  receipt_content_type?: string;
  observations?: string;
  status: "Rascunho" | "Submetido";
  submitted_at?: string;
  created_at: string;
  updated_at: string;
  corrected_at?: string;
  correction_reason?: string;
  kiosk?: Kiosk;
  user?: User;
}
export interface RentalDiscrepancy {
  id: string;
  rental_id: string;
  bike_code: string;
  description: string;
  status: "Pendente" | "Resolvida";
  created_at: string;
  resolved_at?: string;
  resolution?: string;
  created_by_user?: User;
  resolved_by_user?: User;
  rental?: Rental;
}
