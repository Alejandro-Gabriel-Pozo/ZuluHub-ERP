"use client";

import { useEffect, useRef } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import type { CobroPreparado, VentaCobrada } from "../cobrar/modelo-de-cobro";
import type { TextosDeCobrar } from "../cobrar/textos-de-cobrar";
import { useEnvioDelPedido } from "../cobrar/useEnvioDelPedido.cliente";
import { ConfirmarVentaACero } from "./ConfirmarVentaACero.cliente";
import {
  pedidoDeVentaACero,
  type ConfirmacionDeCero,
  type LineaDeLaVenta,
} from "./modelo-de-la-cuenta";

export type PropsDeDialogoDeVentaACero = Readonly<{
  /** Qué se confirma: `TOTAL` (se cierra sin cobro) o `LINEA` (se pasa al cobro). */
  confirmacion: Exclude<ConfirmacionDeCero, Readonly<{ tipo: "NINGUNA" }>>;
  cuenta: readonly LineaDeLaVenta[];
  /** El total que el servidor cotizó para ESTA cuenta. */
  total: Readonly<{ moneda: string; monto: string }>;
  preparado: CobroPreparado;
  textos: TextosDeCobrar;
  cobrar: (pedido: unknown) => Promise<Respuesta<VentaCobrada>>;
  alCancelar: () => void;
  /** Una línea a $ 0 confirmada: sigue el cobro normal. */
  alConfirmarLinea: () => void;
  /** La venta a $ 0 quedó registrada sin cobro: la venta muestra el resultado. */
  alCobrada: (venta: VentaCobrada) => void;
  nuevoId: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * El diálogo de la venta a $ 0 con su envío. Con una línea a $ 0 dentro de un total mayor, «Confirmar» solo avisa (`alConfirmarLinea`). Con total $ 0 manda la venta por el MISMO camino del cobro
 * (`useEnvioDelPedido`, misma acción de servidor) con `cobros` vacío y la confirmación `VENTA_A_CERO`: los ids de la venta y la clave de idempotencia se generan UNA vez por intento y se repiten en cada
 * reintento; el diálogo se monta solo mientras está abierto, así un intento nuevo nace con ids y clave nuevos. Un doble toque es un solo envío (la guarda es síncrona en el hook) y mientras el
 * resultado es incierto no se cierra. Cualquier rechazo sale con lo que ya existe (el aviso genérico del cobro).
 * Previene: dos tickets de cortesía por un doble toque o un reintento. Chequeo: `DialogoDeVentaACero.test.tsx`.
 */
export function DialogoDeVentaACero({
  confirmacion,
  cuenta,
  total,
  preparado,
  textos,
  cobrar,
  alCancelar,
  alConfirmarLinea,
  alCobrada,
  nuevoId,
  esperaEntreVerificacionesMs,
}: PropsDeDialogoDeVentaACero) {
  const ids = useRef<{ cuentaId: string; ejemplarId: string; lineas: Map<string, string> } | null>(
    null,
  );
  const { envio, enviar, inesperado } = useEnvioDelPedido<VentaCobrada>({
    mandar: cobrar,
    textos: { sinConexion: textos.noSePuedeEnviar, verificando: textos.verificando },
    esperaEntreVerificacionesMs,
  });
  const congelado = envio.enCurso || envio.estado.tipo === "incierto";

  // Registrada: avisa una sola vez; quien lo abrió desmonta el diálogo.
  const avisada = useRef(false);
  const hecha = envio.estado.tipo === "hecho" ? envio.estado.valor : null;
  useEffect(() => {
    if (hecha === null || avisada.current) return;
    avisada.current = true;
    alCobrada(hecha);
  }, [hecha, alCobrada]);

  const alConfirmar = () => {
    if (confirmacion.tipo === "LINEA") {
      alConfirmarLinea();
      return;
    }
    if (preparado.estado !== "LISTO") return;
    ids.current ??= { cuentaId: nuevoId(), ejemplarId: nuevoId(), lineas: new Map() };
    for (const linea of cuenta) {
      if (!ids.current.lineas.has(linea.clave)) ids.current.lineas.set(linea.clave, nuevoId());
    }
    const pedido = pedidoDeVentaACero({
      ids: ids.current,
      cajaId: preparado.cajaId,
      cuenta,
      total,
    });
    if (pedido !== null) enviar(pedido);
  };

  return (
    <ConfirmarVentaACero
      total={total.monto}
      lineasACero={confirmacion.lineasACero}
      textos={textos}
      alConfirmar={alConfirmar}
      alCancelar={alCancelar}
      ocupado={envio.enCurso}
      congelado={congelado}
      bloqueado={envio.bloqueado}
      motivo={envio.motivoQueNoPuede}
      avisos={
        <>
          {envio.estado.tipo === "rechazado" ? (
            <ErrorDeRespuesta error={envio.estado.rechazo} />
          ) : null}
          {inesperado === null ? null : <ErrorDeRespuesta error={inesperado} />}
        </>
      }
    />
  );
}
