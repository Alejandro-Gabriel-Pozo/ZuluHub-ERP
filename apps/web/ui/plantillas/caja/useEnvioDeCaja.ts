import { useEffect, useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { useEnvioConClave, type EnvioConClave } from "../../patrones/useEnvioConClave";

/**
 * El envío de una acción de la pantalla «Caja» del mostrador sobre `useEnvioConClave` (idempotente por intento, [01] §6.2 y §6.4):
 *  - la clave la genera `useEnvioConClave` UNA vez por intento y se reusa en cada reintento (doble toque, corte de red);
 *  - el pedido (los valores de la pantalla) se FIJA en el primer envío del intento y se reenvía idéntico: otros valores con la misma clave serían «clave reutilizada» y con otra clave, un
 *    segundo movimiento. Los campos del formulario quedan apagados mientras tanto (`bloqueado`), así lo fijado y lo que se ve coinciden;
 *  - un resultado INESPERADO devuelto como valor (`ERROR_INTERNO`, `NO_DISPONIBLE`) no es una respuesta definitiva (la acción pudo quedar registrada): se lanza, sin tocar lo fijado, para que
 *    el intento quede «incierto» y se reintente con la misma clave;
 *  - con una respuesta hecha se llama a `alTerminar` UNA vez (la pantalla recarga y vuelve a la vista anterior).
 * Las acciones que se resuelven por el estado de la sesión (iniciar y cancelar el cierre) no usan la clave: la ignoran.
 * Previene: una apertura de caja (fondo inicial) duplicada por un doble toque o un reintento. Chequeo: `PantallaDeCaja.test.tsx` (doble toque = una llamada; reintento con la
 * misma clave).
 */
export type EnvioDeCaja<P> = Readonly<{
  envio: EnvioConClave<unknown, ErrorPublico>;
  enviarCon: (pedido: P) => void;
  /** El rechazo definitivo del servidor (ya traducido), o `null`. */
  rechazo: ErrorPublico | null;
  /** La referencia del último INESPERADO, mientras el intento sigue incierto. */
  referenciaIncierta: string | undefined;
  /** Mientras envía o verifica: los campos y botones no se tocan. */
  ocupado: boolean;
}>;

export function useEnvioDeCaja<P>(
  accion: (pedido: P, clave: string) => Promise<Respuesta<unknown>>,
  alTerminar: () => void,
): EnvioDeCaja<P> {
  const delToque = useRef<P | null>(null);
  const fijado = useRef<P | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const ultimas = useRef({ accion, alTerminar });
  const avisado = useRef(false);

  useEffect(() => {
    ultimas.current = { accion, alTerminar };
  });

  const envio = useEnvioConClave<unknown, ErrorPublico>({
    textos: {
      sinConexion: texto({}, "conexion.no_se_puede_enviar"),
      verificando: texto({}, "conexion.verificando"),
    },
    enviar: async (clave) => {
      // Solo el primer envío del intento fija; los reintentos usan lo ya fijado.
      fijado.current ??= delToque.current;
      const pedido = fijado.current;
      if (pedido === null) throw new Error("Sin pedido fijado");
      const respuesta = await ultimas.current.accion(pedido, clave);
      if (!respuesta.ok && respuesta.error.presentacion === "INESPERADO") {
        setReferenciaIncierta(respuesta.error.referencia);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      fijado.current = null;
      setReferenciaIncierta(undefined);
      return respuesta.ok
        ? { ok: true, valor: respuesta.dato }
        : { ok: false, rechazo: respuesta.error };
    },
  });

  const tipo = envio.estado.tipo;
  useEffect(() => {
    if (tipo !== "hecho") {
      avisado.current = false;
      return;
    }
    if (avisado.current) return;
    avisado.current = true;
    ultimas.current.alTerminar();
  }, [tipo]);

  function enviarCon(pedido: P): void {
    // Sin conexión no se fija nada: lo fijado quedaría sin enviar.
    if (envio.enCurso || !navigator.onLine) return;
    delToque.current = pedido;
    envio.enviar();
  }

  return {
    envio,
    enviarCon,
    rechazo: envio.estado.tipo === "rechazado" ? envio.estado.rechazo : null,
    referenciaIncierta,
    ocupado: envio.enCurso || tipo === "incierto",
  };
}
