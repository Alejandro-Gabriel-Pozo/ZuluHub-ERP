import { useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { useEnvioConClave, type EnvioConClave } from "../../patrones/useEnvioConClave";

/**
 * El envío de un pedido de Configuración fiscal sobre `useEnvioConClave`: el pedido se FIJA entero en el primer toque del intento y
 * se reenvía idéntico en cada reintento (red cortada, respuesta que no llegó). Si cambiara entre el primer envío y el reintento, el
 * servidor podría registrar dos cosas distintas: un alta con otro número, un cambio de ambiente con otra versión.
 *
 * Lo que evita el duplicado no es la clave del hook sino la que lleva el pedido: el `id` del punto de venta y del domicilio nuevos
 * (alta), o el hecho de que activar, desactivar y cambiar de ambiente son idempotentes (`yaEstaba`).
 *
 * Un error INESPERADO devuelto como valor no es una respuesta definitiva (la acción puede haber quedado registrada): se lanza, sin
 * tocar lo fijado, para que el intento quede incierto y se reintente igual. Previene: reenviar con valores nuevos algo que ya se hizo.
 * Chequeo: `useEnvioFijado.test.tsx` (con la mutación manual descripta ahí).
 */
export type EnvioFijado<P, D> = Readonly<{
  envio: EnvioConClave<D, ErrorPublico>;
  /** Fija el pedido (si no hay uno en marcha) y lo envía; con un intento incierto pendiente, reenvía el fijado y descarta `pedido`. */
  enviarCon: (pedido: P) => void;
  /** El pedido del intento en curso, para pintar los valores fijados (el ref de adentro no se lee al renderizar). */
  fijado: P | null;
  /** La referencia del último INESPERADO devuelto como valor, mientras el intento sigue incierto. */
  referenciaIncierta: string | undefined;
}>;

export function useEnvioFijado<P, D>(
  accion: (pedido: P) => Promise<Respuesta<D>>,
): EnvioFijado<P, D> {
  const ref = useRef<P | null>(null);
  const [fijado, setFijado] = useState<P | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);

  const envio = useEnvioConClave<D, ErrorPublico>({
    textos: {
      sinConexion: texto({}, "conexion.no_se_puede_enviar"),
      verificando: texto({}, "conexion.verificando"),
    },
    enviar: async () => {
      const pedido = ref.current;
      if (pedido === null) throw new Error("Sin pedido fijado");
      // Lo que lance la acción (red cortada) es «incierto»: se reintenta con el mismo pedido.
      const respuesta = await accion(pedido);
      if (!respuesta.ok && respuesta.error.presentacion === "INESPERADO") {
        setReferenciaIncierta(respuesta.error.referencia);
        throw new Error("Resultado inesperado: se reintenta con el mismo pedido");
      }
      ref.current = null;
      setFijado(null);
      setReferenciaIncierta(undefined);
      return respuesta.ok
        ? { ok: true, valor: respuesta.dato }
        : { ok: false, rechazo: respuesta.error };
    },
  });

  function enviarCon(pedido: P): void {
    // Sin conexión no se fija nada: lo que se fijara quedaría sin enviar y bloquearía los campos.
    if (envio.enCurso || !navigator.onLine) return;
    if (ref.current === null) {
      ref.current = pedido;
      setFijado(pedido);
    }
    envio.enviar();
  }

  return { envio, enviarCon, fijado, referenciaIncierta };
}
