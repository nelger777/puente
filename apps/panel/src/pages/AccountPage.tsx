import { PASSWORD_MIN_LENGTH, PasswordChangeSchema } from "@puente/shared";
import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { Card, PageHeader } from "../components/ui";

type Field = "currentPassword" | "newPassword" | "repeat";

export function AccountPage() {
  const { me } = useAuth();
  const [values, setValues] = useState<Record<Field, string>>({
    currentPassword: "",
    newPassword: "",
    repeat: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setSaved(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = PasswordChangeSchema.safeParse(values);
    const next: Partial<Record<Field, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= issue.message;
      }
    }
    if (values.repeat !== values.newPassword) next.repeat = "No coincide con la nueva contraseña";
    setErrors(next);
    if (!parsed.success || next.repeat) return;

    setSaving(true);
    try {
      await api.changePassword(parsed.data);
      setValues({ currentPassword: "", newPassword: "", repeat: "" });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const input = (field: Field, label: string, autoComplete: string) => (
    <div className="field">
      <label htmlFor={field}>{label}</label>
      <input
        id={field}
        type="password"
        autoComplete={autoComplete}
        value={values[field]}
        aria-invalid={!!errors[field]}
        aria-describedby={errors[field] ? `${field}-err` : undefined}
        onChange={(e) => set(field, e.target.value)}
      />
      {errors[field] ? (
        <div className="field-error" id={`${field}-err`}>
          {errors[field]}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader title="Mi cuenta" subtitle={me?.user.email} />
      <Card title="Cambiar contraseña">
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          {input("currentPassword", "Contraseña actual", "current-password")}
          {input("newPassword", "Nueva contraseña", "new-password")}
          {input("repeat", "Repite la nueva contraseña", "new-password")}
          <p className="muted small">
            Mínimo {PASSWORD_MIN_LENGTH} caracteres. Al cambiarla se cierran tus otras sesiones
            abiertas; esta sigue activa.
          </p>
          <div className="form-foot">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Guardando…" : "Cambiar contraseña"}
            </button>
            {saved ? (
              <span className="success-note" role="status">
                Contraseña cambiada
              </span>
            ) : null}
            {error ? (
              <span className="field-error" role="alert">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      </Card>
    </>
  );
}
