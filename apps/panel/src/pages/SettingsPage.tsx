import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { useIsAdmin } from "../auth";
import { AvatarCard } from "../components/AvatarCard";
import { LlmCard } from "../components/LlmCard";
import { Card, ErrorNote, Loading, PageHeader } from "../components/ui";
import { fromForm, toForm, type FormErrors, type SettingsForm } from "../lib/settings-form";
import { useApi } from "../lib/use-api";

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function SettingsPage() {
  const isAdmin = useIsAdmin();
  const business = useApi(() => api.business(), []);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  useEffect(() => {
    if (business.data) setForm(toForm(business.data));
  }, [business.data]);

  if (business.error) return <ErrorNote error={business.error} onRetry={business.reload} />;
  if (!form) return <Loading />;

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm({ ...form, [key]: value });
    setSaved(false);
  };

  async function save() {
    if (!form) return;
    const result = fromForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    try {
      business.setData(await api.updateBusiness(result.settings));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSaving(false);
    }
  }

  function field(
    key: keyof SettingsForm,
    label: string,
    input: (props: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby"?: string;
    }) => ReactNode,
    opts: { help?: string; full?: boolean } = {},
  ) {
    const id = `f-${key}`;
    const error = errors[key];
    return (
      <div className={`field ${opts.full ? "full" : ""}`}>
        <label htmlFor={id}>{label}</label>
        {input({
          id,
          "aria-invalid": !!error,
          "aria-describedby": error ? `${id}-err` : undefined,
        })}
        {opts.help ? <div className="help">{opts.help}</div> : null}
        {error ? (
          <div className="field-error" id={`${id}-err`}>
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  const text = (key: keyof SettingsForm, type = "text") =>
    function Input(p: { id: string; "aria-invalid": boolean }) {
      return (
        <input
          {...p}
          type={type}
          value={String(form?.[key] ?? "")}
          disabled={!isAdmin}
          onChange={(e) => set(key, e.target.value as never)}
        />
      );
    };
  const area = (key: keyof SettingsForm, rows = 3) =>
    function Area(p: { id: string; "aria-invalid": boolean }) {
      return (
        <textarea
          {...p}
          rows={rows}
          value={String(form?.[key] ?? "")}
          disabled={!isAdmin}
          onChange={(e) => set(key, e.target.value as never)}
        />
      );
    };

  return (
    <>
      <PageHeader
        title="Configuración"
        subtitle={
          isAdmin
            ? "Todo lo que hace único al asistente de tu negocio."
            : "Solo un administrador puede cambiar la configuración."
        }
      />
      {business.data ? (
        <AvatarCard business={business.data} isAdmin={isAdmin} onChange={business.setData} />
      ) : null}
      <Card>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          {field("name", "Nombre del negocio", text("name"))}
          {field("kind", "Rubro", text("kind"), { help: "Ej.: óptica, ferretería" })}
          {field("botName", "Nombre del asistente", text("botName"))}
          {field(
            "voice",
            "Trato al cliente",
            (p) => (
              <select
                {...p}
                value={form.voice}
                disabled={!isAdmin}
                onChange={(e) => set("voice", e.target.value === "vos" ? "vos" : "tu")}
              >
                <option value="tu">Tú (escribe, puedes)</option>
                <option value="vos">Vos (escribí, podés)</option>
              </select>
            ),
            { help: "Cómo le habla el asistente al cliente, también en los textos del widget." },
          )}
          {field("brandColor", "Color de marca", text("brandColor"), { help: "Formato #RRGGBB" })}
          {field("whatsappNumber", "WhatsApp del equipo", text("whatsappNumber", "tel"), {
            help: "Con código de país, solo dígitos (ej.: 595981123456)",
          })}
          {field("notifyEmail", "Correo para avisos de derivación", text("notifyEmail", "email"))}
          {field("timezone", "Zona horaria", text("timezone"), { help: "Ej.: America/Asuncion" })}
          <div className="field">
            <fieldset aria-describedby={errors.days ? "f-days-err" : undefined}>
              <legend>Días de atención</legend>
              <div className="days">
                {WEEKDAYS.map((label, day) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={form.days.includes(day)}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        set(
                          "days",
                          e.target.checked
                            ? [...form.days, day]
                            : form.days.filter((d) => d !== day),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {errors.days ? (
              <div className="field-error" id="f-days-err">
                {errors.days}
              </div>
            ) : null}
          </div>
          {field("from", "Atiende desde", text("from", "time"))}
          {field("to", "Hasta", text("to", "time"))}
          {field("offHoursMessage", "Mensaje fuera de horario", area("offHoursMessage", 2), {
            full: true,
          })}
          {field("greeting", "Saludo del asistente", area("greeting", 2), { full: true })}
          {field("suggestions", "Sugerencias iniciales", area("suggestions"), {
            help: "Una por línea, máximo 3.",
          })}
          {field(
            "sensitiveTopics",
            "Temas que siempre van a una persona",
            area("sensitiveTopics"),
            {
              help: "Uno por línea (ej.: reclamo, garantía).",
            },
          )}
          {field("allowedDomains", "Dominios autorizados", area("allowedDomains"), {
            help: "Sitios donde puede funcionar el widget, uno por línea, sin https:// (ej.: tienda.com).",
            full: true,
          })}
          {field(
            "maxMessagesPerConv",
            "Mensajes por conversación",
            text("maxMessagesPerConv", "number"),
          )}
          {field("dailyMessageCap", "Tope diario de mensajes", text("dailyMessageCap", "number"))}
          <label className="check full">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!isAdmin}
              onChange={(e) => set("active", e.target.checked)}
            />
            Asistente activo en el sitio
          </label>
          {isAdmin ? (
            <div className="form-foot full">
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {saved ? (
                <span className="success-note" role="status">
                  Cambios guardados
                </span>
              ) : null}
              {Object.keys(errors).length ? (
                <span className="field-error" role="alert">
                  Revisa los campos marcados.
                </span>
              ) : null}
            </div>
          ) : null}
          {saveError ? (
            <div className="full">
              <ErrorNote error={saveError} />
            </div>
          ) : null}
        </form>
      </Card>
      {business.data && isAdmin ? (
        <LlmCard business={business.data} onChange={business.setData} />
      ) : null}
    </>
  );
}
