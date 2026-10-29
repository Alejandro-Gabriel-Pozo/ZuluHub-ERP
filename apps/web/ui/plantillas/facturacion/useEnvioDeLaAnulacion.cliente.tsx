"use client";

import { useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { useEnvioConClave, type EnvioConClave } from "../../patrones/useEnvioConClave";
import type { PedidoDeAnulacion } from "./pedido-de-anulacion";

/** La acción del servidor que emite la nota de crédito. Recibe el pedido con la clave; devuelve la respuesta ya traducida. */
export type EmitirLaNota = (
  entrada: unknown,
) => Promise<Respuesta<Readonly<{ comprobanteId: string }>>>;

type NotaEmitida = Readonly<{ comprobanteId: string }>;

export type EnvioDeLaAnulacion = Readonly<{
  envio: EnvioConClave<NotaEmitida, ErrorPublico>;
  /**
   * Manda la anulación con este pedido. En el PRIMER envío del intento el pedido se FIJA junto con la clave y se reusa, igual,
   * en cada reintento (doble toque, corte de red): un reintento con otros valores y la misma clave sería `FISCAL_PEDIDO_REPETIDO`;
   * con otros valores y otra clave, una segunda nota.
   */
  anular: (pedido: PedidoDeAnulacion) => void;
  /** El último error inesperado devuelto como valor, mientras el intento sigue incierto (para mostrar su referencia `PD-…`). */
  inesperado: ErrorPublico | null;
}>;

type Opciones = Readonly<{
  emitir: EmitirLaNota;
  diccionario: DiccionarioResuelto;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * El envío de la anulación (idempotente por intento, [01] §6.2 y §6.4):
 *  - la clave la genera `useEnvioConClave` UNA vez por intento y se reusa en cada reintento;
 *  - los valores se fijan cuando sale el primer pedido (acá, adentro de `enviar`, que solo corre si de verdad se manda) y se
 *    descartan recién con una respuesta DEFINITIVA (hecha o rechazada): así un reintento reenvía la MISMA clave con los MISMOS valores;
 *  - un resultado INESPERADO devuelto como valor (`ERROR_INTERNO`, `NO_DISPONIBLE`) no es una respuesta definitiva (la nota pudo
 *    quedar registrada): se lanza, sin tocar lo fijado, para que el intento quede «incierto» y se reintente con la misma clave.
 * Previene: dos notas por un doble toque o un reintento (la nota de crédito mueve dinero). Chequeo:
 * `PantallaDeAnularComprobante.test.tsx` (doble toque, dos envíos simultáneos, corte de red, inesperado).
 */
export function useEnvioDeLaAnulacion({
  emitir,
  diccionario,
  esperaEntreVerificacionesMs,
}: Opciones): EnvioDeLaAnulacion {
  const delToque = useRef<PedidoDeAnulacion | null>(null);
  const fijado = useRef<PedidoDeAnulacion | null>(null);
  const [inesperado, setInesperado] = useState<ErrorPublico | null>(null);

  const envio = useEnvioConClave<NotaEmitida, ErrorPublico>({
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
      const respuesta = await emitir({ ...pedido, clave });
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
    anular: (pedido) => {
      delToque.current = pedido;
      envio.enviar();
    },
  };
}
