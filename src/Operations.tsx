import {useState} from "react";
import {post} from "./api";
import {useFeedback} from "./Feedback";
import {Badge,useLoad} from "./pages/shared";

type Issue={issue_type:string;severity:"critical"|"high"|"medium";entity_id:string;title:string;detail:string};
type Data={
  diagnostics:{generated_at:string;issues:Issue[]};
  job_runs:any[];
  email_jobs:any[];
  email_summary:{pending:number;failed:number;sent:number;last_sent?:string};
  performance:{route:string;requests:number;average_ms:number;maximum_ms:number;average_db_calls:number;errors:number}[];
};
const date=(value?:string)=>value?new Date(value).toLocaleString("pt-PT"):"—";
const severity=(value:string)=>value==="critical"?"Crítica":value==="high"?"Alta":"Média";

export function Operations(){
  const {notify}=useFeedback();
  const [refresh,setRefresh]=useState(0),[busy,setBusy]=useState("");
  const {data,error}=useLoad<Data>("/operations",refresh);
  async function retry(id:string){setBusy(id);try{await post(`/operations/email/${id}/retry`,{});notify("O envio voltou à fila.","success");setRefresh(x=>x+1)}catch(e){notify((e as Error).message,"error")}finally{setBusy("")}}
  if(error)return <p className="error">{error}</p>;
  if(!data)return <p>A carregar controlo operacional…</p>;
  const issues=data.diagnostics?.issues||[];
  return <>
    <div className="title"><div><h1>Controlo operacional</h1><p>Incongruências, tarefas automáticas e desempenho técnico</p></div><button className="secondary" onClick={()=>setRefresh(x=>x+1)}>Atualizar</button></div>
    <div className="metrics">
      <div className="card metric"><Badge>Alertas</Badge><b>{issues.length}</b><span>situações a verificar</span></div>
      <div className="card metric"><Badge>Emails</Badge><b>{data.email_summary.pending}</b><span>pendentes · {data.email_summary.failed} falhados</span></div>
      <div className="card metric"><Badge>Cron</Badge><b>{data.job_runs[0]?.status==="success"?"OK":"—"}</b><span>{data.job_runs[0]?date(data.job_runs[0].finished_at):"sem execução registada"}</span></div>
    </div>
    <section className="card"><h2>Anomalias operacionais</h2><p className="muted">A lista é calculada diretamente a partir do estado atual da operação.</p>
      {!issues.length?<p className="success">Não foram encontradas incongruências.</p>:<div className="table-wrap"><table><thead><tr><th>Prioridade</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>{issues.map((item,index)=><tr key={`${item.issue_type}-${item.entity_id}-${index}`}><td><Badge>{severity(item.severity)}</Badge></td><td><b>{item.title}</b></td><td>{item.detail}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="card"><h2>Tarefa automática de email</h2><div className="table-wrap"><table><thead><tr><th>Execução</th><th>Estado</th><th>Resultado</th><th>Erro</th></tr></thead><tbody>{data.job_runs.map(run=><tr key={run.id}><td>{date(run.finished_at)}</td><td><Badge>{run.status==="success"?"Concluída":"Falhada"}</Badge></td><td>{run.status==="success"?`${run.result?.queued||0} em fila · ${run.result?.processed||0} processados`:"—"}</td><td>{run.error_message||"—"}</td></tr>)}{!data.job_runs.length&&<tr><td colSpan={4}>Ainda não existem execuções registadas após esta atualização.</td></tr>}</tbody></table></div></section>
    <section className="card"><h2>Emails recentes</h2><div className="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Estado</th><th>Tentativas</th><th>Erro</th><th></th></tr></thead><tbody>{data.email_jobs.map(job=><tr key={job.id}><td>{date(job.created_at)}</td><td>{job.event_type}</td><td><Badge>{job.status}</Badge></td><td>{job.attempts}</td><td>{job.last_error||"—"}</td><td>{job.status!=="sent"&&<button className="text" disabled={busy===job.id} onClick={()=>retry(job.id)}>{busy===job.id?"A colocar…":"Repetir"}</button>}</td></tr>)}</tbody></table></div></section>
    <section className="card"><h2>Desempenho — últimos 7 dias</h2><p className="muted">Não são guardados clientes, parâmetros nem conteúdo dos pedidos.</p><div className="table-wrap"><table><thead><tr><th>Página/API</th><th>Pedidos</th><th>Média</th><th>Máximo</th><th>Consultas BD</th><th>Erros</th></tr></thead><tbody>{data.performance.map(row=><tr key={row.route}><td><code>{row.route}</code></td><td>{row.requests}</td><td>{row.average_ms} ms</td><td>{row.maximum_ms} ms</td><td>{row.average_db_calls}</td><td>{row.errors}</td></tr>)}{!data.performance.length&&<tr><td colSpan={6}>Os dados começarão a aparecer à medida que a aplicação for utilizada.</td></tr>}</tbody></table></div></section>
  </>;
}
