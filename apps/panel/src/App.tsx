import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth, useIsAdmin, useIsPlatformAdmin } from "./auth";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/AccountPage";
import { Loading } from "./components/ui";
import { BusinessesPage } from "./pages/BusinessesPage";
import { CasePage } from "./pages/CasePage";
import { ConversationPage } from "./pages/ConversationPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { HandoffsPage } from "./pages/HandoffsPage";
import { InstallPage } from "./pages/InstallPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SummaryPage } from "./pages/SummaryPage";
import { TryPage } from "./pages/TryPage";
import { UnansweredPage } from "./pages/UnansweredPage";
import { UsersPage } from "./pages/UsersPage";

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

function PlatformOnly({ children }: { children: ReactNode }) {
  return useIsPlatformAdmin() ? children : <Navigate to="/" replace />;
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
          <Route path="conversaciones" element={<ConversationsPage />} />
          <Route path="conversaciones/:id" element={<ConversationPage />} />
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
          <Route
            path="sin-respuesta"
            element={
              <AdminOnly>
                <UnansweredPage />
              </AdminOnly>
            }
          />
          <Route
            path="usuarios"
            element={
              <AdminOnly>
                <UsersPage />
              </AdminOnly>
            }
          />
          <Route path="instalacion" element={<InstallPage />} />
          <Route path="cuenta" element={<AccountPage />} />
          <Route
            path="empresas"
            element={
              <PlatformOnly>
                <BusinessesPage />
              </PlatformOnly>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
