"use client";

import { useRef, useState, type ReactNode } from "react";
import { useEnvioConClave, type EnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import { cambiarPlanAccion } from "../app/empresas/[id]/plan/acciones";
import type { Fijada, Hecho, Rechazo } from "../logica/cambio-de-plan";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

export type EnvioDelCambio = Readonly<{
  envio: EnvioConClave<Hecho, Rechazo>;
  /** Lo fijado para el intento en curso, para pintarlo (el ref de adentro no se lee al renderizar). */
  fijada: Fijada | null;
  fijar: (valores: Fijada) => void;
  /** La referencia del último «inesperado» devuelto como valor, mientras el intento sigue incierto. */
  referenciaIncierta: string | undefined;
  ventana: ReactNode;
}>;

/**
 * El envío del cambio de plan. Los valores se FIJAN con `fijar` al primer toque del intento y se reusan, con la
 * misma clave, en cada reintento. Un `INESPERADO` devuelto como valor no es una respuesta definitiva (puede que
 * el cambio haya quedado registrado): se lanza, sin tocar lo fijado, para que el intento quede «incierto».
 */
export function useEnvioDelCambio(tenantId: string): EnvioDelCambio {
  const ref = useRef<Fijada | null>(null);
  const [fijada, setFijada] = useState<Fijada | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const { pedirCodigo, ventana } = useVentanaDeCodigo();

  const poner = (valores: Fijada | null) => {
    ref.current = valores;
    setFijada(valores);
  };

  const envio = useEnvioConClave<Hecho, Rechazo>({
    textos: {
      sinConexion: "Sin conexión. Cuando vuelva, podés cambiar el plan.",
      verificando: "Verificando si el cambio de plan quedó registrado…",
    },
    enviar: async (clave) => {
      const base = ref.current;
      if (base === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y los mismos valores.
      const resultado = await conSegundoFactor({
        intento: () => cambiarPlanAccion({ ...base, claveDeIdempotencia: clave, tenantId }),
        pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
        pedirCodigo,
      });
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
      if (resultado.ok) {
        return {
          ok: true,
          valor: { yaExistia: resultado.dato.yaExistia, vigenteDesde: base.vigenteDesde },
        };
      }
      return {
        ok: false,
        rechazo: { tipo: "ERROR", error: resultado.error, referencia: resultado.referencia },
      };
    },
  });

  return { envio, fijada, fijar: poner, referenciaIncierta, ventana };
}
