"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import { ErrorDeRespuesta } from "../ErrorDeRespuesta";
import type { PapelParaImprimir } from "./hoja-del-papel";
import { useImpresionDelPapel } from "./useImpresionDelPapel.cliente";

/** Lo que devuelve «imprimir» o «reintentar» un documento (`solicitarImpresion`): el trabajo, su intento y si había impresora. */
export type TrabajoDeImpresion = Readonly<{
  trabajoId: string;
  estado: string;
  intentos: number;
  sinImpresora: boolean;
  yaExistia: boolean;
  reintento: boolean;
}>;

export type PropsDeBotonDeImprimir = Readonly<{
  textos: Readonly<{
    imprimir: string;
    imprimiendo: string;
    impresa: string;
    noSePudo: string;
    reintentar: string;
    verEnPantalla: string;
    sinImpresora: string;
  }>;
  /** Pide el trabajo con la clave de ESTE intento (la acción de servidor `solicitarImpresion`, ya ligada al documento y al `trabajoId`). Repetir la misma clave devuelve el mismo trabajo. */
  pedirImpresion: (claveIdempotencia: string) => Promise<Respuesta<TrabajoDeImpresion>>;
  /** El papel que armó el servidor desde lo guardado (`documentoParaImprimir`), ya ligado al documento. */
  cargarPapel: () => Promise<Respuesta<PapelParaImprimir>>;
  /** El dispositivo declara el resultado de un intento (`declararResultadoDeImpresion`, ya ligada al trabajo). Declarar lo mismo dos veces es lo mismo. */
  declarar: (numero: number, resultado: "IMPRESA" | "FALLIDA") => Promise<Respuesta<unknown>>;
  /** Sin permiso para imprimir el botón sale apagado (solo una ayuda: el servidor decide). */
  deshabilitado?: boolean;
  /** Genera la clave de un intento nuevo; por defecto, un UUID del navegador. */
  nuevaClave?: () => string;
  /**
   * El trabajo ya existe porque lo creó el mismo paso que creó el documento (enviar a cocina, anular un ítem enviado): el primer «Imprimir» NO lo pide de nuevo (el servidor diría «ya existía» y no se abriría el diálogo), imprime el intento
   * `intentos` de ese trabajo y lo declara. Si no había impresora, va directo a «Ver en pantalla». Los «Reintentar» siguientes sí pasan por `pedirImpresion` (el mismo trabajo, `intentos + 1`).
   */
  trabajoInicial?: Readonly<{ intentos: number; sinImpresora: boolean }>;
  /** Arranca solo al aparecer (una sola vez): el diálogo de impresión se abre al enviar (DEC-1034). Sin esto espera el toque en «Imprimir». */
  arrancarSolo?: boolean;
  /** Empieza en «No se pudo imprimir» con «Reintentar» y «Ver en pantalla» (la pantalla de la cocina, SAL-H, para un trabajo que ya falló antes de abrirla). «Reintentar» pide el mismo trabajo con un intento más. */
  empezarFallida?: boolean;
  /** Lo que acompaña al aviso «No hay impresora para la comanda de cocina» (p. ej. el enlace «Configurar impresoras»). */
  acompanamientoSinImpresora?: ReactNode;
}>;

type Fase = "reposo" | "imprimiendo" | "impresa" | "fallida" | "sinImpresora";
type PorDeclarar = Readonly<{ numero: number; resultado: "IMPRESA" | "FALLIDA" }>;

/**
 * El botón «Imprimir» de una comanda o de un ticket (S-2; E7 §3.5 y §3.10): pide el trabajo al servidor, abre el diálogo de impresión del sistema con el papel que el servidor armó y declara el resultado.
 * Reposo → «Imprimiendo» (el botón se apaga: el segundo toque no saca otro papel) → «Impresa», o «No se pudo imprimir» con «Reintentar» y «Ver en pantalla».
 *  - **Un trabajo, un papel.** Cada intento lleva su clave; el trabajo es el mismo en cada «Reintentar» (`intentos + 1`, lo decide el servidor, que no admite un segundo trabajo original del mismo documento). Si el servidor dice que el
 *    trabajo ya existía y no era un reintento (otro toque, otra pestaña), NO se vuelve a abrir el diálogo.
 *  - **«Impresa» es lo que declara el dispositivo, no una verificación** (el navegador no confirma que salió el papel; S-13): se declara al cerrarse el diálogo.
 *  - **Lo que no se pudo declarar no se pierde:** queda anotado y «Reintentar» lo declara primero (si el papel ya había salido, termina en «Impresa» sin abrir otro diálogo).
 * Chequeo: `BotonDeImprimir.test.tsx` (Chromium real: doble toque, reintento, declaración, sin impresora, axe).
 */
