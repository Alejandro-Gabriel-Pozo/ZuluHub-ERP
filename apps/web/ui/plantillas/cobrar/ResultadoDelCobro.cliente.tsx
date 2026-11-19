"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { AnularElTicket } from "./AnularElTicket.cliente";
import estilos from "./Cobrar.module.css";
import {
  resumenDelCobro,
  type MedioParaCobrar,
  type TicketAnulado,
  type VentaCobrada,
} from "./modelo-de-cobro";
import { rotuloDelTicket, type TextosDeCobrar } from "./textos-de-cobrar";

export type PropsDeResultadoDelCobro = Readonly<{
  venta: VentaCobrada;
  medios: readonly MedioParaCobrar[];
  /** El vuelto que se calculó al cobrar (`"0.00"` si no hubo): es presentación, no está en el servidor. */
  vuelto: string;
  textos: TextosDeCobrar;
  anular: (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
  alNuevaVenta: () => void;
  nuevoId: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * El resultado de cobrar (maqueta `venta-rapida-v4.html`, estado `ok`): «Cobrado», el número del ticket, cada medio con su importe tal como quedó en caja y el vuelto, con «Anular» y «Nueva venta».
 * No repite los datos de la tarjeta (decisión del dueño, DDD:175). «Anular» abre un cuadro de diálogo con el motivo (`AnularElTicket`); «Imprimir ticket» todavía no está: depende del papel del ticket (K6) y
 * lo que no está declarado no se ofrece.
 */
export function ResultadoDelCobro({
  venta,
  medios,
  vuelto,
  textos,
  anular,
  alNuevaVenta,
  nuevoId,
  esperaEntreVerificacionesMs,
}: PropsDeResultadoDelCobro) {
  const [anulando, setAnulando] = useState(false);
  const [anulado, setAnulado] = useState<Readonly<{
    ticket: TicketAnulado;
    motivo: string;
  }> | null>(null);
  if (anulado !== null) {
    return (
      <div className={estilos["cuerpo"]}>
        <Aviso tono="info" titulo={textos.anulado}>
          <span data-ticket>{rotuloDelTicket(anulado.ticket.numero)}</span>
          <span data-motivo-anulado>{anulado.motivo}</span>
        </Aviso>
        <Boton ancho="completo" alTocar={alNuevaVenta}>
          {textos.nuevaVenta}
        </Boton>
      </div>
    );
  }
  const hayVuelto = !/^0+(\.0+)?$/.test(vuelto);
  return (
    <div className={estilos["cuerpo"]}>
      {anulando ? (
        <AnularElTicket
          venta={venta}
          textos={textos}
          anular={anular}
          alCancelar={() => {
            setAnulando(false);
          }}
          alAnulado={(ticket, motivo) => {
            setAnulado({ ticket, motivo });
          }}
          nuevoId={nuevoId}
          esperaEntreVerificacionesMs={esperaEntreVerificacionesMs}
        />
      ) : null}
      <Aviso tono="exito" titulo={textos.cobrado}>
        <span data-ticket>{rotuloDelTicket(venta.numero)}</span>
      </Aviso>
      <ul className={estilos["resumen"]}>
        <li>
          <strong>{textos.total}</strong>
          <strong>{formatearImporte(venta.total.monto)}</strong>
        </li>
        {resumenDelCobro(venta, medios).map((linea, indice) => (
          // El orden de los cobros es el del servidor y no cambia: la posición identifica la línea.
          <li key={indice}>
            <span>{linea.rotulo}</span>
            <span>{formatearImporte(linea.monto)}</span>
          </li>
        ))}
        {hayVuelto ? (
          <li>
            <span>{textos.vuelto}</span>
            <span>{formatearImporte(vuelto)}</span>
          </li>
        ) : null}
      </ul>
      <div className={estilos["acciones"]}>
        <Boton
          variante="secundaria"
          ancho="completo"
          alTocar={() => {
            setAnulando(true);
          }}
        >
          {textos.anular}
        </Boton>
        <Boton ancho="completo" alTocar={alNuevaVenta}>
          {textos.nuevaVenta}
        </Boton>
      </div>
    </div>
  );
}
