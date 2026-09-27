import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth";

export function LoginPage() {
  const { me, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code !== "invalid_request"
          ? err.message
          : "Revisa el correo y la contraseña.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={(e) => void submit(e)} aria-labelledby="login-title">
        <h1 id="login-title">Puente</h1>
        <p className="muted">Ingresa al panel de tu negocio.</p>
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <p className="error-note" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-foot">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar"}
          </button>
        </div>
      </form>
    </div>
  );
}
