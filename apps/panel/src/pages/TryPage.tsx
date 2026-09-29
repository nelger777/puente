import { isInHours, type BusinessResponse } from "@puente/shared";
import { ChatWidget, StateStore, type ChatApi } from "@puente/widget/embed";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Card, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useApi } from "../lib/use-api";

/** Same widget, talking to /admin/preview-chat. Customer-side actions do nothing here. */
const previewApi: ChatApi = {
  chat: (input) => api.previewChat(input),
  requestContact: () => Promise.resolve(),
  trackEvent: () => Promise.resolve(),
};

function PreviewChat({ business, session }: { business: BusinessResponse; session: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.replaceChildren();
    new ChatWidget(
      root,
      {
        businessName: business.name,
        botName: business.botName,
        voice: business.voice,
        brandColor: business.brandColor,
        greeting: business.greeting,
        suggestions: business.suggestions,
        inHours: isInHours(business.hours, business.timezone, new Date()),
      },
      previewApi,
      new StateStore(`preview:${business.id}`),
      { inline: true },
    );
  }, [business, session]);

  return <div ref={hostRef} className="try-chat" />;
}

export function TryPage() {
  const business = useApi(() => api.business(), []);
  const [session, setSession] = useState(0);

  if (business.error) return <ErrorNote error={business.error} onRetry={business.reload} />;
  const b = business.data;
  if (!b) return <Loading />;

  function restart() {
    if (!b) return;
    new StateStore(`preview:${b.id}`).clear();
    setSession((s) => s + 1);
  }

  return (
    <>
      <PageHeader
        title="Probar"
        subtitle="Conversa con tu asistente tal como lo verán tus clientes. Estas charlas no cuentan en el resumen ni en las derivaciones."
        actions={
          <button type="button" className="btn ghost" onClick={restart}>
            Nueva conversación
          </button>
        }
      />
      <div className="try">
        <PreviewChat business={b} session={session} />
        <Card title="Qué probar">
          <ul>
            <li>Preguntas que están en tu base de conocimiento.</li>
            <li>Algo que no está en la base: debería ofrecer hablar con una persona.</li>
            <li>Un tema sensible de tu lista (por ejemplo, un reclamo).</li>
            <li>El botón “Asesor” y la tarjeta de WhatsApp con el mensaje ya escrito.</li>
          </ul>
          <p className="muted small">
            En modo prueba, “Que me contacten” y el botón de WhatsApp no registran nada ni avisan al
            equipo.
          </p>
        </Card>
      </div>
    </>
  );
}
