export type SimBike={id:string;status:string;kiosk:string};
export type SimRental={id:string;bikeIds:string[];returned:string[];status:'Em aberto'|'Concluído'};
export function canLogin(active:boolean,username:string,password:string){return active&&username.trim().length>0&&password.length>0}
export function canAdmin(role:string){return role==='admin'}
export function canRent(b:SimBike,open:SimRental[]){return b.status==='Disponível'&&!open.some(r=>r.status==='Em aberto'&&r.bikeIds.includes(b.id)&&!r.returned.includes(b.id))}
export function startRental(bikes:SimBike[],ids:string[],open:SimRental[]){if(!ids.length||ids.some(id=>!canRent(bikes.find(b=>b.id===id)!,open)))throw new Error('bike_not_available');return{id:'new',bikeIds:ids,returned:[],status:'Em aberto' as const}}
export function returnBikes(r:SimRental,bikes:SimBike[],ids:string[],kiosk:string,anomalies:Set<string>){const updated=bikes.map(b=>ids.includes(b.id)?{...b,kiosk,status:anomalies.has(b.id)?'Avariada':'Disponível'}:b);const returned=[...new Set([...r.returned,...ids])];return{rental:{...r,returned,status:returned.length===r.bikeIds.length?'Concluído':'Em aberto'} as SimRental,bikes:updated,faults:ids.filter(id=>anomalies.has(id))}}
export function returnSelectionAllowed(kind:string,pendingIds:string[],selectedIds:string[]){
  if(!selectedIds.length)return false;
  if(kind==='institutional')return selectedIds.every(id=>pendingIds.includes(id));
  return selectedIds.length===pendingIds.length&&pendingIds.every(id=>selectedIds.includes(id));
}
export function durationPrice(hour:number,day:number,hours:number){
  const hourly=Math.max(0,Number(hour)||0)*Math.max(1,Math.floor(Number(hours)||1));
  return Math.round(Math.min(hourly,Math.max(0,Number(day)||0))*100)/100;
}
export function commercialCampaignDiscount(basePayable:number,benefitType:string,benefitValue:number,eligibleItems:{duration:number;hour:number;day:number}[],maxItems:number,period:'hour'|'day'='hour',hours=1){
  const base=Math.max(0,Number(basePayable)||0),value=Math.max(0,Number(benefitValue)||0),items=eligibleItems.slice().sort((a,b)=>b.hour-a.hour).slice(0,Math.max(1,Math.floor(maxItems)||1));
  const raw=benefitType==='free_hours'?items.reduce((sum,item)=>{const afterFree=period==='hour'?(hours-value<=0?0:durationPrice(item.hour,item.day,hours-value)):Math.max(0,item.duration-item.hour*value);return sum+Math.max(0,item.duration-afterFree)},0):benefitType==='percentage'?base*Math.min(value,100)/100:benefitType==='fixed_discount'?value:benefitType==='free_rental'?base:0;
  return Math.round(Math.min(base,Math.max(0,raw))*100)/100;
}
export function estimateImpact(hours:number,bicycles:number){
  const distance=Math.round(Math.max(0,hours)*8*Math.max(0,Math.floor(bicycles))*100)/100;
  return{distance,co2:Math.round(distance*0.204*1000)/1000};
}
export function gamificationDayPoints(distanceKm:number){return 10+Math.min(30,Math.max(0,Math.floor(Number(distanceKm)||0)))}
export function gamificationLevel(points:number){const value=Math.max(0,Number(points)||0);return value>=750?"Embaixador":value>=300?"Explorador":value>=100?"Pedalante":"Iniciante"}
export function closeFault(b:SimBike,status:'Disponível'|'Indisponível'|'Em manutenção'){return{...b,status}}
export function audit(action:string,userId:string,entity:string){return{action,userId,entity,at:new Date().toISOString()}}
