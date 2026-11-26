"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  CodigoPublico,
  ErrorPublico,
  Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { MAXIMO_DE_COBROS_POR_TICKET } from "../../../../../src/primitivas/dinero/limites-de-cobro";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonIcono } from "../../componentes/BotonIcono";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { FranjaSinConexion } from "../../patrones/FranjaSinConexion.cliente";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { CONFIRMACION_VENTA_A_CERO, type LineaDeLaVenta } from "../venta/modelo-de-la-cuenta";
import estilos from "./Cobrar.module.css";
import { FilaDeCobro } from "./FilaDeCobro.cliente";
import type { PapelDeTicket } from "./PapelDelTicket.cliente";
import { ResultadoDelCobro } from "./ResultadoDelCobro.cliente";
import {
  estadoDelCobro,
  lineaDeEstado,
  medioInicial,
  nombreDelMedio,
  pagoAdicional,
  pagoNuevo,
  pedidoDeCobro,
  type CobroPreparado,
  type IdsDeLaVenta,
  type LineaDeEstado,
  type PagoEnEdicion,
  type TicketAnulado,
  type VentaCobrada,
} from "./modelo-de-cobro";
import { type TextosDeCobrar } from "./textos-de-cobrar";
import { useEnvioDelPedido } from "./useEnvioDelPedido.cliente";

