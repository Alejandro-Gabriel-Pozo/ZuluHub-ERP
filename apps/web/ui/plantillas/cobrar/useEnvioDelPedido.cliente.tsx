"use client";

import { useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { useEnvioConClave, type EnvioConClave } from "../../patrones/useEnvioConClave";

export type EnvioDelPedido<R> = Readonly<{
  envio: EnvioConClave<R, ErrorPublico>;
  /**
   * Manda el pedido. En el PRIMER envío del intento el pedido se FIJA junto con la clave y se reusa, igual, en cada reintento (doble toque, corte de red): la misma clave con otro pedido sería
   * `CLAVE_REUTILIZADA`, y otra clave con el mismo pedido, un segundo cobro.
   */
  enviar: (pedido: Readonly<Record<string, unknown>>) => void;
  /** El último error inesperado devuelto como valor, mientras el intento sigue incierto (para mostrar su referencia `PD-…`). */
  inesperado: ErrorPublico | null;
}>;

type Opciones<R> = Readonly<{
  /** La acción de servidor. Recibe el pedido con `claveIdempotencia`; devuelve la respuesta ya traducida. */
  mandar: (pedido: unknown) => Promise<Respuesta<R>>;
  textos: Readonly<{ sinConexion: string; verificando: string }>;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * El envío de un cobro o de una anulación (idempotente por intento, [01] §6.2 y §6.4), como `useEnvioDeLaAnulacion` de facturación pero para el mostrador:
 *  - la clave la genera `useEnvioConClave` UNA vez por intento y se reusa en cada reintento;
 *  - el pedido se fija cuando sale el primer envío (adentro de `enviar`, que solo corre si de verdad se manda) y se descarta recién con una respuesta DEFINITIVA (hecha o rechazada);
 *  - un resultado INESPERADO devuelto como valor (`ERROR_INTERNO`, `NO_DISPONIBLE`) no es definitivo (el cobro pudo quedar registrado): se lanza, sin tocar lo fijado, para que el intento quede
 *    «incierto» y se reintente con la misma clave.
 * Previene: dos cobros por un doble toque o un reintento (mueve dinero y stock). Chequeo: `PantallaDeCobro.test.tsx` (doble toque, dos envíos a la vez, corte de red, inesperado).
 */
export function useEnvioDelPedido<R>({
  mandar,
  textos,
  esperaEntreVerificacionesMs,
}: Opciones<R>): EnvioDelPedido<R> {
  const delToque = useRef<Readonly<Record<string, unknown>> | null>(null);
  const fijado = useRef<Readonly<Record<string, unknown>> | null>(null);
  const [inesperado, setInesperado] = useState<ErrorPublico | null>(null);

  const envio = useEnvioConClave<R, ErrorPublico>({
    textos,
    ...(esperaEntreVerificacionesMs === undefined ? {} : { esperaEntreVerificacionesMs }),
    enviar: async (clave) => {
      // Solo el primer envío del intento fija; los reintentos usan lo ya fijado, aunque la pantalla haya cambiado.
      fijado.current ??= delToque.current;
      const pedido = fijado.current;
      if (pedido === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y el mismo pedido.
      const respuesta = await mandar({ ...pedido, claveIdempotencia: clave });
      if (!respuesta.ok && respuesta.error.presentacion === "INESPERADO") {
        setInesperado(respuesta.error);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      fijado.current = null;
      setInesperado(null);
      return respuesta.ok
        ? { ok: true, valor: respuesta.dato }
        : { ok: false, rechazo: respuesta.error };
    },
  });

  return {
    envio,
    inesperado,
    enviar: (pedido) => {
      delToque.current = pedido;
      envio.enviar();
    },
  };
}
