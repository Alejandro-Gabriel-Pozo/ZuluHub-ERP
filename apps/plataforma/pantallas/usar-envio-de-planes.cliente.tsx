"use client";

import { useRef, useState, type ReactNode } from "react";
import { useEnvioConClave, type EnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

type RechazoDePlanes =
  | { tipo: "CANCELADO" }
  | { tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined };

export type OpcionesDeEnvioDePlanes<F, D> = Readonly<{
  /** La acción del servidor: recibe lo fijado más la clave del intento. */
  accion: (entrada: F & { claveDeIdempotencia: string }) => Promise<RespuestaDeConsola<D>>;
  textos: Readonly<{ sinConexion: string; verificando: string }>;
  /** Publicar pide el segundo factor reciente: la pantalla pide el código y repite el MISMO intento. */
  segundoFactor?: boolean;
}>;

export type EnvioDePlanes<F, D> = Readonly<{
  envio: EnvioConClave<D, RechazoDePlanes>;
  /** Lo fijado para el intento en curso (null si no hay). */
  fijada: F | null;
  /** Fija los valores al primer toque del intento; se reusan, con la misma clave, en cada reintento. */
  fijar: (valores: F) => void;
  /** La referencia del último «inesperado» devuelto como valor, mientras el intento sigue incierto. */
  referenciaIncierta: string | undefined;
  ventana: ReactNode;
}>;

/**
 * El envío de una acción de Planes (crear, guardar borrador, publicar): una clave de idempotencia por INTENTO (la pone `useEnvioConClave`) y los valores fijados al primer toque, así un doble toque o
 * un corte de red repiten el mismo pedido y el servidor devuelve lo mismo sin escribir dos veces. Un `INESPERADO` devuelto como valor no es una respuesta definitiva (puede que haya quedado registrado):
 * se lanza para que el intento quede «incierto» y se reintente con la misma clave.
 */
export function useEnvioDePlanes<F, D>(
  opciones: OpcionesDeEnvioDePlanes<F, D>,
): EnvioDePlanes<F, D> {
  const ref = useRef<F | null>(null);
  const [fijada, setFijada] = useState<F | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const { pedirCodigo, ventana } = useVentanaDeCodigo();
  const poner = (valores: F | null) => {
    ref.current = valores;
    setFijada(valores);
  };

  const envio = useEnvioConClave<D, RechazoDePlanes>({
    textos: opciones.textos,
    enviar: async (clave) => {
      const base = ref.current;
      if (base === null) throw new Error("Sin pedido fijado");
      const intento = () => opciones.accion({ ...base, claveDeIdempotencia: clave });
      const resultado =
        opciones.segundoFactor === true
          ? await conSegundoFactor({
              intento,
              pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
              pedirCodigo,
            })
          : await intento();
      if (resultado === CANCELADO) {
        poner(null);
        setReferenciaIncierta(undefined);
        return { ok: false, rechazo: { tipo: "CANCELADO" } };
      }
      if (!resultado.ok && resultado.error.tipo === "INESPERADO") {
        setReferenciaIncierta(resultado.referencia);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      poner(null);
      setReferenciaIncierta(undefined);
      if (resultado.ok) return { ok: true, valor: resultado.dato };
      return {
        ok: false,
        rechazo: { tipo: "ERROR", error: resultado.error, referencia: resultado.referencia },
      };
    },
  });
  return { envio, fijada, fijar: poner, referenciaIncierta, ventana };
}
