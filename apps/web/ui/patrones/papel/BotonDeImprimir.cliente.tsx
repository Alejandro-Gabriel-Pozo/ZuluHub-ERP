"use client";

import { useRef, useState } from "react";
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
}: PropsDeBotonDeImprimir) {
  const [fase, setFase] = useState<Fase>("reposo");
  const [error, setError] = useState<ErrorPublico | null>(null);
  const impresion = useImpresionDelPapel();
  const enVuelo = useRef(false);
  const porDeclarar = useRef<PorDeclarar | null>(null);
  const clave = useRef<string | null>(null);

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
