"use client";

import { useRef, useState, type ReactNode } from "react";
import { useEnvioConClave, type EnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import {
  agregarValorAccion,
  corregirNombreAccion,
  desactivarValorAccion,
  reactivarValorAccion,
} from "../app/listas/acciones";
import type { PedidoDeLista, RechazoDeLista, RespuestaDeCambio } from "../logica/cambio-de-lista";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

export type CambioDeLista = Readonly<{
  envio: EnvioConClave<Readonly<{ version: number }>, RechazoDeLista>;
  /** Fija el pedido del intento y lo manda. Con un intento incierto pendiente, `envio.enviar` lo reintenta con el MISMO pedido y la misma clave. */
  pedir: (pedido: PedidoDeLista) => void;
  /** La referencia del último «inesperado» devuelto como valor, mientras el intento sigue incierto. */
  referenciaIncierta: string | undefined;
  /** La ventana del código del segundo factor: hay que pintarla en la pantalla. */
  ventana: ReactNode;
}>;

function llamar(pedido: PedidoDeLista, claveDeIdempotencia: string): Promise<RespuestaDeCambio> {
  switch (pedido.tipo) {
    case "AGREGAR":
      return agregarValorAccion({ ...pedido, claveDeIdempotencia });
    case "CORREGIR":
      return corregirNombreAccion({ ...pedido, claveDeIdempotencia });
    case "DESACTIVAR":
      return desactivarValorAccion({ ...pedido, claveDeIdempotencia });
    case "REACTIVAR":
      return reactivarValorAccion({ ...pedido, claveDeIdempotencia });
  }
}

/**
 * El envío de un cambio de lista (agregar, corregir el nombre, desactivar o reactivar). El pedido se FIJA al primer toque del intento y se reusa, con la misma
 * clave, en cada reintento: repetirlo (clic doble, red cortada) no agrega ni cambia dos veces. Si el servidor pide el segundo factor reciente, se abre la ventana
 * del código y se repite el MISMO pedido. Un `INESPERADO` devuelto como valor no es una respuesta definitiva (el cambio pudo quedar hecho): se lanza para que el
 * intento quede «incierto» y se reintente con la misma clave. Los dos textos del hook (sin conexión, verificando) quedan vacíos a propósito: la pantalla no
 * dice nada de más (interfaz sobria) y el botón apagado comunica que no se puede.
 */
export function useCambioDeLista(): CambioDeLista {
  const pedido = useRef<PedidoDeLista | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const { pedirCodigo, ventana } = useVentanaDeCodigo();

  const envio = useEnvioConClave<Readonly<{ version: number }>, RechazoDeLista>({
    textos: { sinConexion: "", verificando: "" },
    enviar: async (clave) => {
      const fijado = pedido.current;
      if (fijado === null) throw new Error("Sin pedido fijado");
      const resultado = await conSegundoFactor({
        intento: () => llamar(fijado, clave),
        pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
        pedirCodigo,
      });
      if (resultado === CANCELADO) {
        pedido.current = null;
        setReferenciaIncierta(undefined);
        return { ok: false, rechazo: { tipo: "CANCELADO" } };
      }
      if (!resultado.ok && resultado.error.tipo === "INESPERADO") {
        setReferenciaIncierta(resultado.referencia);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      pedido.current = null;
      setReferenciaIncierta(undefined);
      if (resultado.ok) return { ok: true, valor: resultado.dato };
      return {
        ok: false,
        rechazo: { tipo: "ERROR", error: resultado.error, referencia: resultado.referencia },
      };
    },
  });

  return {
    envio,
    pedir: (nuevo) => {
      if (!envio.puedeEnviar) return;
      pedido.current = nuevo;
      envio.enviar();
    },
    referenciaIncierta,
    ventana,
  };
}
