"use client";

import { useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { MAXIMO_DE_COBROS_POR_TICKET } from "../../../../../src/primitivas/dinero/limites-de-cobro";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { FranjaSinConexion } from "../../patrones/FranjaSinConexion.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import { formatearImporte } from "../../patrones/formato-fiscal";
import type { LineaDeLaVenta } from "../venta/modelo-de-venta-rapida";
import estilos from "./Cobrar.module.css";
import { FilaDeCobro } from "./FilaDeCobro.cliente";
import { ResultadoDelCobro } from "./ResultadoDelCobro.cliente";
import {
  estadoDelCobro,
  lineaDeEstado,
  medioInicial,
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
  /** Vuelve a la cuenta (solo antes de cobrar). */
  alVolver: () => void;
  /** Termina la venta (tras cobrar o anular): la pantalla de venta empieza una cuenta vacía. */
  alNuevaVenta: () => void;
  /** Genera un identificador. Por defecto, un UUID del navegador. Las pruebas pasan uno propio. */
  nuevoId?: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

const uuid = (): string => crypto.randomUUID();

/**
 * La hoja de COBRAR (maqueta `venta-rapida-v4.html`): el total, una fila por medio de pago, «Agregar otro medio», lo que falta o el vuelto, y «Cobrar». El servidor decide todo lo que importa
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
  alVolver,
  alNuevaVenta,
  nuevoId = uuid,
  esperaEntreVerificacionesMs,
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

  const estado = estadoDelCobro(total, pagos, medios);
  const hecho = envio.estado.tipo === "hecho";
  // Con un envío en curso, incierto o hecho nada se edita ni se vuelve: otro pedido con la misma clave sería un error, y con otra clave podría cobrar dos veces.
  const congelado = envio.enCurso || envio.estado.tipo === "incierto" || hecho;

  const idsDeLaVenta = (): IdsDeLaVenta => {
    ids.current ??= { cuentaId: nuevoId(), ejemplarId: nuevoId(), lineas: new Map() };
    for (const linea of cuenta) {
      if (!ids.current.lineas.has(linea.clave)) ids.current.lineas.set(linea.clave, nuevoId());
    }
    return ids.current;
  };

  const alCobrar = () => {
    if (preparado.estado !== "LISTO" || !estado.listo || estado.vuelto === null) return;
    const pedido = pedidoDeCobro({
      ids: idsDeLaVenta(),
      cajaId: preparado.cajaId,
      cuenta,
      total,
      pagos,
      medios: preparado.opciones.medios,
      vuelto: estado.vuelto,
    });
    if (pedido !== null) enviar(pedido);
  };

  const cambiarPago = (clave: string, pago: PagoEnEdicion) => {
    setPagos((previos) => previos.map((p) => (p.clave === clave ? pago : p)));
  };

  if (hecho && preparado.estado === "LISTO") {
    return (
      <Superposicion
        abierta
        titulo={textos.cobrado}
        proposito="detalle"
        alCerrar={alNuevaVenta}
        cerrable={false}
        etiquetaDeCerrar={textos.cerrar}
      >
        <ResultadoDelCobro
          venta={envio.estado.valor}
          medios={preparado.opciones.medios}
          vuelto={estado.vuelto?.vuelto ?? "0.00"}
          textos={textos}
          anular={anular}
          alNuevaVenta={alNuevaVenta}
          nuevoId={nuevoId}
          esperaEntreVerificacionesMs={esperaEntreVerificacionesMs}
        />
      </Superposicion>
    );
  }

  return (
    <Superposicion
      abierta
      titulo={textos.cobrar}
      proposito="editar"
      alCerrar={alVolver}
      cerrable={!congelado}
      etiquetaDeCerrar={textos.cerrar}
    >
      <FranjaSinConexion texto={textos.sinConexion} />
      <div className={estilos["cuerpo"]}>
        <p className={estilos["total"]}>
          <span>{textos.total}</span>
          <strong data-total-del-cobro>{formatearImporte(total.monto)}</strong>
        </p>
        {preparado.estado === "ABRIR_LA_CAJA" ? (
          <Aviso tono="aviso">{textos.abrirLaCaja}</Aviso>
        ) : null}
        {preparado.estado === "NO_PERMITIDO" ? (
          <Aviso tono="peligro">{textos.noPermitido}</Aviso>
        ) : null}
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
        {envio.estado.tipo === "rechazado" ? (
          <ErrorDeRespuesta error={envio.estado.rechazo} />
        ) : null}
        {inesperado === null ? null : <ErrorDeRespuesta error={inesperado} />}
        <div className={estilos["acciones"]}>
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
          <Boton
            variante="secundaria"
            ancho="completo"
            deshabilitado={congelado}
            alTocar={alVolver}
          >
            {textos.volver}
          </Boton>
        </div>
      </div>
    </Superposicion>
  );
}

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
