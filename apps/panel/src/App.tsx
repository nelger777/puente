import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth, useIsAdmin } from "./auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { CasePage } from "./pages/CasePage";
import { HandoffsPage } from "./pages/HandoffsPage";
import { InstallPage } from "./pages/InstallPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SummaryPage } from "./pages/SummaryPage";
import { TryPage } from "./pages/TryPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, checking } = useAuth();
  const location = useLocation();
  if (checking) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function AdminOnly({ children }: { children: ReactNode }) {
  return useIsAdmin() ? children : <Navigate to="/" replace />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<SummaryPage />} />
          <Route path="derivaciones" element={<HandoffsPage />} />
          <Route path="derivaciones/:code" element={<CasePage />} />
          <Route path="probar" element={<TryPage />} />
          <Route path="configuracion" element={<SettingsPage />} />
          <Route
            path="base"
            element={
              <AdminOnly>
                <KnowledgePage />
              </AdminOnly>
            }
          />
          <Route path="instalacion" element={<InstallPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
