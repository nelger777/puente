import {
  UserCreateSchema,
  type UserRole,
  type UserSummary,
  type UserWithPassword,
} from "@puente/shared";
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { Card, Empty, ErrorNote, Loading, PageHeader, SecretNote } from "../components/ui";
import { useApi } from "../lib/use-api";

const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "Administrador", AGENT: "Agente" };

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

function RoleOptions() {
  return (
    <>
      <option value="AGENT">{ROLE_LABELS.AGENT}</option>
      <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
    </>
  );
}

export function UsersPage() {
  const { me } = useAuth();
  const users = useApi(() => api.users(), []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("AGENT");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [secret, setSecret] = useState<UserWithPassword | null>(null);

  if (users.error) return <ErrorNote error={users.error} onRetry={users.reload} />;
  const list = users.data?.users;
  if (!list) return <Loading />;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(toError(err));
    } finally {
      setBusy(false);
    }
  }

  const replace = (user: UserSummary) =>
    users.setData({ users: (list ?? []).map((u) => (u.id === user.id ? user : u)) });

  function add() {
    const parsed = UserCreateSchema.safeParse({ email, role });
    if (!parsed.success) {
      setEmailError("Correo inválido");
      return;
    }
    setEmailError(null);
    void run(async () => {
      const created = await api.createUser(parsed.data);
      users.setData({ users: [...(list ?? []), created.user] });
      setSecret(created);
      setEmail("");
    });
  }

  function reset(user: UserSummary) {
    if (
      !window.confirm(`¿Generar una contraseña nueva para ${user.email}? La actual deja de servir.`)
    ) {
      return;
    }
    void run(async () => setSecret(await api.resetPassword(user.id)));
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle={`Quién puede entrar al panel de ${me?.business.name ?? "la empresa"}.`}
      />
      <div className="stack">
        {secret ? (
          <SecretNote
            email={secret.user.email}
            password={secret.password}
            onClose={() => setSecret(null)}
          />
        ) : null}
        {actionError ? <ErrorNote error={actionError} /> : null}

        <Card title="Agregar usuario">
          <div className="form">
            <div className="field">
              <label htmlFor="new-user-email">Correo</label>
              <input
                id="new-user-email"
                type="email"
                value={email}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "new-user-email-err" : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
              {emailError ? (
                <div className="field-error" id="new-user-email-err">
                  {emailError}
                </div>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="new-user-role">Rol</label>
              <select
                id="new-user-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                <RoleOptions />
              </select>
              <div className="help">
                Los agentes atienden derivaciones; los administradores además configuran el
                asistente y gestionan usuarios.
              </div>
            </div>
          </div>
          <div className="form-foot">
            <button type="button" className="btn" disabled={busy} onClick={add}>
              Agregar y generar contraseña
            </button>
          </div>
        </Card>

        <Card title="Equipo">
          {list.length === 0 ? (
            <Empty>Todavía no hay usuarios.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="list-table">
                <thead>
                  <tr>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((user) => {
                    const self = user.id === me?.user.id;
                    return (
                      <tr key={user.id}>
                        <td>
                          {user.email} {self ? <span className="tag">Tú</span> : null}
                        </td>
                        <td>
                          <select
                            aria-label={`Rol de ${user.email}`}
                            value={user.role}
                            disabled={self || busy}
                            onChange={(e) => {
                              const next = e.target.value as UserRole;
                              void run(async () =>
                                replace(await api.updateUser(user.id, { role: next })),
                              );
                            }}
                          >
                            <RoleOptions />
                          </select>
                        </td>
                        <td>
                          {user.active ? (
                            <span className="tag tag-done">Activo</span>
                          ) : (
                            <span className="tag tag-warn">Desactivado</span>
                          )}
                        </td>
                        <td>
                          {self ? null : (
                            <div className="actions">
                              <button
                                type="button"
                                className="btn ghost small"
                                disabled={busy}
                                onClick={() => reset(user)}
                              >
                                Restablecer contraseña
                              </button>
                              <button
                                type="button"
                                className="btn ghost small"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () =>
                                    replace(
                                      await api.updateUser(user.id, { active: !user.active }),
                                    ),
                                  )
                                }
                              >
                                {user.active ? "Desactivar" : "Activar"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
