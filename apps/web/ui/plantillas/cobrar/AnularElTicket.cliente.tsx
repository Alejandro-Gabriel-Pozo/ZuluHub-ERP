"use client";

import { useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import estilos from "./Cobrar.module.css";
import { type TicketAnulado, type VentaCobrada } from "./modelo-de-cobro";
import { rotuloDelTicket, type TextosDeCobrar } from "./textos-de-cobrar";
import { useEnvioDelPedido } from "./useEnvioDelPedido.cliente";

export type PropsDeAnularElTicket = Readonly<{
  venta: Pick<VentaCobrada, "ticketId" | "ejemplarId" | "numero">;
  textos: TextosDeCobrar;
  anular: (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
  alCancelar: () => void;
  alNuevaVenta: () => void;
  nuevoId: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * Anular el ticket recién cobrado (decisión 172: «anular todo», con motivo; maqueta `venta-rapida-v4.html`). El motivo es obligatorio en la pantalla («Escribí el motivo») y el servidor decide el
 * resto (su largo, que el día siga abierto, que el ticket no tenga comprobante vigente): cualquier rechazo sale como el genérico. Idempotente por intento: el id del ejemplar de anulación se genera
 * UNA vez y se repite con la clave en cada reintento; un doble toque es una sola anulación. Anulado, queda «Anulado», el número, el motivo y «Nueva venta».
 */
export function AnularElTicket({
  venta,
  textos,
  anular,
  alCancelar,
  alNuevaVenta,
  nuevoId,
  esperaEntreVerificacionesMs,
}: PropsDeAnularElTicket) {
  const [motivo, setMotivo] = useState("");
  const [sinMotivo, setSinMotivo] = useState(false);
  const ejemplarNuevoId = useRef<string | null>(null);
  const { envio, enviar, inesperado } = useEnvioDelPedido<TicketAnulado>({
    mandar: anular,
    textos: { sinConexion: textos.noSePuedeEnviar, verificando: textos.verificando },
    esperaEntreVerificacionesMs,
  });
  const congelado = envio.enCurso || envio.estado.tipo === "incierto";

  if (envio.estado.tipo === "hecho") {
    return (
      <div className={estilos["cuerpo"]}>
        <Aviso tono="info" titulo={textos.anulado}>
          <span data-ticket>{rotuloDelTicket(envio.estado.valor.numero)}</span>
          <span data-motivo-anulado>{motivo.trim()}</span>
        </Aviso>
        <Boton ancho="completo" alTocar={alNuevaVenta}>
          {textos.nuevaVenta}
        </Boton>
      </div>
    );
  }

  const alAnular = () => {
    const escrito = motivo.trim();
    if (escrito === "") {
      setSinMotivo(true);
      return;
    }
    ejemplarNuevoId.current ??= nuevoId();
    enviar({
      ticketId: venta.ticketId,
      ejemplarBaseId: venta.ejemplarId,
      ejemplarNuevoId: ejemplarNuevoId.current,
      motivo: escrito,
    });
  };

  return (
    <div className={estilos["cuerpo"]}>
      <Campo
        dato="motivo-de-anulacion"
        etiqueta={textos.motivo}
        autoComplete="off"
        valor={motivo}
        alCambiar={(v) => {
          setMotivo(v);
          setSinMotivo(false);
        }}
        error={sinMotivo ? textos.motivoObligatorio : undefined}
        deshabilitado={congelado}
      />
      {envio.estado.tipo === "rechazado" ? <ErrorDeRespuesta error={envio.estado.rechazo} /> : null}
      {inesperado === null ? null : <ErrorDeRespuesta error={inesperado} />}
      <div className={estilos["acciones"]}>
        <Boton
          variante="peligro"
          ancho="completo"
          deshabilitado={envio.bloqueado}
          motivo={envio.motivoQueNoPuede}
          enviando={envio.enCurso}
          textoEnviando={textos.enviando}
          alTocar={alAnular}
        >
          {textos.anular}
        </Boton>
        <Boton
          variante="secundaria"
          ancho="completo"
          deshabilitado={congelado}
          alTocar={alCancelar}
        >
          {textos.cancelar}
        </Boton>
      </div>
    </div>
  );
}
