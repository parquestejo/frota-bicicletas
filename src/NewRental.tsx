import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, post } from "./api";
import type { Bike, CustomerProfile, EquipmentPrice, EquipmentType, Kiosk, User } from "./types";

type RentalKind = "normal" | "resident" | "institutional" | "frequent" | "school";
type RentalPeriod = "hour" | "day";
const money = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString("pt-PT");
const daysRemaining = (value: string) => Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000));

export function NewRental({ user }: { user: User }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{
      available_bikes: Bike[];
      kiosks: Kiosk[];
      equipment_types: EquipmentType[];
      prices: EquipmentPrice[];
    } | null>(null),
    [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState(""),
    [customer, setCustomer] = useState(""),
    [customerContact, setCustomerContact] = useState(""),
    [kind, setKind] = useState<RentalKind>("normal"),
    [period, setPeriod] = useState<RentalPeriod>("hour"),
    [hours, setHours] = useState(1),
    [oeirasMove, setOeirasMove] = useState(false),
    [residentProof, setResidentProof] = useState(""),
    [institutionalEntity, setInstitutionalEntity] = useState(""),
    [nif, setNif] = useState(""),
    [school, setSchool] = useState(""),
    [profileEmail, setProfileEmail] = useState(""),
    [profileVerified, setProfileVerified] = useState(false),
    [adultPresent, setAdultPresent] = useState(false),
    [authorizationCode, setAuthorizationCode] = useState(""),
    [rentalAuthorizationCode, setRentalAuthorizationCode] = useState(""),
    [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null),
    [profileBusy, setProfileBusy] = useState(false),
    [kiosk, setKiosk] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ available_bikes: Bike[]; kiosks: Kiosk[]; equipment_types: EquipmentType[]; prices: EquipmentPrice[] }>("/rentals")
      .then(setData)
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (data && !kiosk)
      setKiosk(user.usual_kiosk_id || data.kiosks[0]?.id || "");
  }, [data, kiosk, user.usual_kiosk_id]);

  async function start(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!customer.trim()) {
      setMessage("Indique o cliente ou uma referência.");
      return;
    }
    if (!selected.length) {
      setMessage("Selecione pelo menos uma bicicleta ou acessório.");
      return;
    }
    if (kind === "resident" && (!oeirasMove || !residentProof)) {
      setMessage("Confirme a App Oeiras Move e o comprovativo de residência.");
      return;
    }
    if (kind === "institutional" && !institutionalEntity) {
      setMessage("Selecione a entidade responsável pela utilização institucional.");
      return;
    }
    if ((kind === "frequent" || kind === "school") && !customerProfile) {
      setMessage("Pesquise ou crie primeiro o registo do cliente.");
      return;
    }
    const effectiveAuthorizationCode=kind==="frequent"?customerProfile?.active_authorization?.authorization_code:rentalAuthorizationCode.trim();
    if(kind!=="institutional"&&!effectiveAuthorizationCode){setMessage("Indique o código de autorização do talão Multibanco.");return;}
    const bicycleCount = chosen.filter((item) => definition(item.asset_type)?.category === "bicycle").length;
    const helmetCount = chosen.filter((item) => item.asset_type === "helmet").length;
    if (kind === "school" && (bicycleCount !== 1 || helmetCount > 1 || chosen.some((item) => definition(item.asset_type)?.category !== "bicycle" && item.asset_type !== "helmet"))) {
      setMessage("O Cartão Escolar permite uma bicicleta e, opcionalmente, um capacete gratuito.");
      return;
    }
    setBusy(true);
    try {
      await post("/rentals", {
        customer_ref: customer,
        customer_contact: customerContact,
        start_kiosk_id: kiosk,
        bike_ids: selected,
        charged_amount: payableAmount,
        rental_kind: kind,
        rental_period: kind === "institutional" ? null : period,
        rental_hours: kind !== "institutional" && period === "hour" ? hours : null,
        oeiras_move_confirmed: kind === "resident" ? oeirasMove : false,
        resident_proof_type: kind === "resident" ? residentProof : null,
        institutional_entity: kind === "institutional" ? institutionalEntity : null,
        institutional_person: kind === "institutional" ? customer.trim() : null,
        customer_profile_id: customerProfile?.id || null,
        deposit_authorization_id: kind === "frequent" ? customerProfile?.active_authorization?.id || null : null,
        authorization_code: effectiveAuthorizationCode || null,
      });
      navigate("/alugueres");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const available =
    data?.available_bikes.filter((bike) => bike.kiosk_id === kiosk) || [];
  const chosen = available.filter((item) => selected.includes(item.id));
  const price = (type:string, pricePeriod: RentalPeriod) => Number(data?.prices.find(item => item.asset_type === type && item.period === pricePeriod)?.amount || 0);
  const durationPrice = (type:string) => period === "day" ? price(type,"day") : Math.min(price(type,"hour") * hours, price(type,"day"));
  const definition = (type:string) => data?.equipment_types.find(item => item.code === type);
  const commercialAmount = chosen.reduce((sum, item) => sum + durationPrice(item.asset_type), 0);
  const helmetBenefit = chosen.filter((item)=>item.asset_type === "helmet").reduce((sum,item)=>sum+durationPrice(item.asset_type),0);
  const payableAmount = kind === "institutional" || kind === "school" ? 0 : kind === "resident"
    ? chosen.filter((item) => !definition(item.asset_type)?.resident_free).reduce((sum, item) => sum + durationPrice(item.asset_type), 0)
    : kind === "frequent" ? Math.max(0, commercialAmount - helmetBenefit)
    : commercialAmount;
  const depositAmount = kind === "institutional" || (kind === "frequent" && customerProfile?.active_authorization) ? 0 : chosen.reduce((sum,item)=>sum+Number(definition(item.asset_type)?.deposit_amount || 0),0);

  async function findProfile() {
    const clean=nif.replace(/\D/g,""); if(clean.length!==9){setMessage("Indique um NIF com 9 algarismos.");return;}
    setProfileBusy(true); setMessage("");
    try { const result=await api<{profile:CustomerProfile|null}>(`/customer-profiles?nif=${clean}`); if(result.profile&&result.profile.kind!==kind){setCustomerProfile(null);setMessage("Este NIF já está associado a outro tipo de registo.");} else {setCustomerProfile(result.profile); if(result.profile){setCustomer(result.profile.name);setSchool(result.profile.school||"");setCustomerContact(result.profile.phone||"");setProfileEmail(result.profile.email||"");} else setMessage("Não existe registo. Preencha os dados para o criar.");} }
    catch(e){setMessage((e as Error).message);} finally{setProfileBusy(false);}
  }
  async function saveProfile() {
    const clean=nif.replace(/\D/g,"");
    const renewal=kind==="frequent"&&!!customerProfile;
    if(clean.length!==9||!customer.trim()||(kind==="school"&&(!school.trim()||!adultPresent))||(kind==="frequent"&&(!authorizationCode.trim()||(!renewal&&(!customerContact.trim()||!profileEmail.trim()||!profileVerified))))){setMessage("Preencha e valide todos os dados obrigatórios do registo.");return;}
    setProfileBusy(true); setMessage("");
    try { const result=await post<{profile:CustomerProfile}>("/customer-profiles",{kind,name:customer.trim(),nif:clean,school:kind==="school"?school.trim():null,phone:kind==="frequent"?customerContact.trim():null,email:kind==="frequent"?profileEmail.trim():null,verified:kind==="frequent"?profileVerified:false,renew_only:renewal,adult_present_confirmed:kind==="school"?adultPresent:false,authorization_code:kind==="frequent"?authorizationCode.trim():null}); setCustomerProfile(result.profile); setAuthorizationCode("");setProfileVerified(false); }
    catch(e){setMessage((e as Error).message);} finally{setProfileBusy(false);}
  }

  return (
    <>
      <div className="title">
        <div>
          <h1>Novo aluguer</h1>
          <p>Registe o cliente e selecione os itens a alugar</p>
        </div>
        <Link className="secondary" to="/alugueres">
          Cancelar
        </Link>
      </div>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {!data ? (
        !loadError && <p>A carregar…</p>
      ) : (
        <form className="card form" onSubmit={start} noValidate>
          <label>
            {kind === "institutional" ? "Nome de quem levantou" : "Cliente ou referência"}
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              aria-invalid={!!message && !customer.trim()}
              aria-describedby={message ? "new-rental-error" : undefined}
              required
            />
          </label>
          <fieldset>
            <legend>Tipo de utilização</legend>
            <div className="choice-row">
              <label><input type="radio" checked={kind === "normal"} onChange={()=>setKind("normal")}/> Aluguer normal</label>
              <label><input type="radio" checked={kind === "resident"} onChange={()=>setKind("resident")}/> Benefício de residente</label>
              <label><input type="radio" checked={kind === "institutional"} onChange={()=>setKind("institutional")}/> Atividade institucional</label>
              <label><input type="radio" checked={kind === "frequent"} onChange={()=>{setKind("frequent");setCustomerProfile(null)}}/> Cliente frequente</label>
              <label><input type="radio" checked={kind === "school"} onChange={()=>{setKind("school");setCustomerProfile(null)}}/> Cartão Escolar Municipal</label>
            </div>
          </fieldset>
          {(kind === "frequent" || kind === "school") && <fieldset className="resident-benefit"><legend>Registo especial</legend>
            <div className="form-grid"><label>NIF<input inputMode="numeric" maxLength={9} value={nif} onChange={(e)=>{setNif(e.target.value.replace(/\D/g,"").slice(0,9));setCustomerProfile(null)}}/></label><button type="button" className="secondary" disabled={profileBusy||nif.length!==9} onClick={findProfile}>{profileBusy?"A procurar…":"Procurar registo"}</button></div>
            {customerProfile ? <><div className="notice"><b>{customerProfile.name}</b> · NIF {customerProfile.masked_nif || customerProfile.nif}<br/>{kind==="frequent" ? <>{customerProfile.phone} · {customerProfile.email}<br/>{customerProfile.active_authorization ? <>Caução inserida em <b>{date(customerProfile.active_authorization.authorized_at)}</b> · válida até <b>{date(customerProfile.active_authorization.expires_at)}</b> · <b>{daysRemaining(customerProfile.active_authorization.expires_at)} dias restantes</b></> : customerProfile.last_authorization ? <>Última caução inserida em <b>{date(customerProfile.last_authorization.authorized_at)}</b> · terminou em <b>{date(customerProfile.last_authorization.expires_at)}</b> — é necessária uma nova pré-autorização</> : "Ainda não existe caução ativa"}</> : customerProfile.school}</div>
              <div className="notice"><b>Atividade do cliente</b><br/>{customerProfile.activity?.rental_count || 0} alugueres concluídos · {Number(customerProfile.activity?.estimated_distance_km || 0).toLocaleString("pt-PT",{maximumFractionDigits:1})} km estimados · {Number(customerProfile.activity?.estimated_co2_kg || 0).toLocaleString("pt-PT",{maximumFractionDigits:2})} kg de CO₂ poupados</div>
              {!!customerProfile.rentals?.length&&<details><summary>Ver histórico de alugueres ({customerProfile.rentals.length})</summary><div className="table-wrap"><table><thead><tr><th>Data</th><th>Referência</th><th>Quiosque</th><th>Itens</th><th>Estado</th><th>Km</th><th>CO₂</th></tr></thead><tbody>{customerProfile.rentals.map((r)=><tr key={r.id}><td>{date(r.started_at)}</td><td>{r.reference}</td><td>{r.start_kiosk?.name||"—"}</td><td>{r.items?.map((item)=>item.bike?.code).filter(Boolean).join(", ")||"—"}</td><td>{r.status}</td><td>{r.status==="Concluído"?`${Number(r.estimated_distance_km||0).toLocaleString("pt-PT",{maximumFractionDigits:1})} km`:"—"}</td><td>{r.status==="Concluído"?`${Number(r.estimated_co2_kg||0).toLocaleString("pt-PT",{maximumFractionDigits:2})} kg`:"—"}</td></tr>)}</tbody></table></div></details>}
              {kind==="frequent"&&!customerProfile.active_authorization&&<><label>Novo código de autorização do talão Multibanco<input value={authorizationCode} onChange={(e)=>setAuthorizationCode(e.target.value)} maxLength={80}/></label><button type="button" className="secondary" disabled={profileBusy||!authorizationCode.trim()} onClick={saveProfile}>Registar nova caução por 30 dias</button></>}</> : <>
              {kind==="school"&&<><label>Escola<input value={school} onChange={(e)=>setSchool(e.target.value)}/></label><label className="check-line"><input type="checkbox" checked={adultPresent} onChange={(e)=>setAdultPresent(e.target.checked)}/><span>Adulto presente no momento do registo</span></label></>}
              {kind==="frequent"&&<><div className="form-grid"><label>Contacto telefónico<input type="tel" value={customerContact} onChange={(e)=>setCustomerContact(e.target.value)} maxLength={50}/></label><label>Email<input type="email" value={profileEmail} onChange={(e)=>setProfileEmail(e.target.value)} maxLength={200}/></label></div><label>Código de autorização do talão Multibanco<input value={authorizationCode} onChange={(e)=>setAuthorizationCode(e.target.value)} maxLength={80}/><small>Ficará associado à pré-autorização durante 30 dias.</small></label><label className="check-line"><input type="checkbox" checked={profileVerified} onChange={(e)=>setProfileVerified(e.target.checked)}/><span>Confirmei presencialmente os dados apresentados pelo cliente</span></label></>}
              <button type="button" className="secondary" disabled={profileBusy} onClick={saveProfile}>Criar registo</button>
            </>}
            <p className="muted">Inclui gratuitamente um capacete, sujeito a disponibilidade. Selecione-o na lista abaixo.</p>
          </fieldset>}
          {kind !== "institutional" && <div className="form-grid"><label>Modalidade<select value={period} onChange={(e)=>setPeriod(e.target.value as RentalPeriod)}><option value="hour">Pagamento à hora</option><option value="day">1 dia</option></select></label>{period === "hour" && <label>Número de horas<input type="number" min="1" max="168" step="1" value={hours} onChange={(e)=>setHours(Math.max(1,Math.min(168,Number(e.target.value)||1)))}/></label>}</div>}
          {kind === "resident" && <fieldset className="resident-benefit"><legend>Condições do benefício</legend>
            <label className="check-line"><input type="checkbox" checked={oeirasMove} onChange={(e)=>setOeirasMove(e.target.checked)}/> <span>App Oeiras Move instalada</span></label>
            <label>Comprovativo de residência<select value={residentProof} onChange={(e)=>setResidentProof(e.target.value)}><option value="">Selecionar…</option><option>AT</option><option>Dístico de residente</option><option>Subscrição 120 minutos</option></select></label>
          </fieldset>}
          {kind === "institutional" && <label>Entidade<select value={institutionalEntity} onChange={(e)=>setInstitutionalEntity(e.target.value)}><option value="">Selecionar…</option><option>Parques Tejo</option><option>Município de Oeiras</option></select></label>}
          {kind !== "institutional" && kind !== "frequent" && <label>Código de autorização do talão Multibanco<input required maxLength={80} value={rentalAuthorizationCode} onChange={(e)=>setRentalAuthorizationCode(e.target.value)} placeholder="Obrigatório para cancelar a caução ou confirmar a compra"/></label>}
          <label>
            {kind === "frequent" ? "Contacto telefónico do cliente frequente" : "Número de contacto (opcional)"}
            <input
              type="tel"
              autoComplete="tel"
              maxLength={50}
              value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value)}
            />
          </label>
          <label>
            Quiosque de saída
            <select value={kiosk} onChange={(e) => setKiosk(e.target.value)}>
              {data.kiosks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="notice"><b>{kind === "institutional" ? "Utilização institucional — sem cobrança" : kind === "school" ? "Cartão Escolar — utilização gratuita" : `Total a cobrar: ${money(payableAmount)}`}</b><br/>{kind === "institutional" ? "Caução dispensada" : kind === "frequent" && customerProfile?.active_authorization ? `Pré-autorização ativa até ${new Date(customerProfile.active_authorization.expires_at).toLocaleDateString("pt-PT")}` : `Caução a solicitar: ${money(depositAmount)}`}<br/><small>A bicicleta pode ser devolvida em qualquer Quiosque de Mobilidade.</small></div>
          <fieldset aria-invalid={!!message && !selected.length}>
            <legend>Bicicletas e acessórios disponíveis</legend>
            <div className="bike-picker">
              {available.map((bike) => (
                <label key={bike.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(bike.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, bike.id]
                          : current.filter((id) => id !== bike.id),
                      )
                    }
                  />
                  <b>{bike.code}</b> {bike.model}
                </label>
              ))}
              {!available.length && (
                <p className="muted">Não existem itens disponíveis neste quiosque.</p>
              )}
            </div>
          </fieldset>
          {message && (
            <div
              id="new-rental-error"
              className="error"
              role="alert"
              aria-live="polite"
            >
              {message}
            </div>
          )}
          <button
            className="primary"
            disabled={busy}
          >
            {busy ? "A guardar…" : "Iniciar aluguer"}
          </button>
        </form>
      )}
    </>
  );
}
