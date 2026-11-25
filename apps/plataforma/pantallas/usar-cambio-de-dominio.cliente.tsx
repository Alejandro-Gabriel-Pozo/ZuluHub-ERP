"use client";

import { useRef, useState, type ReactNode } from "react";
import { useEnvioConClave, type EnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import {
  activarDominioAccion,
  agregarDominioAccion,
  desactivarDominioAccion,
  retirarDominioAccion,
  verificarDominioAccion,
} from "../app/dominios/acciones";
import type {
  PedidoDeDominio,
  RechazoDeDominio,
  RespuestaDeCambioDeDominio,
} from "../logica/cambio-de-dominio";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

type Resultado = Readonly<{ dominioId: string; yaEstaba: boolean }>;

export type CambioDeDominio = Readonly<{
  envio: EnvioConClave<Resultado, RechazoDeDominio>;
  /** Fija el pedido del intento y lo manda; devuelve `false` (y no hace nada) si ya hay uno fijado. Con un intento incierto pendiente, `envio.enviar` lo reintenta con el MISMO pedido y la misma clave. */
  pedir: (pedido: PedidoDeDominio) => boolean;
  /** La referencia del último «inesperado» devuelto como valor, mientras el intento sigue incierto. */
  referenciaIncierta: string | undefined;
  /** La ventana del código del segundo factor: hay que pintarla en la pantalla. */
  ventana: ReactNode;
}>;

function llamar(
  pedido: PedidoDeDominio,
  claveDeIdempotencia: string,
): Promise<RespuestaDeCambioDeDominio> {
  switch (pedido.tipo) {
    case "AGREGAR":
      return agregarDominioAccion({ ...pedido, claveDeIdempotencia });
    case "VERIFICAR":
      return verificarDominioAccion({ dominioId: pedido.dominioId, claveDeIdempotencia });
    case "ACTIVAR":
      return activarDominioAccion({ dominioId: pedido.dominioId, claveDeIdempotencia });
    case "DESACTIVAR":
      return desactivarDominioAccion({ dominioId: pedido.dominioId, claveDeIdempotencia });
    case "RETIRAR":
      return retirarDominioAccion({ ...pedido, claveDeIdempotencia });
  }
}

/**
 * El envío de un cambio de dominio (alta, verificar, activar, desactivar o retirar). El pedido se FIJA al primer toque del intento y se reusa, con la misma clave, en
 * cada reintento: repetirlo (clic doble, red cortada) no registra ni cambia dos veces. Si el servidor pide el segundo factor reciente, se abre la ventana del código y se
 * repite el MISMO pedido. Un `INESPERADO` devuelto como valor no es una respuesta definitiva (el cambio pudo quedar hecho): se lanza para que el intento quede «incierto» y
 * se reintente con la misma clave. Los dos textos del hook (sin conexión, verificando) quedan vacíos a propósito: la pantalla no dice nada de más (interfaz sobria).
 */
export function useCambioDeDominio(): CambioDeDominio {
  const pedido = useRef<PedidoDeDominio | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const { pedirCodigo, ventana } = useVentanaDeCodigo();

  const envio = useEnvioConClave<Resultado, RechazoDeDominio>({
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
      // Con un pedido ya fijado (en vuelo o incierto) otro no lo pisa: el reintento usa el MISMO pedido y la misma clave.
      if (pedido.current !== null) return false;
      if (!envio.puedeEnviar) return false;
      pedido.current = nuevo;
      envio.enviar();
      return true;
    },
    referenciaIncierta,
    ventana,
  };
}
