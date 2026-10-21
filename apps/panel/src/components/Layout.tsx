import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "../api/client";
import { useAuth, useIsAdmin, useIsPlatformAdmin } from "../auth";
import { useApi } from "../lib/use-api";
import { PendingProvider, usePending } from "../pending";

function Nav() {
  const isAdmin = useIsAdmin();
  const isPlatformAdmin = useIsPlatformAdmin();
  const { count } = usePending();
  const items: {
    to: string;
    label: string;
    badge?: number;
    only?: "admin" | "platform";
  }[] = [
    { to: "/", label: "Resumen" },
    { to: "/derivaciones", label: "Derivaciones", badge: count },
    { to: "/probar", label: "Probar" },
    { to: "/configuracion", label: "Configuración" },
    { to: "/base", label: "Base de conocimiento", only: "admin" },
    { to: "/usuarios", label: "Usuarios", only: "admin" },
    { to: "/instalacion", label: "Instalación" },
    { to: "/empresas", label: "Empresas", only: "platform" },
  ];
  return (
    <nav aria-label="Principal">
      {items
        .filter((i) => !i.only || (i.only === "admin" ? isAdmin : isPlatformAdmin))
        .map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}>
            <span>{item.label}</span>
            {item.badge ? (
              <span className="badge" aria-label={`${item.badge} pendientes`}>
                {item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
    </nav>
  );
}

/** Platform admin only: which business the whole panel is working on. */
function BusinessSwitcher() {
  const { me, actAs } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Reloaded on every page change so a business created in Empresas shows up here.
  const list = useApi(() => api.platformBusinesses(), [pathname]);
  const [error, setError] = useState<string | null>(null);
  const businesses = list.data?.businesses ?? [];
  if (!me || !businesses.length) return null;

  async function change(id: string) {
    setError(null);
    try {
      await actAs(id);
      void navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar de empresa");
    }
  }

  return (
    <div className="field switcher">
      <label htmlFor="business-switcher">Empresa</label>
      <select
        id="business-switcher"
        value={me.business.id}
        onChange={(e) => void change(e.target.value)}
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.active ? "" : " (inactiva)"}
          </option>
        ))}
      </select>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const isPlatformAdmin = useIsPlatformAdmin();
  return (
    // Keyed by business: switching companies remounts every page with fresh data.
    <PendingProvider key={me?.business.id}>
      <div className="app">
        <aside className="side">
          <div className="logo">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <path
                d="M2 20 Q13 4 24 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M6 20v-5M13 20v-9M20 20v-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <div>
              Puente
              <small>{me?.business.name}</small>
            </div>
          </div>
          {isPlatformAdmin ? <BusinessSwitcher /> : null}
          <Nav />
          <div className="side-foot">
            <span className="muted small">{me?.user.email}</span>
            <button type="button" className="btn ghost small" onClick={() => void logout()}>
              Cerrar sesión
            </button>
          </div>
        </aside>
        <main>
          <Outlet />
        </main>
      </div>
    </PendingProvider>
  );
}
