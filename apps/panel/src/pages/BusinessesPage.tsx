import { BusinessCreateSchema, type BusinessCreateResponse } from "@puente/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { Card, Empty, ErrorNote, Loading, PageHeader, SecretNote } from "../components/ui";
import { formatNumber } from "../lib/format";
import { slugify } from "../lib/slug";
import { useApi } from "../lib/use-api";

interface NewBusinessForm {
  name: string;
  slug: string;
  kind: string;
  whatsappNumber: string;
  notifyEmail: string;
  allowedDomains: string;
  adminEmail: string;
}

type FormErrors = Partial<Record<keyof NewBusinessForm, string>>;

const EMPTY: NewBusinessForm = {
  name: "",
  slug: "",
  kind: "",
  whatsappNumber: "",
  notifyEmail: "",
  allowedDomains: "",
  adminEmail: "",
};

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

export function BusinessesPage() {
  const { me, actAs } = useAuth();
  const navigate = useNavigate();
  const businesses = useApi(() => api.platformBusinesses(), []);
  const [form, setForm] = useState<NewBusinessForm>(EMPTY);
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [created, setCreated] = useState<BusinessCreateResponse | null>(null);

  if (businesses.error) return <ErrorNote error={businesses.error} onRetry={businesses.reload} />;
  const list = businesses.data?.businesses;
  if (!list) return <Loading />;

  const set = (key: keyof NewBusinessForm, value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "name" && !slugEdited ? { slug: slugify(value) } : {}),
    }));

  async function enter(businessId: string) {
    setActionError(null);
    try {
      await actAs(businessId);
      void navigate("/");
    } catch (err) {
      setActionError(toError(err));
    }
  }

  async function create() {
    const parsed = BusinessCreateSchema.safeParse({
      ...form,
      whatsappNumber: form.whatsappNumber.replace(/\D/g, ""),
      allowedDomains: form.allowedDomains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      const next: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof NewBusinessForm;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.createBusiness(parsed.data);
      setCreated(result);
      setForm(EMPTY);
      setSlugEdited(false);
      businesses.reload();
    } catch (err) {
      setActionError(toError(err));
    } finally {
      setBusy(false);
    }
  }

  function field(
    key: keyof NewBusinessForm,
    label: string,
    opts: { type?: string; help?: string; onChange?: (value: string) => void } = {},
  ) {
    const id = `nb-${key}`;
    const error = errors[key];
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type={opts.type ?? "text"}
          value={form[key]}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => (opts.onChange ?? ((v: string) => set(key, v)))(e.target.value)}
        />
        {opts.help ? <div className="help">{opts.help}</div> : null}
        {error ? (
          <div className="field-error" id={`${id}-err`}>
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Todas las empresas de la plataforma. Solo el administrador de la plataforma ve esta sección."
      />
      <div className="stack">
        {created ? (
          <SecretNote
            email={created.admin.email}
            password={created.password}
            onClose={() => setCreated(null)}
          >
            <button
              type="button"
              className="btn small"
              onClick={() => void enter(created.business.id)}
            >
              Entrar a {created.business.name}
            </button>
          </SecretNote>
        ) : null}
        {actionError ? <ErrorNote error={actionError} /> : null}

        <Card title="Empresas">
          {list.length === 0 ? (
            <Empty>Todavía no hay empresas.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="list-table">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Estado</th>
                    <th>Usuarios</th>
                    <th>Conversaciones del mes</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const current = b.id === me?.business.id;
                    return (
                      <tr key={b.id}>
                        <td>
                          <b>{b.name}</b>
                          <div className="muted small">
                            {b.slug} · {b.kind}
                          </div>
                        </td>
                        <td>
                          {b.active ? (
                            <span className="tag tag-done">Activa</span>
                          ) : (
                            <span className="tag tag-warn">Inactiva</span>
                          )}
                        </td>
                        <td>{formatNumber(b.users)}</td>
                        <td>
                          {formatNumber(b.conversationsThisMonth)}
                          {b.monthlyConversationQuota
                            ? ` de ${formatNumber(b.monthlyConversationQuota)}`
                            : ""}
                        </td>
                        <td>
                          <div className="actions">
                            {current ? (
                              <span className="muted small">Estás aquí</span>
                            ) : (
                              <button
                                type="button"
                                className="btn ghost small"
                                onClick={() => void enter(b.id)}
                              >
                                Entrar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Nueva empresa">
          <p className="muted">
            Se crea con valores iniciales (horario, saludo, temas sensibles) que después se ajustan
            en Configuración, y con su primer administrador.
          </p>
          <div className="form">
            {field("name", "Nombre")}
            {field("slug", "Identificador", {
              help: "Minúsculas, números y guiones. No se puede cambiar después.",
              onChange: (v) => {
                setSlugEdited(true);
                set("slug", v);
              },
            })}
            {field("kind", "Rubro", { help: "Ej.: óptica, ferretería, aseguradora." })}
            {field("whatsappNumber", "WhatsApp para derivaciones", {
              type: "tel",
              help: "Con código de país, ej.: 595981123456.",
            })}
            {field("notifyEmail", "Correo de avisos", { type: "email" })}
            {field("allowedDomains", "Dominios del sitio", {
              help: "Separados por coma, ej.: tienda.com, www.tienda.com.",
            })}
            {field("adminEmail", "Correo del primer administrador", { type: "email" })}
          </div>
          <div className="form-foot">
            <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
              Crear empresa
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