export function BotonDeImprimir({
  textos,
  pedirImpresion,
  cargarPapel,
  declarar,
  deshabilitado = false,
  nuevaClave = () => crypto.randomUUID(),
  trabajoInicial,
  arrancarSolo = false,
  empezarFallida = false,
  acompanamientoSinImpresora,
}: PropsDeBotonDeImprimir) {
  const [fase, setFase] = useState<Fase>(empezarFallida ? "fallida" : "reposo");
  const [error, setError] = useState<ErrorPublico | null>(null);
  const impresion = useImpresionDelPapel();
  const enVuelo = useRef(false);
  const porDeclarar = useRef<PorDeclarar | null>(null);
  const clave = useRef<string | null>(null);
  // El trabajo que creó el envío se imprime una sola vez sin pedirlo; después todo pasa por «Imprimir» y «Reintentar» comunes.
  const inicialPendiente = useRef(trabajoInicial !== undefined);
  const arrancado = useRef(false);

  /** Declara lo que quedó pendiente de un intento anterior. `true` si ya no queda nada por declarar. */
  const declararLoPendiente = async (): Promise<boolean> => {
    const pendiente = porDeclarar.current;
    if (pendiente === null) return true;
    try {
      const r = await declarar(pendiente.numero, pendiente.resultado);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
    } catch {
      return false;
    }
    porDeclarar.current = null;
    return true;
  };

  const imprimirElIntento = async (numero: number) => {
    let salio = false;
    try {
      const papel = await cargarPapel();
      if (papel.ok) {
        await impresion.imprimir(papel.dato);
        salio = true;
      } else {
        setError(papel.error);
      }
    } catch {
      salio = false;
    } finally {
      impresion.ocultar();
    }
    porDeclarar.current = { numero, resultado: salio ? "IMPRESA" : "FALLIDA" };
    if (!(await declararLoPendiente())) {
      setFase("fallida");
      return;
    }
    setFase(salio ? "impresa" : "fallida");
  };

  const correr = async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setFase("imprimiendo");
    setError(null);
    try {
      const pendiente = porDeclarar.current;
      if (pendiente !== null) {
        if (!(await declararLoPendiente())) {
          setFase("fallida");
          return;
        }
        if (pendiente.resultado === "IMPRESA") {
          // El papel ya había salido y solo faltaba declararlo: no se abre otro diálogo.
          setFase("impresa");
          return;
        }
      }
      if (inicialPendiente.current && trabajoInicial !== undefined) {
        inicialPendiente.current = false;
        if (trabajoInicial.sinImpresora) {
          setFase("sinImpresora");
          return;
        }
        await imprimirElIntento(trabajoInicial.intentos);
        return;
      }
      // La clave es de UN intento: si no volvió respuesta (red cortada) se reusa en el reintento (el servidor devuelve el mismo trabajo) y recién con una respuesta se descarta.
      const esRecuperacion = clave.current !== null;
      clave.current ??= nuevaClave();
      const pedido = await pedirImpresion(clave.current);
      clave.current = null;
      if (!pedido.ok) {
        setError(pedido.error);
        setFase("fallida");
        return;
      }
      const trabajo = pedido.dato;
      if (trabajo.sinImpresora) {
        setFase("sinImpresora");
        return;
      }
      // Si el pedido anterior (el mismo, con la misma clave) llegó al servidor pero no volvió la respuesta, el trabajo es NUESTRO y todavía no salió ningún papel: se imprime.
      const esNuestro = esRecuperacion && trabajo.estado === "PENDIENTE";
      if (trabajo.yaExistia && !trabajo.reintento && !esNuestro) {
        // Otro toque, otra pestaña o una carga anterior ya pidió este papel: no se abre otro diálogo.
        if (trabajo.estado === "IMPRESA") {
          setFase("impresa");
        } else {
          porDeclarar.current = { numero: trabajo.intentos, resultado: "FALLIDA" };
          setFase("fallida");
        }
        return;
      }
      await imprimirElIntento(trabajo.intentos);
    } catch {
      setFase("fallida");
    } finally {
      enVuelo.current = false;
    }
  };

  // `correr` se vuelve a crear en cada pintura: el arranque solo lee la última por referencia y dispara UNA vez.
  const ultimoCorrer = useRef(correr);
  useEffect(() => {
    ultimoCorrer.current = correr;
  });
  useEffect(() => {
    if (!arrancarSolo || arrancado.current) return;
    arrancado.current = true;
    void ultimoCorrer.current();
  }, [arrancarSolo]);

  const verEnPantalla = async () => {
    setError(null);
    try {
      const papel = await cargarPapel();
      if (papel.ok) impresion.mostrar(papel.dato);
      else setError(papel.error);
    } catch {
      setFase("fallida");
    }
  };

  const imprimiendo = fase === "imprimiendo";
  return (
    <Pila separacion={3}>
      {fase === "imprimiendo" ? (
        <Aviso tono="info">
          <Texto>{textos.imprimiendo}</Texto>
        </Aviso>
      ) : null}
      {fase === "impresa" ? (
        <Aviso tono="exito">
          <Texto>{textos.impresa}</Texto>
        </Aviso>
      ) : null}
      {fase === "fallida" ? (
        <Aviso tono="peligro">
          <Texto>{textos.noSePudo}</Texto>
        </Aviso>
      ) : null}
      {fase === "sinImpresora" ? (
        <Aviso tono="aviso">
          <Texto>{textos.sinImpresora}</Texto>
          {acompanamientoSinImpresora}
        </Aviso>
      ) : null}
      {error === null ? null : <ErrorDeRespuesta error={error} />}
      <Pila direccion="fila" separacion={3} alinear="inicio" envolver>
        {fase === "reposo" || imprimiendo ? (
          <Boton
            enviando={imprimiendo}
            textoEnviando={textos.imprimiendo}
            deshabilitado={deshabilitado}
            alTocar={() => void correr()}
          >
            {textos.imprimir}
          </Boton>
        ) : null}
        {fase === "fallida" || fase === "sinImpresora" ? (
          <Boton variante="secundaria" alTocar={() => void verEnPantalla()}>
            {textos.verEnPantalla}
          </Boton>
        ) : null}
        {fase === "fallida" ? (
          <Boton alTocar={() => void correr()} deshabilitado={deshabilitado}>
            {textos.reintentar}
          </Boton>
        ) : null}
      </Pila>
      {impresion.zona}
    </Pila>
  );
}
