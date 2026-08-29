import { useEffect, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { api, post } from "./api";
import type { User } from "./types";
import {
  BikeDetail,
  Dashboard,
  Fleet,
  Rentals,
  Faults,
  FaultReport,
  Profile,
  Reports,
  Users,
} from "./pages";
import { Activity } from "./Activity";
import { DailyClosures } from "./DailyClosures";

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        className="card login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await post<{ user: User; csrf: string }>("/auth/login", {
              username,
              password,
            });
            onLogin(r.user);
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <img
          className="brand-logo login-logo"
          src="/parques-tejo-logo.png"
          alt="Parques Tejo"
        />
        <h1>Gestão da frota</h1>
        <p>Quiosques de Mobilidade</p>
        <label>
          Nome de utilizador
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Palavra-passe
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "A entrar…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
function Setup() {
  const [token, setToken] = useState(""),
    [fullName, setFullName] = useState(""),
    [username, setUsername] = useState("admin"),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        className="card login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const r = await fetch("/api/bootstrap", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Bootstrap-Token": token,
              },
              body: JSON.stringify({ full_name: fullName, username, password }),
            });
            const b: any = await r.json();
            if (!r.ok) throw new Error(b.error);
            setMessage(
              "Administrador criado. Já pode voltar ao ecrã de entrada.",
            );
          } catch (x) {
            setMessage((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Configuração inicial</h1>
        <p>Utilize esta página apenas uma vez.</p>
        <label>
          Código temporário de configuração
          <input
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label>
          Nome do administrador
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        <label>
          Nome de utilizador
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Palavra-passe inicial
          <input
            type="password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && (
          <div
            className={
              message.startsWith("Administrador") ? "success" : "error"
            }
          >
            {message}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "A criar…" : "Criar administrador"}
        </button>
        <a className="secondary full" href="/">
          Voltar ao início
        </a>
      </form>
    </main>
  );
}
function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const nav = useNavigate();
  const links = [
    ["/", "Dashboard"],
    ["/frota", "Frota"],
    ["/perfil", "O meu perfil"],
  ];
  if (user.role !== "manutencao")
    links.splice(
      2,
      0,
      ["/alugueres", "Alugueres"],
      ["/fecho-diario", "Fecho diário"],
    );
  if (user.role !== "funcionario")
    links.splice(links.length - 1, 0, ["/avarias", "Avarias e manutenção"]);
  if (user.role === "admin")
    links.push(
      ["/relatorios", "Relatórios"],
      ["/atividade", "Atividade"],
      ["/utilizadores", "Utilizadores"],
    );
  return (
    <div className="shell">
      <header>
        <div className="brand">
          <img
            className="brand-logo header-logo"
            src="/parques-tejo-logo.png"
            alt="Parques Tejo"
          />
          <strong>Frota e equipamentos</strong>
        </div>
        <div>
          <span className="user-name">{user.full_name}</span>
          <button
            className="text"
            onClick={async () => {
              await post("/auth/logout", {}).catch(() => {});
              onLogout();
              nav("/");
            }}
          >
            Sair
          </button>
        </div>
      </header>
      <nav>
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/"}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/frota" element={<Fleet user={user} />} />
          <Route
            path="/frota/:id"
            element={
              ["admin", "manutencao"].includes(user.role) ? (
                <BikeDetail user={user} />
              ) : (
                <Navigate to="/frota" />
              )
            }
          />
          <Route
            path="/alugueres"
            element={
              user.role === "manutencao" ? (
                <Navigate to="/" />
              ) : (
                <Rentals user={user} />
              )
            }
          />
          <Route
            path="/fecho-diario"
            element={
              user.role === "manutencao" ? (
                <Navigate to="/" />
              ) : (
                <DailyClosures user={user} />
              )
            }
          />
          <Route path="/comunicar-avaria" element={<FaultReport />} />
          <Route
            path="/avarias"
            element={
              user.role === "funcionario" ? <Navigate to="/" /> : <Faults />
            }
          />
          <Route path="/perfil" element={<Profile user={user} />} />
          <Route
            path="/relatorios"
            element={user.role === "admin" ? <Reports /> : <Navigate to="/" />}
          />
          <Route
            path="/atividade"
            element={user.role === "admin" ? <Activity /> : <Navigate to="/" />}
          />
          <Route
            path="/utilizadores"
            element={user.role === "admin" ? <Users /> : <Navigate to="/" />}
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: User; csrf: string }>("/auth/me")
      .then((x) => setUser(x.user))
      .catch(() => setUser(null));
  }, []);
  if (location.pathname === "/configurar") return <Setup />;
  if (user === undefined) return <div className="loading">A carregar…</div>;
  return user ? (
    <Layout user={user} onLogout={() => setUser(null)} />
  ) : (
    <Login onLogin={setUser} />
  );
}