export type PropsDePantallaDeCobro = Readonly<{
  /** La cuenta que armó la venta rápida: lo elegido, no lo que cuesta. */
  cuenta: readonly LineaDeLaVenta[];
  /** El total que el servidor cotizó para ESTA cuenta (`cotizarElCarrito`): es el `totalEsperado` del cobro. */
  total: Readonly<{ moneda: string; monto: string }>;
  /** Lo que la página resolvió en el servidor: la caja y las opciones, o por qué no se puede cobrar. */
  preparado: CobroPreparado;
  textos: TextosDeCobrar;
  /** Las acciones de servidor (`acciones-de-cobrar.ts`). Cobrar mueve dinero y stock: la clave de idempotencia la pone la pantalla por intento. */
  cobrar: (pedido: unknown) => Promise<Respuesta<VentaCobrada>>;
  anular: (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
  /** El papel del ticket cobrado (lectura): «Imprimir ticket» del resultado. */
  imprimir: (pedido: unknown) => Promise<Respuesta<PapelDeTicket>>;
  /** Vuelve a la cuenta (la flecha «‹» de la barra; solo antes de cobrar). */
  alVolver: () => void;
  /** Termina la venta (tras cobrar o anular): la pantalla de venta empieza una cuenta vacía. */
  alNuevaVenta: () => void;
  /** Genera un identificador. Por defecto, un UUID del navegador. Las pruebas pasan uno propio. */
  nuevoId?: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
  /** Una venta ya cerrada sin cobro (a $ 0, confirmada en la venta): la vista abre directo en el resultado. */
  ventaCobrada?: VentaCobrada | undefined;
  /** La persona confirmó en la venta una línea a $ 0: el cobro manda «VENTA_A_CERO» (y solo entonces). */
  confirmoCero?: boolean | undefined;
  /**
   * Cobrar una cuenta que YA existe (SAL-D, la mesa del salón; DEC-1039: la hoja de Cobrar se reutiliza, no se duplica): el id de la cuenta lo fija la página y el pedido no lleva líneas (las lee el servidor de la
   * cuenta). Tras cobrar se ofrece «Anular» como en el mostrador (SAL-C2; la mesa no se reabre) y el botón del resultado vuelve al salón en vez de empezar una venta nueva.
   */
  cuentaExistente?: Readonly<{ cuentaId: string }> | undefined;
  /** Vale `true` durante los primeros instantes tras abrir la vista (lo maneja la pantalla de venta): un toque en «Cobrar» entonces se ignora. */
  esperaAlAbrir?: Readonly<{ current: boolean }>;
}>;

const uuid = (): string => crypto.randomUUID();

/**
 * La vista de COBRAR (no una hoja: la maqueta la dibuja como una pantalla con «‹ Volver a la cuenta» y un pie fijo; DDD:294) (maqueta `venta-rapida-v4.html`): el total, una fila por medio de pago, «Agregar otro medio», lo que falta o el vuelto, y «Cobrar». El servidor decide todo lo que importa
 * (qué medios, cuentas y datos se ofrecen, si la caja está abierta, si el precio cambió, si los cobros cuadran): la pantalla solo ofrece lo que él ofreció y le manda el pedido. El vuelto es solo
 * presentación (`calcularVuelto`): al servidor llega lo que queda en caja. Cualquier error de negocio sale como el genérico ya aprobado.
 *
 * Idempotencia: la clave de idempotencia, el id de la cuenta, el del ejemplar y los de las líneas se generan UNA vez y se repiten en cada reintento; un doble toque es un solo envío (la guarda es
 * síncrona) y, mientras el resultado es incierto, no se puede volver ni editar: otra clave u otro pedido podría duplicar el cobro. Tras cobrar, la hoja no se cierra: solo «Nueva venta» (o
 * anular) sigue, para no cobrar dos veces la misma cuenta.
 */
export function PantallaDeCobro({
  cuenta,
  total,
  preparado,
  textos,
  cobrar,
  anular,
  imprimir,
  alVolver,
  alNuevaVenta,
  nuevoId = uuid,
  esperaEntreVerificacionesMs,
  esperaAlAbrir,
  ventaCobrada,
  confirmoCero = false,
  cuentaExistente,
}: PropsDePantallaDeCobro) {
  const medios = preparado.estado === "LISTO" ? preparado.opciones.medios : [];
  const [pagos, setPagos] = useState<readonly PagoEnEdicion[]>(() => {
    const inicial = medioInicial(medios);
    return inicial === null ? [] : [pagoNuevo(nuevoId(), inicial.id, total.monto)];
  });
  const ids = useRef<{
    cuentaId: string;
    ejemplarId: string;
    lineas: Map<string, string>;
  } | null>(null);

  const { envio, enviar, inesperado } = useEnvioDelPedido<VentaCobrada>({
    mandar: cobrar,
    textos: { sinConexion: textos.noSePuedeEnviar, verificando: textos.verificando },
    esperaEntreVerificacionesMs,
  });

  const idDelTitulo = useId();
  // Con el ticket del cliente a la vista, la barra es la suya (`TicketDelCliente`): esta no se dibuja.
  const [viendoElTicket, setViendoElTicket] = useState(false);
  const [rechazoYaVisto, setRechazoYaVisto] = useState<ErrorPublico | null>(null);
  const estado = estadoDelCobro(total, pagos, medios);
  const ventaHecha = ventaCobrada ?? (envio.estado.tipo === "hecho" ? envio.estado.valor : null);
  const hecho = ventaHecha !== null;
  // Con un envío en curso, incierto o hecho nada se edita ni se vuelve: otro pedido con la misma clave sería un error, y con otra clave podría cobrar dos veces.
  const congelado = envio.enCurso || envio.estado.tipo === "incierto" || hecho;

  const idsDeLaVenta = (): IdsDeLaVenta => {
    ids.current ??= {
      cuentaId: cuentaExistente?.cuentaId ?? nuevoId(),
      ejemplarId: nuevoId(),
      lineas: new Map(),
    };
    for (const linea of cuenta) {
      if (!ids.current.lineas.has(linea.clave)) ids.current.lineas.set(linea.clave, nuevoId());
    }
    return ids.current;
  };

  const alCobrar = () => {
    // Los primeros instantes tras abrir la vista un toque se ignora: el segundo toque de un doble toque en «Cobrar» de la venta no cobra (decisión 171).
    if (esperaAlAbrir?.current === true) return;
    if (preparado.estado !== "LISTO" || !estado.listo || estado.vuelto === null) return;
    const pedido = pedidoDeCobro({
      ids: idsDeLaVenta(),
      cajaId: preparado.cajaId,
      cuenta,
      total,
      pagos,
      medios: preparado.opciones.medios,
      vuelto: estado.vuelto,
      confirmaciones: confirmoCero ? [CONFIRMACION_VENTA_A_CERO] : undefined,
      sinLineas: cuentaExistente !== undefined,
    });
    if (pedido !== null) enviar(pedido);
  };

  const cambiarPago = (clave: string, pago: PagoEnEdicion) => {
    setPagos((previos) => previos.map((p) => (p.clave === clave ? pago : p)));
  };

  const rechazoDelCobro =
    envio.estado.tipo === "rechazado" &&
    esElRechazoGenerico(envio.estado.rechazo) &&
    envio.estado.rechazo !== rechazoYaVisto
      ? envio.estado.rechazo
      : null;
  const enResultado = (hecho && preparado.estado === "LISTO") || rechazoDelCobro !== null;
  const titulo = enResultado ? textos.resultado : textos.titulo;

  // El foco va al título al abrir la vista y cada vez que cambia de «Cobro» a «Resultado» (y al revés).
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, [enResultado, viendoElTicket]);

  const cuerpo =
    ventaHecha !== null && preparado.estado === "LISTO" ? (
      <ResultadoDelCobro
        venta={ventaHecha}
        medios={preparado.opciones.medios}
        vuelto={estado.vuelto?.vuelto ?? "0.00"}
        textos={textos}
        anular={anular}
        imprimir={imprimir}
        alCambiarLaVista={setViendoElTicket}
        alNuevaVenta={alNuevaVenta}
        deLaMesa={cuentaExistente !== undefined}
        nuevoId={nuevoId}
        esperaEntreVerificacionesMs={esperaEntreVerificacionesMs}
      />
    ) : rechazoDelCobro !== null ? (
      <div className={estilos["cuerpo"]}>
        <Aviso tono="peligro">{textos.noSePudo}</Aviso>
        <ul className={estilos["resumen"]}>
          <li>
            <strong>{textos.total}</strong>
            <strong>{formatearImporte(total.monto)}</strong>
          </li>
          {pagos.map((pago) => {
            const medio = medios.find((m) => m.id === pago.medioId);
            return (
              <li key={pago.clave}>
                <span>{medio === undefined ? "" : nombreDelMedio(medio)}</span>
                <span>{formatearImporte(pago.importe)}</span>
              </li>
            );
          })}
        </ul>
        <Boton
          ancho="completo"
          alTocar={() => {
            setRechazoYaVisto(rechazoDelCobro);
          }}
        >
          {textos.volverAlCobro}
        </Boton>
      </div>
    ) : (
      <>
        <div className={estilos["cuerpo"]}>
          <p className={estilos["total"]}>
            <span>{textos.total}</span>
            <strong data-total-del-cobro>{formatearImporte(total.monto)}</strong>
          </p>
          {preparado.estado === "LISTO"
            ? pagos.map((pago, indice) => (
                <FilaDeCobro
                  key={pago.clave}
                  pago={pago}
                  estado={
                    estado.filas[indice] ?? {
                      clave: pago.clave,
                      importeNoValido: true,
                      erroresDeDatos: {},
                    }
                  }
                  opciones={preparado.opciones}
                  textos={textos}
                  alCambiar={(nuevo) => {
                    cambiarPago(pago.clave, nuevo);
                  }}
                  alQuitar={
                    indice === 0
                      ? null
                      : () => {
                          setPagos((previos) => previos.filter((p) => p.clave !== pago.clave));
                        }
                  }
                  deshabilitado={congelado}
                />
              ))
            : null}
          {preparado.estado === "LISTO" && pagos.length < MAXIMO_DE_COBROS_POR_TICKET ? (
            <Boton
              variante="secundaria"
              deshabilitado={congelado}
              alTocar={() => {
                const otro = pagoAdicional(
                  nuevoId(),
                  preparado.opciones.medios,
                  pagos,
                  estado.vuelto?.falta ?? null,
                );
                if (otro !== null) setPagos((previos) => [...previos, otro]);
              }}
            >
              {textos.agregarOtroMedio}
            </Boton>
          ) : null}
          <LineaDelEstado linea={lineaDeEstado(estado.vuelto)} textos={textos} />
          {envio.estado.tipo === "rechazado" && !esElRechazoGenerico(envio.estado.rechazo) ? (
            <ErrorDeRespuesta error={envio.estado.rechazo} />
          ) : null}
          {inesperado === null ? null : <ErrorDeRespuesta error={inesperado} />}
        </div>
        <div className={estilos["pie"]}>
          <Boton
            ancho="completo"
            deshabilitado={preparado.estado !== "LISTO" || !estado.listo || envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
            enviando={envio.enCurso}
            textoEnviando={textos.enviando}
            alTocar={alCobrar}
          >
            {textos.cobrar}
          </Boton>
        </div>
      </>
    );

  return (
    <section
      className={estilos["vista"]}
      aria-labelledby={viendoElTicket ? undefined : idDelTitulo}
    >
      <FranjaSinConexion texto={textos.sinConexion} />
      {viendoElTicket ? null : (
        <header className={estilos["encabezado"]}>
          {enResultado ? null : (
            <BotonIcono
              etiqueta={textos.volverALaCuenta}
              icono="atras"
              deshabilitado={congelado}
              alTocar={alVolver}
            />
          )}
          <h2 id={idDelTitulo} ref={tituloRef} tabIndex={-1} className={estilos["titulo"]}>
            {titulo}
          </h2>
        </header>
      )}
      {cuerpo}
    </section>
  );
}

/** El genérico al que el servidor traduce todo rechazo de negocio del cobro (`errores-de-cobrar.ts`): el único que la maqueta dibuja como «No se pudo cobrar». */
const esElRechazoGenerico = (error: ErrorPublico): boolean =>
  error.codigo === ("CAJA_ACCION_NO_PERMITIDA" satisfies CodigoPublico);

/** Lo que falta, lo que sobra, el vuelto o «Cobro completo»: siempre con su texto, nunca solo por color. */
function LineaDelEstado({
  linea,
  textos,
}: Readonly<{ linea: LineaDeEstado; textos: TextosDeCobrar }>) {
  if (linea === null) return <p className={estilos["estado"]} role="status" />;
  const formato = (importe: string) => formatearImporte(importe);
  switch (linea.tipo) {
    case "VUELTO":
      return (
        <p className={estilos["estado"]} role="status" data-estado="vuelto">
          {textos.vuelto} {formato(linea.importe)}
        </p>
      );
    case "FALTA":
      return (
        <p className={estilos["estado"]} role="status" data-estado="falta">
          {textos.faltaCobrar} {formato(linea.importe)}
        </p>
      );
    case "SOBRA":
      return (
        <p className={estilos["estado"]} role="status" data-estado="sobra">
          {textos.sobran} {formato(linea.importe)}
        </p>
      );
    case "COMPLETO":
      return (
        <p className={estilos["estado"]} role="status" data-estado="completo">
          {textos.cobroCompleto}
        </p>
      );
  }
}
