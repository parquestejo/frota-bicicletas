import { useEffect, useMemo, useState } from "react";
import { api, patch } from "./api";
import type { CustomerProfile } from "./types";
import { useFeedback } from "./Feedback";

const fmt=(value?:string)=>value?new Date(value).toLocaleDateString("pt-PT"):"—";
const remaining=(value:string)=>Math.max(0,Math.ceil((new Date(value).getTime()-Date.now())/86400000));

function CustomerDetail({id,onClose,onSaved}:{id:string;onClose:()=>void;onSaved:()=>void}){
  const {notify}=useFeedback();
  const [customer,setCustomer]=useState<CustomerProfile|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false);
  const [form,setForm]=useState({name:"",phone:"",email:"",school:"",active:true});
  useEffect(()=>{api<{customer:CustomerProfile}>(`/admin/customers/${id}`).then((r)=>{setCustomer(r.customer);setForm({name:r.customer.name,phone:r.customer.phone||"",email:r.customer.email||"",school:r.customer.school||"",active:r.customer.active!==false});}).catch(e=>setError(e.message));},[id]);
  async function save(){setBusy(true);try{await patch(`/admin/customers/${id}`,form);notify("Ficha do cliente atualizada.","success");setEditing(false);onSaved();const r=await api<{customer:CustomerProfile}>(`/admin/customers/${id}`);setCustomer(r.customer);}catch(e){notify((e as Error).message,"error");}finally{setBusy(false);}}
  if(error)return <section className="card"><p className="error">{error}</p><button className="secondary" onClick={onClose}>Fechar</button></section>;
  if(!customer)return <p>A carregar ficha…</p>;
  const auth=customer.active_authorization;
  return <section className="card">
    <div className="title"><div><h2>{customer.name}</h2><p>{customer.kind==="frequent"?"Cliente frequente":"Cartão Escolar Municipal"} · NIF {customer.nif}</p></div><div className="actions"><button className="secondary" onClick={()=>setEditing(!editing)}>{editing?"Cancelar":"Editar"}</button><button className="text" onClick={onClose}>Fechar</button></div></div>
    {editing?<div className="form compact-form"><div className="form-grid"><label>Nome<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>{customer.kind==="frequent"?<><label>Contacto<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label></>:<label>Escola<input value={form.school} onChange={e=>setForm({...form,school:e.target.value})}/></label>}</div><label className="check-line"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/><span>Registo ativo</span></label><button className="primary" disabled={busy} onClick={save}>{busy?"A guardar…":"Guardar alterações"}</button></div>:<>
      <div className="form-grid"><div className="notice"><b>Dados</b><br/>{customer.kind==="frequent"?<>{customer.phone}<br/>{customer.email}</>:customer.school}<br/>Registo: {customer.active===false?"Inativo":"Ativo"}</div><div className="notice"><b>Atividade</b><br/>{customer.activity?.rental_count||0} alugueres<br/>{Number(customer.activity?.estimated_distance_km||0).toLocaleString("pt-PT",{maximumFractionDigits:1})} km estimados<br/>{Number(customer.activity?.estimated_co2_kg||0).toLocaleString("pt-PT",{maximumFractionDigits:2})} kg CO₂</div></div>
      {customer.kind==="frequent"&&<div className="notice"><b>Caução</b><br/>{auth?<>Inserida em {fmt(auth.authorized_at)} · termina em {fmt(auth.expires_at)} · {remaining(auth.expires_at)} dias restantes</>:customer.last_authorization?<>Terminou em {fmt(customer.last_authorization.expires_at)}</>:"Sem caução registada"}</div>}
      <h3>Histórico de alugueres</h3><div className="table-wrap"><table><thead><tr><th>Data</th><th>Referência</th><th>Quiosque</th><th>Itens</th><th>Estado</th><th>Km</th><th>CO₂</th></tr></thead><tbody>{customer.rentals?.map(r=><tr key={r.id}><td>{fmt(r.started_at)}</td><td>{r.reference}</td><td>{r.start_kiosk?.name||"—"}</td><td>{r.items?.map(i=>i.bike?.code).filter(Boolean).join(", ")||"—"}</td><td>{r.status}</td><td>{r.status==="Concluído"?Number(r.estimated_distance_km||0).toLocaleString("pt-PT",{maximumFractionDigits:1}):"—"}</td><td>{r.status==="Concluído"?`${Number(r.estimated_co2_kg||0).toLocaleString("pt-PT",{maximumFractionDigits:2})} kg`:"—"}</td></tr>)}{!customer.rentals?.length&&<tr><td colSpan={7}>Sem alugueres registados.</td></tr>}</tbody></table></div>
    </>}
  </section>;
}

export function Customers(){
  const [customers,setCustomers]=useState<CustomerProfile[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[kind,setKind]=useState<"frequent"|"school">("frequent"),[search,setSearch]=useState(""),[selected,setSelected]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  useEffect(()=>{setLoading(true);api<{customers:CustomerProfile[]}>("/admin/customers").then(r=>setCustomers(r.customers)).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[refresh]);
  const visible=useMemo(()=>{const term=search.trim().toLowerCase();return customers.filter(c=>c.kind===kind&&(!term||[c.name,c.nif,c.school,c.email,c.phone].some(v=>String(v||"").toLowerCase().includes(term))));},[customers,kind,search]);
  return <><div className="title"><div><h1>Clientes</h1><p>Clientes frequentes e utilizadores do Cartão Escolar Municipal</p></div></div>
    <div className="choice-row"><button className={kind==="frequent"?"primary":"secondary"} onClick={()=>{setKind("frequent");setSelected(null)}}>Clientes frequentes</button><button className={kind==="school"?"primary":"secondary"} onClick={()=>{setKind("school");setSelected(null)}}>Cartão Escolar</button></div>
    <label>Pesquisar<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome, NIF, escola, email ou contacto"/></label>
    {error&&<p className="error">{error}</p>}{selected&&<CustomerDetail id={selected} onClose={()=>setSelected(null)} onSaved={()=>setRefresh(v=>v+1)}/>} 
    {loading?<p>A carregar…</p>:<div className="table-wrap"><table><thead><tr><th>Nome</th><th>{kind==="frequent"?"Contacto":"Escola"}</th><th>NIF</th>{kind==="frequent"&&<th>Caução</th>}<th>Alugueres</th><th>Km estimados</th><th>CO₂</th><th>Estado</th><th></th></tr></thead><tbody>{visible.map(c=><tr key={c.id}><td>{c.name}</td><td>{kind==="frequent"?c.phone:c.school}</td><td>{c.nif}</td>{kind==="frequent"&&<td>{c.active_authorization?`${remaining(c.active_authorization.expires_at)} dias`:"Terminada/sem caução"}</td>}<td>{c.activity?.rental_count||0}</td><td>{Number(c.activity?.estimated_distance_km||0).toLocaleString("pt-PT",{maximumFractionDigits:1})}</td><td>{Number(c.activity?.estimated_co2_kg||0).toLocaleString("pt-PT",{maximumFractionDigits:2})} kg</td><td>{c.active===false?"Inativo":"Ativo"}</td><td><button className="text" onClick={()=>setSelected(c.id)}>Abrir ficha</button></td></tr>)}{!visible.length&&<tr><td colSpan={kind==="frequent"?9:8}>Não existem registos com estes critérios.</td></tr>}</tbody></table></div>}
  </>;
}
