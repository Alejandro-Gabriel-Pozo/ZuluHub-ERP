"use client";

import { useRef, useState } from "react";
import type {
  ErrorPublico,
  Respuesta,
} from "../../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { useEnvioConClave, type EnvioConClave } from "../../../patrones/useEnvioConClave";
import type { PedidoDeCompra, PedidoDeRecepcion } from "./modelo-de-nueva-compra";

/** La acción del servidor que registra la compra. Recibe el pedido con la clave; devuelve la respuesta ya traducida. */
export type RegistrarLaCompra = (
  entrada: unknown,
) => Promise<Respuesta<Readonly<{ recepcionId: string; yaExistia: boolean }>>>;

type CompraHecha = Readonly<{ recepcionId: string }>;

export type EnvioDeLaCompra = Readonly<{
  envio: EnvioConClave<CompraHecha, ErrorPublico>;
  /** Manda la compra con este pedido. El pedido se FIJA con la clave en el primer envío del intento y se reusa igual en cada reintento. */
  comprar: (pedido: PedidoDeCompra | PedidoDeRecepcion) => void;
  /** El último error inesperado devuelto como valor, mientras el intento sigue incierto (para mostrar su referencia `PD-…`). */
  inesperado: ErrorPublico | null;
}>;

/**
 * El envío de «Comprar y recibir» (idempotente por intento, [01] §6.2 y §6.4), el mismo mecanismo que el de la factura (`useEnvioDeLaEmision`) con el pedido de la compra:
 *  - la clave la genera `useEnvioConClave` UNA vez por intento y se reusa en cada reintento (el servidor la usa como clave de la compra: la misma clave y el mismo contenido devuelven la misma compra);
 *  - el pedido se fija con el primer envío y se descarta recién con una respuesta DEFINITIVA (hecha o rechazada): un reintento manda la MISMA clave con el MISMO contenido, aunque la pantalla haya cambiado;
 *  - un resultado INESPERADO devuelto como valor (`ERROR_INTERNO`, `NO_DISPONIBLE`) no es definitivo (la compra pudo quedar registrada): se lanza y el intento queda «incierto» y se reintenta con la misma clave.
 * Previene: dos compras y dos entradas de stock por un doble toque o un reintento. Chequeo: `PantallaDeNuevaCompra.envio.test.tsx` (doble toque, corte de red, inesperado).
 */
export function useEnvioDeLaCompra({
  accion,
  diccionario,
  esperaEntreVerificacionesMs,
}: Readonly<{
  accion: RegistrarLaCompra;
  diccionario: DiccionarioResuelto;
  esperaEntreVerificacionesMs?: number | undefined;
}>): EnvioDeLaCompra {
  const delToque = useRef<PedidoDeCompra | PedidoDeRecepcion | null>(null);
  const fijado = useRef<PedidoDeCompra | PedidoDeRecepcion | null>(null);
  const [inesperado, setInesperado] = useState<ErrorPublico | null>(null);

  const envio = useEnvioConClave<CompraHecha, ErrorPublico>({
    textos: {
      sinConexion: texto(diccionario, "conexion.no_se_puede_enviar"),
      verificando: texto(diccionario, "conexion.verificando"),
    },
    ...(esperaEntreVerificacionesMs === undefined ? {} : { esperaEntreVerificacionesMs }),
    enviar: async (clave) => {
      fijado.current ??= delToque.current;
      const pedido = fijado.current;
      if (pedido === null) throw new Error("Sin pedido fijado");
      const respuesta = await accion({ ...pedido, clave });
      if (!respuesta.ok && respuesta.error.presentacion === "INESPERADO") {
        setInesperado(respuesta.error);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      fijado.current = null;
      setInesperado(null);
      return respuesta.ok
        ? { ok: true, valor: { recepcionId: respuesta.dato.recepcionId } }
        : { ok: false, rechazo: respuesta.error };
    },
  });

  return {
    envio,
    inesperado,
    comprar: (pedido) => {
      delToque.current = pedido;
      envio.enviar();
    },
  };
}
