import {useEffect,useState} from 'react';
import {api} from './api';

type ActivityRow={id:number;action:string;entity:string;entity_id?:string;note?:string;created_at:string;user?:{full_name:string;username:string}};
const fmt=(d:string)=>new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Lisbon'}).format(new Date(d));

export function Activity(){
  const [rows,setRows]=useState<ActivityRow[]>([]);
  const [error,setError]=useState('');
  const [q,setQ]=useState('');
  const [page,setPage]=useState(1),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),pageSize=50;
  useEffect(()=>{let current=true;const timer=window.setTimeout(()=>{setLoading(true);setError('');api<{activity:ActivityRow[];total:number}>(`/activity?q=${encodeURIComponent(q.trim())}&page=${page}&page_size=${pageSize}`).then(x=>{if(current){setRows(x.activity);setTotal(x.total)}}).catch(e=>{if(current)setError(e.message)}).finally(()=>{if(current)setLoading(false)})},300);return()=>{current=false;window.clearTimeout(timer)}},[q,page]);
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return <><div className="title"><div><h1>Registo de atividade</h1><p>Histórico paginado das alterações efetuadas na aplicação</p></div></div><div className="filters"><input placeholder="Pesquisar ação, área ou nota" value={q} onChange={e=>{setQ(e.target.value);setPage(1)}}/></div>{error&&<p className="error">{error}</p>}{loading?<p>A carregar…</p>:<><div className="table-wrap"><table><thead><tr><th>Data</th><th>Utilizador</th><th>Ação</th><th>Área</th><th>Nota</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{fmt(r.created_at)}</td><td>{r.user?.full_name||'Sistema'}<br/><small>{r.user?.username}</small></td><td>{r.action}</td><td>{r.entity}</td><td>{r.note||'—'}</td></tr>)}</tbody></table></div><div className="pagination"><button className="secondary" disabled={page<=1} onClick={()=>setPage(v=>v-1)}>Anterior</button><span>Página {page} de {pages} · {total} registos</span><button className="secondary" disabled={page>=pages} onClick={()=>setPage(v=>v+1)}>Seguinte</button></div></>}</>
}
