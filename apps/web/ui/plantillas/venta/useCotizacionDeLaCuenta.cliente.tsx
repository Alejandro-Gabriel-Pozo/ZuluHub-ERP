"use client";

import { useEffect, useState } from "react";
import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import {
  pedidoDeCotizacion,
  type CotizacionDeLaVenta,
  type LineaDeLaVenta,
} from "./modelo-de-la-cuenta";

export type EstadoDeLaCotizacion =
  | Readonly<{ tipo: "SIN_CUENTA" }>
  | Readonly<{ tipo: "PENDIENTE" }>
  | Readonly<{ tipo: "LISTA"; cotizacion: CotizacionDeLaVenta }>
  | Readonly<{ tipo: "ERROR"; error: ErrorPublico }>;

/** Lo que volvió del servidor y para QUÉ cuenta: una respuesta solo vale para la cuenta que la pidió. */
type Resultado = Readonly<{
  para: readonly LineaDeLaVenta[];
  respuesta: Respuesta<CotizacionDeLaVenta>;
}>;

/**
 * Cada cambio de la cuenta se cotiza en el servidor (lectura: repetirla no cambia nada). Una respuesta solo vale para la cuenta que la pidió: si la cuenta cambió mientras tanto, se descarta
 * (nunca un total de otra cuenta a la vista). Un corte de red no deja una cotización a medias ni una vieja a la vista.
 */
export function useCotizacionDeLaCuenta(
  cuenta: readonly LineaDeLaVenta[],
  cotizar: (pedido: unknown) => Promise<Respuesta<CotizacionDeLaVenta>>,
): Readonly<{ estado: EstadoDeLaCotizacion; descartar: () => void }> {
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    if (cuenta.length === 0) return;
    let vigente = true;
    cotizar(pedidoDeCotizacion(cuenta))
      .then((respuesta) => {
        if (vigente) setResultado({ para: cuenta, respuesta });
      })
      .catch(() => {
        if (vigente) {
          setResultado({
            para: cuenta,
            respuesta: { ok: false, error: errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA") },
          });
        }
      });
    return () => {
      vigente = false;
    };
  }, [cuenta, cotizar]);

  const estado: EstadoDeLaCotizacion =
    cuenta.length === 0
      ? { tipo: "SIN_CUENTA" }
      : resultado?.para !== cuenta
        ? { tipo: "PENDIENTE" }
        : resultado.respuesta.ok
          ? { tipo: "LISTA", cotizacion: resultado.respuesta.dato }
          : { tipo: "ERROR", error: resultado.respuesta.error };

  return {
    estado,
    descartar: () => {
      setResultado(null);
    },
  };
}
