"use client";

import { useEffect, useRef, useState } from "react";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { Texto } from "../../primitivas/Texto";
import estilos from "./PantallaDeEmitirFactura.module.css";
import { ErrorDelDetalle } from "./ErrorDelDetalle";
import {
  camposDelClienteInvalidos,
  clienteInicial,
  type ClienteEscrito,
} from "./eleccion-de-emision";
import { direccionDelDetalle } from "./filtros-del-listado";
import {
  aPuntosParaEmitir,
  puntoDeVentaElegido,
  vistaDeLosPasos,
  vistaDelCliente,
  type PuntoParaEmitir,
} from "./modelo-de-emision";
import {
  tituloDelTicket,
  vistaDeLaRevisionDeUnTicket,
  type TicketParaLaPantalla,
} from "./modelo-de-emision-de-un-ticket";
import {
  armarElPedidoDelTicket,
  type PedidoDeEmisionDeUnTicket,
} from "./pedido-de-emision-de-un-ticket";
import { PasoDeRevisar, PasoDelCliente, type CamposConError } from "./PasosDeEmision";
import { useEnvioDeLaEmision, type EmitirLaFactura } from "./useEnvioDeLaEmision.cliente";

export type PropsDePantallaDeEmitirDesdeUnTicket = Readonly<{
  ticket: TicketParaLaPantalla;
  /** Si la empresa discrimina IVA: se muestra la alícuota de cada renglón. Lo lee el servidor; la letra no se muestra (D-26). */
  discriminaIva: boolean;
  /** Los puntos de venta ACTIVOS de la sucursal DEL TICKET (el servidor los pide con esa sucursal), de menor a mayor número. */
  puntosDeVenta: readonly PuntoParaEmitir[];
  /** La acción del servidor que factura el ticket (la página pasa `emitirTicketAccion`). */
  emitir: EmitirLaFactura;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle del comprobante. */
  irA?: (ruta: string) => void;
  /** Espera entre las verificaciones automáticas de un envío incierto (para las pruebas). */
  esperaEntreVerificacionesMs?: number;
  diccionario?: DiccionarioResuelto;
}>;

const irAPorDefecto = (ruta: string): void => {
  window.location.assign(ruta);
};

/**
 * Emitir una factura desde un ticket cobrado (E1 §3.6): paso 1 «Cliente» y paso 2 «Revisar», que es la confirmación; los renglones son los
 * del ticket, de solo lectura (no hay «Renglones»: no se agregan, quitan ni editan). Misma mecánica que `PantallaDeEmitirFactura`: el estado
 * vive en el cliente, el envío es idempotente por intento y el botón se bloquea al primer toque (`useEnvioDeLaEmision`, decisión 136). Si
 * otra persona ya facturó el ticket, el servidor devuelve ese comprobante (`yaExistia`) y la pantalla va a él, igual que al terminar. Al
 * terminar abre el detalle del comprobante.
 */
