import { NavLink, Outlet } from "react-router";
import { useAuth, useIsAdmin } from "../auth";
import { PendingProvider, usePending } from "../pending";

function Nav() {
  const isAdmin = useIsAdmin();
  const { count } = usePending();
  const items: { to: string; label: string; badge?: number; adminOnly?: boolean }[] = [
    { to: "/", label: "Resumen" },
    { to: "/derivaciones", label: "Derivaciones", badge: count },
    { to: "/probar", label: "Probar" },
    { to: "/configuracion", label: "Configuración" },
    { to: "/base", label: "Base de conocimiento", adminOnly: true },
    { to: "/instalacion", label: "Instalación" },
  ];
  return (
    <nav aria-label="Principal">
      {items
        .filter((i) => !i.adminOnly || isAdmin)
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

export function Layout() {
  const { me, logout } = useAuth();
  return (
    <PendingProvider>
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
