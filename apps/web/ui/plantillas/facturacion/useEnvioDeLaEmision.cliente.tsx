"use client";

import { useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { useEnvioConClave, type EnvioConClave } from "../../patrones/useEnvioConClave";
import type { PedidoDeEmision } from "./pedido-de-emision";

/** La acción del servidor que emite la factura. Recibe el pedido con la clave; devuelve la respuesta ya traducida. */
export type EmitirLaFactura = (
  entrada: unknown,
) => Promise<Respuesta<Readonly<{ comprobanteId: string }>>>;

type FacturaEmitida = Readonly<{ comprobanteId: string }>;

export type EnvioDeLaEmision<P extends object = PedidoDeEmision> = Readonly<{
  envio: EnvioConClave<FacturaEmitida, ErrorPublico>;
  /**
   * Manda la factura con este pedido. En el PRIMER envío del intento el pedido se FIJA junto con la clave y se reusa, igual, en cada
   * reintento (doble toque, corte de red): un reintento con otros valores y la misma clave sería `FISCAL_PEDIDO_REPETIDO`; con otros
   * valores y otra clave, una segunda factura.
   */
  emitir: (pedido: P) => void;
  /** El último error inesperado devuelto como valor, mientras el intento sigue incierto (para mostrar su referencia `PD-…`). */
  inesperado: ErrorPublico | null;
}>;

type Opciones = Readonly<{
  accion: EmitirLaFactura;
  diccionario: DiccionarioResuelto;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * El envío de la factura (idempotente por intento, [01] §6.2 y §6.4). Es el mismo mecanismo que el de la anulación
 * (`useEnvioDeLaAnulacion`), con el pedido de la factura:
 *  - la clave la genera `useEnvioConClave` UNA vez por intento y se reusa en cada reintento (el servidor la usa como id del comprobante);
 *  - los valores se fijan cuando sale el primer pedido y se descartan recién con una respuesta DEFINITIVA (hecha o rechazada): un
 *    reintento reenvía la MISMA clave con los MISMOS valores;
 *  - un resultado INESPERADO devuelto como valor (`ERROR_INTERNO`, `NO_DISPONIBLE`) no es una respuesta definitiva (la factura pudo
 *    quedar registrada): se lanza, sin tocar lo fijado, para que el intento quede «incierto» y se reintente con la misma clave.
 * Previene: dos facturas por un doble toque o un reintento (una factura emitida no se borra, se anula). Chequeo:
 * `PantallaDeEmitirFactura.envio.test.tsx` (doble toque, dos envíos simultáneos, corte de red, inesperado).
 */
export function useEnvioDeLaEmision<P extends object = PedidoDeEmision>({
  accion,
  diccionario,
  esperaEntreVerificacionesMs,
}: Opciones): EnvioDeLaEmision<P> {
  const delToque = useRef<P | null>(null);
  const fijado = useRef<P | null>(null);
  const [inesperado, setInesperado] = useState<ErrorPublico | null>(null);

  const envio = useEnvioConClave<FacturaEmitida, ErrorPublico>({
    textos: {
      sinConexion: texto(diccionario, "conexion.no_se_puede_enviar"),
      verificando: texto(diccionario, "conexion.verificando"),
    },
    ...(esperaEntreVerificacionesMs === undefined ? {} : { esperaEntreVerificacionesMs }),
    enviar: async (clave) => {
      // Solo el primer envío del intento fija; los reintentos usan lo ya fijado, aunque la pantalla haya cambiado.
      fijado.current ??= delToque.current;
      const pedido = fijado.current;
      if (pedido === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y los mismos valores.
      const respuesta = await accion({ ...pedido, clave });
      if (!respuesta.ok && respuesta.error.presentacion === "INESPERADO") {
        setInesperado(respuesta.error);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      fijado.current = null;
      setInesperado(null);
      return respuesta.ok
        ? { ok: true, valor: { comprobanteId: respuesta.dato.comprobanteId } }
        : { ok: false, rechazo: respuesta.error };
    },
  });

  return {
    envio,
    inesperado,
    emitir: (pedido) => {
      delToque.current = pedido;
      envio.enviar();
    },
  };
}
