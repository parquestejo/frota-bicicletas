import {useEffect,useMemo,useState} from 'react';
import {api} from './api';

type ActivityRow={id:number;action:string;entity:string;entity_id?:string;note?:string;created_at:string;user?:{full_name:string;username:string}};
const fmt=(d:string)=>new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Lisbon'}).format(new Date(d));

export function Activity(){
  const [rows,setRows]=useState<ActivityRow[]>([]);
  const [error,setError]=useState('');
  const [q,setQ]=useState('');
  useEffect(()=>{api<{activity:ActivityRow[]}>('/activity').then(x=>setRows(x.activity)).catch(e=>setError(e.message))},[]);
  const filtered=useMemo(()=>rows.filter(r=>(r.action+' '+r.entity+' '+(r.user?.full_name||'')+' '+(r.user?.username||'')).toLowerCase().includes(q.toLowerCase())),[rows,q]);
  return <><div className="title"><div><h1>Registo de atividade</h1><p>Últimas 500 alterações efetuadas na aplicação</p></div></div><div className="filters"><input placeholder="Pesquisar ação, área ou utilizador" value={q} onChange={e=>setQ(e.target.value)}/></div>{error&&<p className="error">{error}</p>}<div className="table-wrap"><table><thead><tr><th>Data</th><th>Utilizador</th><th>Ação</th><th>Área</th><th>Nota</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td>{fmt(r.created_at)}</td><td>{r.user?.full_name||'Sistema'}<br/><small>{r.user?.username}</small></td><td>{r.action}</td><td>{r.entity}</td><td>{r.note||'—'}</td></tr>)}</tbody></table></div></>
}
