"use client";

import { useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { AnularElTicket } from "./AnularElTicket.cliente";
import estilos from "./Cobrar.module.css";
import type { PapelDeTicket } from "./PapelDelTicket.cliente";
import { TicketDelCliente } from "./TicketDelCliente.cliente";
import {
  esVentaACero,
  resumenDelCobro,
  type MedioParaCobrar,
  type TicketAnulado,
  type VentaCobrada,
} from "./modelo-de-cobro";
import { esImporteEnCero } from "../venta/modelo-de-la-cuenta";
import { rotuloDelTicket, type TextosDeCobrar } from "./textos-de-cobrar";

export type PropsDeResultadoDelCobro = Readonly<{
  venta: VentaCobrada;
  medios: readonly MedioParaCobrar[];
  /** El vuelto que se calculó al cobrar (`"0.00"` si no hubo): es presentación, no está en el servidor. */
  vuelto: string;
  textos: TextosDeCobrar;
  anular: (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
  /** El papel del ticket cobrado, armado por el servidor (lectura: repetirla no cambia nada). */
  imprimir: (pedido: unknown) => Promise<Respuesta<PapelDeTicket>>;
  /** Avisa a la pantalla si se está viendo el ticket del cliente (que trae su propia barra) o el resultado. */
  alCambiarLaVista: (viendoElTicket: boolean) => void;
  alNuevaVenta: () => void;
  /** El resultado de cobrar una mesa (SAL-D y SAL-C2): lleva «Anular» como el del mostrador (la mesa NO se reabre: queda libre) y el último botón es «Volver» (al salón), no «Nueva venta». */
  deLaMesa?: boolean | undefined;
  /** La venta quedó cargada a la cuenta de un cliente (CC-5 B1b): no entró plata a la caja, así que el aviso es solo el número del ticket (sin «Cobrado»), como el de una venta a $ 0. «Imprimir» y «Anular» siguen. */
  aCuenta?: boolean | undefined;
  /** Solo al cobrar una cuenta de una mesa dividida (SAL-E2): el botón dice «Volver a las cuentas» y, si era la última, el resultado avisa «Mesa cobrada» (la mesa quedó libre). */
  deLaDivision?: Readonly<{ rotuloDeVolver: string; mesaCobrada: string | null }> | undefined;
  nuevoId: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * El resultado de cobrar (maqueta `venta-rapida-v4.html`, estado `ok`): «Cobrado», el número del ticket, cada medio con su importe tal como quedó en caja y el vuelto, con «Anular» y «Nueva venta».
 * No repite los datos de la tarjeta (decisión del dueño, DDD:175). «Anular» abre un cuadro de diálogo con el motivo (`AnularElTicket`). «Imprimir ticket» (solo con la venta cobrada: tras anular no está) pide el papel al
 * servidor y muestra «Ticket del cliente» EN LUGAR del resultado (`TicketDelCliente`); «‹» vuelve al resultado tal como estaba. Es una lectura: un doble toque pide el papel una sola vez (guarda síncrona) y un reintento
 * lee lo mismo; si falla, el error sale bajo los botones y se puede volver a tocar. Nunca se muestra un ticket a medias.
 */
export function ResultadoDelCobro({
  venta,
  medios,
  vuelto,
  textos,
  anular,
  imprimir,
  alCambiarLaVista,
  alNuevaVenta,
  deLaMesa = false,
  aCuenta = false,
  deLaDivision,
  nuevoId,
  esperaEntreVerificacionesMs,
}: PropsDeResultadoDelCobro) {
  const [anulando, setAnulando] = useState(false);
  const [anulado, setAnulado] = useState<Readonly<{
    ticket: TicketAnulado;
    motivo: string;
  }> | null>(null);
  const [papel, setPapel] = useState<PapelDeTicket | null>(null);
  const [pidiendoElPapel, setPidiendoElPapel] = useState(false);
  const [errorDelPapel, setErrorDelPapel] = useState<ErrorPublico | null>(null);
  // Guarda síncrona: el segundo toque de un doble toque llega antes de que React repinte el botón ocupado.
  const yaPidiendo = useRef(false);
  const alImprimirTicket = async () => {
    if (yaPidiendo.current) return;
    yaPidiendo.current = true;
    setPidiendoElPapel(true);
    setErrorDelPapel(null);
    try {
      const respuesta = await imprimir({ ticketId: venta.ticketId });
      if (respuesta.ok) {
        setPapel(respuesta.dato);
        alCambiarLaVista(true);
      } else {
        setErrorDelPapel(respuesta.error);
      }
    } finally {
      yaPidiendo.current = false;
      setPidiendoElPapel(false);
    }
  };
  // El último botón: «Nueva venta» en el mostrador; «Volver» (o «Volver a las cuentas») en una mesa, que anulada NO se reabre.
  const rotuloFinal =
    deLaDivision?.rotuloDeVolver ?? (deLaMesa ? textos.volver : textos.nuevaVenta);
  if (anulado !== null) {
    return (
      <div className={estilos["cuerpo"]}>
        <Aviso tono="info" titulo={textos.anulado}>
          <span data-ticket>{rotuloDelTicket(anulado.ticket.numero)}</span>
          <span data-motivo-anulado>{anulado.motivo}</span>
        </Aviso>
        <Boton ancho="completo" alTocar={alNuevaVenta}>
          {rotuloFinal}
        </Boton>
      </div>
    );
  }
  if (papel !== null) {
    return (
      <TicketDelCliente
        papel={papel}
        textos={textos}
        alVolver={() => {
          setPapel(null);
          alCambiarLaVista(false);
        }}
      />
    );
  }
  const hayVuelto = !esImporteEnCero(vuelto);
  // Venta a $ 0 (maqueta `venta-rapida-v4.html:884-887`): franja informativa solo con el número, sin «Cobrado», sin medios ni vuelto y sin «Imprimir ticket».
  const aCero = esVentaACero(venta);
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
      <Aviso
        tono={aCero || aCuenta ? "info" : "exito"}
        {...(aCero || aCuenta ? {} : { titulo: textos.cobrado })}
      >
        <span data-ticket>{rotuloDelTicket(venta.numero)}</span>
      </Aviso>
      {deLaDivision?.mesaCobrada == null ? null : (
        <Aviso tono="info">{deLaDivision.mesaCobrada}</Aviso>
      )}
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
        {aCero ? null : (
          <Boton
            variante="secundaria"
            ancho="completo"
            enviando={pidiendoElPapel}
            alTocar={() => {
              void alImprimirTicket();
            }}
          >
            {textos.imprimirTicket}
          </Boton>
        )}
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
          {rotuloFinal}
        </Boton>
      </div>
      {errorDelPapel === null ? null : <ErrorDeRespuesta error={errorDelPapel} />}
    </div>
  );
}
