export type SimBike={id:string;status:string;kiosk:string};
export type SimRental={id:string;bikeIds:string[];returned:string[];status:'Em aberto'|'Concluído'};
export function canLogin(active:boolean,username:string,password:string){return active&&username.trim().length>0&&password.length>0}
export function canAdmin(role:string){return role==='admin'}
export function canRent(b:SimBike,open:SimRental[]){return b.status==='Disponível'&&!open.some(r=>r.status==='Em aberto'&&r.bikeIds.includes(b.id)&&!r.returned.includes(b.id))}
export function startRental(bikes:SimBike[],ids:string[],open:SimRental[]){if(!ids.length||ids.some(id=>!canRent(bikes.find(b=>b.id===id)!,open)))throw new Error('bike_not_available');return{id:'new',bikeIds:ids,returned:[],status:'Em aberto' as const}}
export function returnBikes(r:SimRental,bikes:SimBike[],ids:string[],kiosk:string,anomalies:Set<string>){const updated=bikes.map(b=>ids.includes(b.id)?{...b,kiosk,status:anomalies.has(b.id)?'Avariada':'Disponível'}:b);const returned=[...new Set([...r.returned,...ids])];return{rental:{...r,returned,status:returned.length===r.bikeIds.length?'Concluído':'Em aberto'} as SimRental,bikes:updated,faults:ids.filter(id=>anomalies.has(id))}}
export function closeFault(b:SimBike,status:'Disponível'|'Indisponível'|'Em manutenção'){return{...b,status}}
export function audit(action:string,userId:string,entity:string){return{action,userId,entity,at:new Date().toISOString()}}
