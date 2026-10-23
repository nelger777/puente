import { AVATAR_MIME_TYPES, type BusinessResponse } from "@puente/shared";
import { useRef, useState } from "react";
import { api } from "../api/client";
import { AVATAR_INPUT_MAX_BYTES, AVATAR_SIDE, prepareAvatar } from "../lib/resize-image";
import { Card } from "./ui";

/** Assistant picture: preview for everyone, upload/remove for admins. */
export function AvatarCard({
  business,
  isAdmin,
  onChange,
}: {
  business: BusinessResponse;
  isAdmin: boolean;
  onChange: (business: BusinessResponse) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: () => Promise<BusinessResponse>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      onChange(await action());
      setMessage({ ok: true, text: done });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      setMessage({ ok: false, text: "Usa una imagen PNG, JPG, WebP o GIF." });
      return;
    }
    if (file.size > AVATAR_INPUT_MAX_BYTES) {
      setMessage({ ok: false, text: "La imagen debe pesar hasta 5 MB." });
      return;
    }
    // Still pictures are shrunk in the browser to a light square (~30 KB); animations go as
    // they are, up to 1000 KB, so they keep moving.
    await run(async () => api.uploadAvatar(await prepareAvatar(file)), "Imagen actualizada");
  }

  const initial = (business.botName.trim()[0] ?? "A").toUpperCase();
  return (
    <Card title="Imagen del asistente" className="avatar-card">
      <div className="avatar-row">
        <span
          className="avatar-preview"
          style={{ background: business.brandColor }}
          aria-hidden="true"
        >
          {business.avatarUrl ? <img src={business.avatarUrl} alt="" /> : initial}
        </span>
        <div className="stack">
          <p className="muted small">
            Se ve en el botón y en la cabecera del chat. Puede ser una ilustración de{" "}
            {business.botName} o el logo del negocio: PNG, JPG, WebP o GIF de hasta 5 MB. Se recorta
            al centro y se reduce sola a {AVATAR_SIDE}×{AVATAR_SIDE} px. Las animaciones (GIF, WebP
            o PNG animado) se suben tal cual, de hasta 1000 KB: conviene que sean cuadradas y
            livianas. Sin imagen se muestra la inicial.
          </p>
          {isAdmin ? (
            <div className="form-foot">
              <input
                ref={input}
                id="avatar-file"
                type="file"
                accept={AVATAR_MIME_TYPES.join(",")}
                hidden
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {business.avatarUrl ? "Cambiar imagen" : "Subir imagen"}
              </button>
              {business.avatarUrl ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void run(() => api.removeAvatar(), "Imagen quitada")}
                >
                  Quitar
                </button>
              ) : null}
              {message ? (
                <span
                  className={message.ok ? "success-note" : "field-error"}
                  role={message.ok ? "status" : "alert"}
                >
                  {message.text}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
