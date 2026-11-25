"use client";

import { useEffect, useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { useEnvioConClave } from "../../patrones/useEnvioConClave";

/** Una acción del servidor del cierre: recibe el pedido (sin tipo: lo lee y valida el servidor) y devuelve la respuesta ya traducida. */
export type AccionDelCierre = (pedido: unknown) => Promise<Respuesta<unknown>>;

type Props = Readonly<{
  /** El texto del botón, ya resuelto. */
  children: string;
  variante?: "primaria" | "secundaria";
  deshabilitado?: boolean;
  accion: AccionDelCierre;
  /** Arma el pedido en el PRIMER envío del intento: se fija junto con la clave y se reusa, igual, en cada reintento. */
  armarPedido: () => Readonly<Record<string, unknown>>;
  /** `true` si la acción exige clave de idempotencia (corregir, declarar, conforme); empezar, cancelar y cerrar se repiten sin duplicar por el estado de la jornada. */
  conClave: boolean;
  /** Se llama UNA vez con la respuesta definitiva, hecha o rechazada. */
  alResponder: (respuesta: Respuesta<unknown>) => void;
}>;

/**
 * Un botón del cierre que manda una acción al servidor sin duplicarla ([01] §6.2 y §6.4): lo que evita el duplicado es la CLAVE del intento, no el botón apagado. El pedido se fija con la
 * primera clave y se reenvía idéntico mientras el resultado sea incierto (red cortada, o un resultado inesperado devuelto como valor: pudo quedar registrado); recién con una respuesta
 * definitiva se descarta y el próximo toque es otro intento. Dos toques seguidos son un solo envío. Sin conexión o verificando, el botón queda apagado y dice por qué.
 * Previene: dos cierres, dos correcciones o dos declaraciones por un doble toque o un reintento de red (dinero y registro del día). Chequeo: `PantallaDelCierre.envio.test.tsx`.
 */
export function BotonDeAccionDelCierre({
  children,
  variante = "primaria",
  deshabilitado = false,
  accion,
  armarPedido,
  conClave,
  alResponder,
}: Props) {
  const fijado = useRef<Readonly<Record<string, unknown>> | null>(null);
  const ultimas = useRef({ armarPedido, alResponder, accion });
  const [inesperado, setInesperado] = useState<ErrorPublico | null>(null);

  useEffect(() => {
    ultimas.current = { armarPedido, alResponder, accion };
  });

  const envio = useEnvioConClave<Respuesta<unknown>, ErrorPublico>({
    textos: {
      sinConexion: texto({}, "conexion.no_se_puede_enviar"),
      verificando: texto({}, "conexion.verificando"),
    },
    enviar: async (clave) => {
      // Solo el primer envío del intento fija; los reintentos usan lo ya fijado, aunque la pantalla haya cambiado.
      fijado.current ??= ultimas.current.armarPedido();
      const respuesta = await ultimas.current.accion(
        conClave ? { ...fijado.current, claveDeIdempotencia: clave } : fijado.current,
      );
      if (!respuesta.ok && respuesta.error.presentacion === "INESPERADO") {
        setInesperado(respuesta.error);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      fijado.current = null;
      setInesperado(null);
      return respuesta.ok
        ? { ok: true, valor: respuesta }
        : { ok: false, rechazo: respuesta.error };
    },
  });

  const { estado, reiniciar } = envio;
  useEffect(() => {
    if (estado.tipo === "hecho") {
      ultimas.current.alResponder(estado.valor);
      reiniciar();
    } else if (estado.tipo === "rechazado") {
      ultimas.current.alResponder({ ok: false, error: estado.rechazo });
      reiniciar();
    }
  }, [estado, reiniciar]);

  return (
    <>
      <Boton
        variante={variante}
        ancho="completo"
        deshabilitado={deshabilitado || envio.bloqueado}
        motivo={envio.motivoQueNoPuede}
        enviando={envio.enCurso}
        textoEnviando={texto({}, "conexion.enviando")}
        alTocar={envio.enviar}
      >
        {children}
      </Boton>
      {inesperado === null ? null : <ErrorDelDetalle error={inesperado} />}
    </>
  );
}
