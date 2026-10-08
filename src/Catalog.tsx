import { FormEvent, useState } from "react";
import { post } from "./api";
import { useFeedback } from "./Feedback";
import { useLoad } from "./pages/shared";
import type { EquipmentPrice, EquipmentType } from "./types";
import { Link } from "react-router-dom";

const money = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));

export function Catalog() {
  const { notify } = useFeedback();
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useLoad<{ types: EquipmentType[]; prices: EquipmentPrice[]; history: EquipmentPrice[] }>("/catalog", refresh);
  const [typeForm, setTypeForm] = useState({ code: "", name: "", category: "accessory", prefix: "", default_model: "", deposit_amount: 0, resident_free: false, included: false });
  const [priceForm, setPriceForm] = useState({ asset_type: "", hour: "", day: "", effective_from: new Date().toISOString().slice(0, 10) });
  const saveType = async (event: FormEvent) => { event.preventDefault(); try { await post("/catalog/types", typeForm); notify("Tipologia criada.", "success"); setTypeForm({ code: "", name: "", category: "accessory", prefix: "", default_model: "", deposit_amount: 0, resident_free: false, included: false }); setRefresh(x => x + 1); } catch (e) { notify((e as Error).message, "error"); } };
  const savePrices = async (event: FormEvent) => { event.preventDefault(); try { await post("/catalog/prices", priceForm); notify("Novo tarifário publicado.", "success"); setRefresh(x => x + 1); } catch (e) { notify((e as Error).message, "error"); } };
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>A carregar…</p>;
  const current = new Map(data.prices.map(price => [`${price.asset_type}-${price.period}`, price]));
  return <>
    <div className="title"><div><h1>Catálogo e preços</h1><p>Configuração administrativa dos equipamentos e do tarifário.</p></div><Link className="primary" to="/frota">Adicionar item ao inventário</Link></div>
    <section className="card"><h2>Tipologias de equipamento</h2><div className="table-wrap"><table><thead><tr><th>Tipologia</th><th>Categoria</th><th>Prefixo</th><th>Caução</th><th>Residente</th><th>Estado</th></tr></thead><tbody>
      {data.types.map(type => <tr key={type.code}><td><b>{type.name}</b><small className="block-meta">{type.code}</small></td><td>{type.category === "bicycle" ? "Bicicleta" : "Acessório"}</td><td>{type.prefix}</td><td>{money(type.deposit_amount)}</td><td>{type.resident_free ? "Gratuito" : "Pago"}</td><td>{type.active ? "Ativa" : "Inativa"}</td></tr>)}
    </tbody></table></div></section>
    <section className="card"><h2>Preços em vigor</h2><div className="table-wrap"><table><thead><tr><th>Equipamento</th><th>1 hora</th><th>1 dia</th><th>Entrada em vigor</th></tr></thead><tbody>
      {data.types.map(type => { const hour=current.get(`${type.code}-hour`), day=current.get(`${type.code}-day`); return <tr key={type.code}><td>{type.name}</td><td>{money(hour?.amount || 0)}</td><td>{money(day?.amount || 0)}</td><td>{new Intl.DateTimeFormat("pt-PT").format(new Date((day || hour)?.effective_from || Date.now()))}</td></tr>; })}
    </tbody></table></div></section>
    <div className="grid2">
      <form className="card form" onSubmit={savePrices}><h2>Publicar novos preços</h2><label>Equipamento<select required value={priceForm.asset_type} onChange={e=>setPriceForm({...priceForm,asset_type:e.target.value})}><option value="">Selecionar…</option>{data.types.filter(x=>x.active).map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select></label><label>Preço — 1 hora<input required min="0" step="0.01" type="number" value={priceForm.hour} onChange={e=>setPriceForm({...priceForm,hour:e.target.value})}/></label><label>Preço — 1 dia<input required min="0" step="0.01" type="number" value={priceForm.day} onChange={e=>setPriceForm({...priceForm,day:e.target.value})}/></label><label>Entrada em vigor<input required type="date" value={priceForm.effective_from} onChange={e=>setPriceForm({...priceForm,effective_from:e.target.value})}/></label><p className="muted">Os preços anteriores permanecem no histórico e não alteram alugueres já registados.</p><button className="primary">Publicar tarifário</button></form>
      <form className="card form" onSubmit={saveType}><h2>Nova tipologia</h2><label>Nome<input required value={typeForm.name} onChange={e=>setTypeForm({...typeForm,name:e.target.value,default_model:e.target.value})}/></label><label>Código interno<input required pattern="[a-z][a-z0-9_]+" placeholder="ex.: cesta" value={typeForm.code} onChange={e=>setTypeForm({...typeForm,code:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})}/></label><label>Categoria<select value={typeForm.category} onChange={e=>setTypeForm({...typeForm,category:e.target.value})}><option value="bicycle">Bicicleta</option><option value="accessory">Acessório</option></select></label><label>Prefixo dos itens<input required maxLength={6} value={typeForm.prefix} onChange={e=>setTypeForm({...typeForm,prefix:e.target.value.toUpperCase().replace(/[^A-Z]/g,"")})}/></label><label>Caução por item<input type="number" min="0" step="0.01" value={typeForm.deposit_amount} onChange={e=>setTypeForm({...typeForm,deposit_amount:Number(e.target.value)})}/></label><label className="check-line"><input type="checkbox" checked={typeForm.resident_free} onChange={e=>setTypeForm({...typeForm,resident_free:e.target.checked})}/><span>Gratuito para residentes</span></label><label className="check-line"><input type="checkbox" checked={typeForm.included} onChange={e=>setTypeForm({...typeForm,included:e.target.checked})}/><span>Incluído sem custo</span></label><button className="primary">Criar tipologia</button></form>
    </div>
    <section className="card"><details><summary><b>Histórico de preços</b></summary><div className="table-wrap"><table><thead><tr><th>Equipamento</th><th>Período</th><th>Preço</th><th>Entrada em vigor</th></tr></thead><tbody>{data.history.map(price=><tr key={price.id}><td>{data.types.find(x=>x.code===price.asset_type)?.name || price.asset_type}</td><td>{price.period === "hour" ? "1 hora" : "1 dia"}</td><td>{money(price.amount)}</td><td>{new Intl.DateTimeFormat("pt-PT").format(new Date(price.effective_from))}</td></tr>)}</tbody></table></div></details></section>
  </>;
}