export function PantallaDeEmitirDesdeUnTicket({
  ticket,
  discriminaIva,
  puntosDeVenta,
  emitir,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
  diccionario = {},
}: PropsDePantallaDeEmitirDesdeUnTicket) {
  const puntos = aPuntosParaEmitir(puntosDeVenta);
  const [paso, setPaso] = useState<1 | 2>(1);
  const [intentoElCliente, setIntentoElCliente] = useState(false);
  const [bloqueos, setBloqueos] = useState(0);
  const [cliente, setCliente] = useState<ClienteEscrito>(clienteInicial);
  const [puntoElegido, setPuntoElegido] = useState("");
  const {
    envio,
    emitir: emitirFactura,
    inesperado,
  } = useEnvioDeLaEmision<PedidoDeEmisionDeUnTicket>({
    accion: emitir,
    diccionario,
    esperaEntreVerificacionesMs,
  });

  const { estado } = envio;
  const campoRechazado = estado.tipo === "rechazado" ? (estado.rechazo.campo ?? null) : null;
  const invalidos = intentoElCliente ? camposDelClienteInvalidos(cliente) : null;
  const camposConError: CamposConError = {
    numero: campoRechazado === "receptor.documento" || invalidos?.numero === true,
    nombre: campoRechazado === "receptor.nombre" || invalidos?.nombre === true,
    domicilio: campoRechazado === "receptor.domicilio" || invalidos?.domicilio === true,
    condicion: campoRechazado === "receptor.condicionIva",
  };
  const rechazoDelCliente = [
    campoRechazado === "receptor.documento",
    campoRechazado === "receptor.nombre",
    campoRechazado === "receptor.domicilio",
    campoRechazado === "receptor.condicionIva",
  ].some(Boolean);
  const pasoVisible: 1 | 2 = rechazoDelCliente ? 1 : paso;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  const editable = !envio.enCurso && !incierto && !hecho;
  const elegido = puntoDeVentaElegido(puntos, puntoElegido);
  const pasos = vistaDeLosPasos(diccionario);
  // Los dos pasos que quedan: «Cliente» y «Revisar» (el del medio, «Renglones», no existe acá).
  const nombres = [pasos.pasos[0]?.nombre, pasos.pasos[2]?.nombre] as const;

  const comprobanteId = estado.tipo === "hecho" ? estado.valor.comprobanteId : null;
  useEffect(() => {
    if (comprobanteId !== null) irA(direccionDelDetalle(comprobanteId));
  }, [comprobanteId, irA]);

  const seccion = useRef<HTMLElement>(null);
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    seccion.current?.focus();
  }, [pasoVisible]);

  useEffect(() => {
    if (rechazoDelCliente || bloqueos > 0) {
      seccion.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [rechazoDelCliente, bloqueos]);

  function editado(): void {
    envio.reiniciar();
  }

  function seguirDelCliente(): void {
    if (Object.values(camposDelClienteInvalidos(cliente)).some(Boolean)) {
      setIntentoElCliente(true);
      setBloqueos((n) => n + 1);
      return;
    }
    editado();
    setPaso(2);
  }

  function tocarEmitir(): void {
    if (!editable || elegido === null) return;
    emitirFactura(armarElPedidoDelTicket(cliente, ticket.ticketId, elegido.id));
  }

  return (
    <div className={estilos["raiz"]}>
      <Texto>{tituloDelTicket(diccionario, ticket)}</Texto>
      <ol className={estilos["pasos"]}>
        {nombres.map((nombre, i) => (
          <li
            key={nombre}
            className={estilos["etapa"]}
            data-actual={pasoVisible === i + 1}
            aria-current={pasoVisible === i + 1 ? "step" : undefined}
          >
            <span className={estilos["numero"]}>{i + 1}</span> {nombre}
          </li>
        ))}
      </ol>

      <section
        ref={seccion}
        tabIndex={-1}
        aria-label={nombres[pasoVisible - 1]}
        className={estilos["seccion"]}
      >
        {pasoVisible === 1 ? (
          <PasoDelCliente
            vista={vistaDelCliente(diccionario, cliente)}
            cliente={cliente}
            conError={camposConError}
            alCambiar={(nuevo) => {
              if (rechazoDelCliente) setPaso(1);
              setCliente(nuevo);
              editado();
            }}
          />
        ) : (
          <>
            <PasoDeRevisar
              vista={vistaDeLaRevisionDeUnTicket(diccionario, {
                ticket,
                cliente,
                discriminaIva,
                puntos,
                puntoElegido,
              })}
              puntoElegido={puntoElegido}
              alElegirPunto={(id) => {
                setPuntoElegido(id);
                editado();
              }}
              deshabilitado={!editable}
            />
            {estado.tipo === "rechazado" ? (
              <ErrorDelDetalle error={estado.rechazo} diccionario={diccionario} />
            ) : null}
            {incierto ? (
              <Aviso
                tono="aviso"
                accion={
                  envio.enCurso ? undefined : (
                    <Boton ancho="completo" variante="secundaria" alTocar={envio.enviar}>
                      {texto(diccionario, "estado.reintentar")}
                    </Boton>
                  )
                }
              >
                <Texto>{texto(diccionario, "conexion.verificando")}</Texto>
                {inesperado === null ? null : <Texto>{texto(diccionario, inesperado.clave)}</Texto>}
                {inesperado?.referencia === undefined ? null : (
                  <Texto>
                    {texto(diccionario, "error.referencia", { referencia: inesperado.referencia })}
                  </Texto>
                )}
              </Aviso>
            ) : null}
          </>
        )}

        <div className={estilos["acciones"]}>
          {pasoVisible === 1 ? null : (
            <div className={estilos["accion"]}>
              <Boton
                ancho="completo"
                variante="secundaria"
                deshabilitado={!editable}
                alTocar={() => {
                  editado();
                  setPaso(1);
                }}
              >
                {pasos.botones.volver}
              </Boton>
            </div>
          )}
          <div className={estilos["accion"]}>
            {pasoVisible === 2 ? (
              <Boton
                ancho="completo"
                alTocar={tocarEmitir}
                enviando={envio.enCurso || hecho}
                textoEnviando={pasos.botones.enviando}
                deshabilitado={!envio.enCurso && !hecho && (elegido === null || envio.bloqueado)}
                motivo={incierto ? undefined : envio.motivoQueNoPuede}
              >
                {pasos.botones.emitir}
              </Boton>
            ) : (
              <Boton ancho="completo" alTocar={seguirDelCliente}>
                {pasos.botones.siguiente}
              </Boton>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
