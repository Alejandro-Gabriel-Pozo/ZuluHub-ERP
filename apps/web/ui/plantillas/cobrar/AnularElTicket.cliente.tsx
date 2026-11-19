"use client";

import { useEffect, useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import estilos from "./Cobrar.module.css";
import { type TicketAnulado, type VentaCobrada } from "./modelo-de-cobro";
import { type TextosDeCobrar } from "./textos-de-cobrar";
import { useEnvioDelPedido } from "./useEnvioDelPedido.cliente";

export type PropsDeAnularElTicket = Readonly<{
  venta: Pick<VentaCobrada, "ticketId" | "ejemplarId" | "numero">;
  textos: TextosDeCobrar;
  anular: (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
  alCancelar: () => void;
  /** El ticket quedó anulado: la vista «Resultado» muestra «Anulado», el número, el motivo y «Nueva venta». */
  alAnulado: (ticket: TicketAnulado, motivo: string) => void;
  nuevoId: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * Anular el ticket recién cobrado (decisión 172: «anular todo», con motivo; maqueta `venta-rapida-v4.html`). El motivo es obligatorio en la pantalla («Escribí el motivo») y el servidor decide el
 * resto (su largo, que el día siga abierto, que el ticket no tenga comprobante vigente): cualquier rechazo sale como el genérico. Idempotente por intento: el id del ejemplar de anulación se genera
 * UNA vez y se repite con la clave en cada reintento; un doble toque es una sola anulación. Es un cuadro de diálogo (`Superposicion`, propósito «confirmar»; maqueta `vDlg`, DDD:294): mientras el envío corre o
 * está incierto no se puede cerrar. Anulado, avisa a quien lo abrió (`alAnulado`) y la vista «Resultado» muestra el resto.
 */
export function AnularElTicket({
  venta,
  textos,
  anular,
  alCancelar,
  alAnulado,
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

  // Anulado: avisa una sola vez y el cuadro se cierra (lo desmonta quien lo abrió).
  const avisado = useRef(false);
  const anulado = envio.estado.tipo === "hecho" ? envio.estado.valor : null;
  useEffect(() => {
    if (anulado === null || avisado.current) return;
    avisado.current = true;
    alAnulado(anulado, motivo.trim());
  }, [anulado, alAnulado, motivo]);

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
    <Superposicion
      abierta
      titulo={textos.anular}
      proposito="confirmar"
      alCerrar={alCancelar}
      cerrable={!congelado}
      etiquetaDeCerrar={textos.cerrar}
    >
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
        {envio.estado.tipo === "rechazado" ? (
          <ErrorDeRespuesta error={envio.estado.rechazo} />
        ) : null}
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
    </Superposicion>
  );
}
