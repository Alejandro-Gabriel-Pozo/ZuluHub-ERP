import { useCallback, useEffect, useRef, useState } from "react";
import { useEnLinea } from "./useEnLinea";

/**
 * Envío de algo que cambia datos (cobrar, anular, dar de alta) sin duplicar nada ([01] §6.2 y §6.4).
 * Lo que evita el duplicado es la CLAVE DE IDEMPOTENCIA, no el botón deshabilitado:
 *  - la clave se genera por INTENTO, al primer envío, y se REUSA en cada reintento del mismo intento;
 *  - mientras no se sepa el resultado no se genera una clave nueva: si el servidor ya registró el pedido,
 *    una clave nueva lo registraría dos veces;
 *  - sin respuesta (la red se cortó, el servidor tardó) el resultado es INCIERTO: «Verificando si se
 *    registró…» y se reintenta con la misma clave; el servidor devuelve el mismo resultado exitoso;
 *  - recién con una respuesta definitiva (hecho o rechazo de negocio) el intento termina y la clave se
 *    descarta; el próximo envío es otro intento, con otra clave.
 * Dos toques seguidos son un solo envío (la guarda es síncrona, no depende de que React repinte).
 */

/** Lo que responde el servidor de forma definitiva. Una excepción (o una promesa rechazada) es «no se sabe». */
export type RespuestaDeEnvio<R, E> = { ok: true; valor: R } | { ok: false; rechazo: E };

type EstadoDeEnvio<R, E> =
  | { tipo: "reposo" }
  | { tipo: "enviando" }
  /** Se mandó y no volvió la respuesta. `reintentos` cuenta los automáticos ya hechos. */
  | { tipo: "incierto"; reintentos: number }
  | { tipo: "hecho"; valor: R }
  | { tipo: "rechazado"; rechazo: E };

export type OpcionesDeEnvio<R, E> = Readonly<{
  /**
   * Manda el pedido con la clave. Tiene que ser seguro de repetir con la MISMA clave (el servidor
   * devuelve el mismo resultado). Si falla por red o por un error inesperado, que lance: eso es «incierto».
   */
  enviar: (clave: string) => Promise<RespuestaDeEnvio<R, E>>;
  /** Textos ya resueltos de por qué no se puede enviar ahora. */
  textos: Readonly<{ sinConexion: string; verificando: string }>;
  /** Genera la clave de un intento nuevo. Por defecto, un UUID aleatorio del navegador. */
  nuevaClave?: () => string;
  /** Espera antes de cada reintento automático, en milisegundos. */
  esperaEntreVerificacionesMs?: number;
  /** Cuántas veces reintenta solo antes de dejar el «Reintentar» a mano. */
  verificacionesAutomaticas?: number;
}>;

const ESPERA_POR_DEFECTO_MS = 2000;
const VERIFICACIONES_POR_DEFECTO = 3;

export type EnvioConClave<R, E> = Readonly<{
  estado: EstadoDeEnvio<R, E>;
  /** Hay un pedido en vuelo ahora mismo (el primero o un reintento). */
  enCurso: boolean;
  /** Empieza un intento nuevo; si hay uno incierto pendiente, lo reintenta con su misma clave. */
  enviar: () => void;
  /** Vuelve a «en reposo» después de mostrar un resultado. */
  reiniciar: () => void;
  puedeEnviar: boolean;
  /** No se puede ni intentar (sin conexión o verificando), sin contar el pedido en vuelo: es el `deshabilitado` del botón. */
  bloqueado: boolean;
  /** Por qué no se puede enviar ahora (sin conexión, verificando), o `undefined`. */
  motivoQueNoPuede: string | undefined;
}>;

export function useEnvioConClave<R, E>(opciones: OpcionesDeEnvio<R, E>): EnvioConClave<R, E> {
  const enLinea = useEnLinea();
  const [estado, setEstado] = useState<EstadoDeEnvio<R, E>>({ tipo: "reposo" });
  const [enCurso, setEnCurso] = useState(false);
  // La clave del intento pendiente: vive entre reintentos y se descarta al saber el resultado.
  const clave = useRef<string | null>(null);
  const enVuelo = useRef(false);
  const montado = useRef(true);
  // Siempre las opciones de la última pintura, sin volver a armar los callbacks.
  const ultimas = useRef(opciones);

  useEffect(() => {
    ultimas.current = opciones;
  });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const mandar = useCallback(async (reintentos: number): Promise<void> => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    clave.current ??= (ultimas.current.nuevaClave ?? (() => crypto.randomUUID()))();
    setEnCurso(true);
    setEstado((previo) => (previo.tipo === "incierto" ? previo : { tipo: "enviando" }));
    let siguiente: EstadoDeEnvio<R, E>;
    try {
      const respuesta = await ultimas.current.enviar(clave.current);
      clave.current = null;
      siguiente = respuesta.ok
        ? { tipo: "hecho", valor: respuesta.valor }
        : { tipo: "rechazado", rechazo: respuesta.rechazo };
    } catch {
      siguiente = { tipo: "incierto", reintentos };
    } finally {
      enVuelo.current = false;
    }
    if (montado.current) {
      setEnCurso(false);
      setEstado(siguiente);
    }
  }, []);

  const reintentosHechos = estado.tipo === "incierto" ? estado.reintentos : 0;
  const hayIncierto = estado.tipo === "incierto";
  const maximo = opciones.verificacionesAutomaticas ?? VERIFICACIONES_POR_DEFECTO;
  const espera = opciones.esperaEntreVerificacionesMs ?? ESPERA_POR_DEFECTO_MS;

  // Verificación automática: con el resultado incierto y con conexión, reintenta con la MISMA clave.
  useEffect(() => {
    if (!hayIncierto || enCurso || !enLinea || reintentosHechos >= maximo) return;
    const temporizador = setTimeout(() => {
      void mandar(reintentosHechos + 1);
    }, espera);
    return () => {
      clearTimeout(temporizador);
    };
  }, [hayIncierto, enCurso, enLinea, reintentosHechos, maximo, espera, mandar]);

  const enviar = useCallback(() => {
    if (!navigator.onLine) return;
    void mandar(0);
  }, [mandar]);

  const reiniciar = useCallback(() => {
    // Un intento incierto no se puede olvidar: perdería la clave y el próximo envío podría duplicar.
    if (clave.current !== null) return;
    setEstado({ tipo: "reposo" });
  }, []);

  const puedeEnviar = enLinea && !enCurso && estado.tipo !== "incierto";
  const motivoQueNoPuede = !enLinea
    ? opciones.textos.sinConexion
    : estado.tipo === "incierto"
      ? opciones.textos.verificando
      : undefined;

  return {
    estado,
    enCurso,
    enviar,
    reiniciar,
    puedeEnviar,
    bloqueado: !puedeEnviar && !enCurso,
    motivoQueNoPuede,
  };
}
