"use client";

import { useRef, type ReactNode } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  BotonDeImprimir,
  type TrabajoDeImpresion,
} from "../../patrones/papel/BotonDeImprimir.cliente";
import type { PapelParaImprimir } from "../../patrones/papel/hoja-del-papel";
import type { armarLosTextosDeImprimir } from "../../patrones/papel/textos-de-imprimir";
import estilos from "./PantallaDeLaMesa.module.css";

type Accion<R> = (pedido: unknown) => Promise<Respuesta<R>>;

export type AccionesDeImpresion = Readonly<{
  imprimir: Accion<TrabajoDeImpresion>;
  reimprimir: Accion<TrabajoDeImpresion>;
  declarar: Accion<unknown>;
  papel: Accion<PapelParaImprimir>;
}>;

/** Un documento a imprimir: el papel de un envío («COMANDA»), el aviso de una anulación o una copia de un envío. */
export type DocumentoAImprimir = Readonly<{
  /** Cambia con cada documento: el botón empieza de cero (un papel, un botón). */
  clave: string;
  tipo: "COMANDA" | "ANULACION";
  documentoId: string;
  /** El trabajo que ya creó el envío o la anulación; no hay uno si es una copia (se crea al pedirla). */
  trabajoId: string | null;
  titulo: string;
  sinImpresora: boolean;
  copia: boolean;
  /** El intento del trabajo que ya existe (1 si no se dice): el primer toque imprime ESE intento. */
  intentos?: number;
}>;

export type PropsDeImpresionDelDocumento = Readonly<{
  documento: DocumentoAImprimir;
  textos: ReturnType<typeof armarLosTextosDeImprimir>;
  /** «Reimprimir» en lugar de «Imprimir» en el botón de una copia. */
  textoDeLaCopia: string;
  acciones: AccionesDeImpresion;
  /** Sin permiso para imprimir el botón sale apagado (solo una ayuda: el servidor decide). */
  deshabilitado: boolean;
  /** El enlace «Configurar impresoras» (solo a quien puede ir); `null` si no se ofrece. */
  configurarImpresoras: ReactNode;
  /** Por defecto el diálogo se abre solo al aparecer (al enviar, DEC-1034). En la pantalla de la cocina espera el toque en «Imprimir». */
  arrancarSolo?: boolean;
  /** Para un trabajo que ya falló: empieza en «No se pudo imprimir» con «Reintentar» (el mismo trabajo, un intento más). */
  empezarFallida?: boolean;
  /** `false` si quien lo usa ya muestra el título del documento. */
  mostrarTitulo?: boolean;
}>;

/**
 * El papel de UN documento de la cocina en la ficha de la mesa (SAL-C, S5 y S7): abre solo el diálogo de impresión del sistema con el papel que armó el servidor (DEC-1034) y declara el resultado; si falla, «No se pudo
 * imprimir» con «Reintentar» y «Ver en pantalla». Sin impresora para ese uso, «No hay impresora para la comanda de cocina» y «Ver en pantalla» (el envío queda registrado igual: imprimir nunca lo bloquea).
 *  - **Un trabajo, un papel.** El envío y la anulación ya crearon su trabajo original: se imprime ESE (`trabajoInicial`) y «Reintentar» es el mismo trabajo con un intento más. Una copia es un trabajo nuevo que dice «Copia»
 *    y lleva la hora del envío original (lo arma el servidor); su id lo fija esta pieza una vez por clave de intento, así repetir lo mismo tras un corte no crea otra copia.
 *  - Sin textos propios: todos llegan resueltos. El navegador no confirma que salió el papel: «Impresa» es lo que declaró el dispositivo.
 */
export function ImpresionDelDocumento({
  documento,
  textos,
  textoDeLaCopia,
  acciones,
  deshabilitado,
  configurarImpresoras,
  arrancarSolo = true,
  empezarFallida = false,
  mostrarTitulo = true,
}: PropsDeImpresionDelDocumento) {
  // La copia pide su trabajo con el id y la clave de cada intento; el resultado se declara contra el trabajo que volvió.
  const idDeLaCopia = useRef<Readonly<{ clave: string; trabajoId: string }> | null>(null);
  const trabajoDeLaCopia = useRef<string | null>(null);

  const pedirImpresion = (clave: string): Promise<Respuesta<TrabajoDeImpresion>> => {
    if (!documento.copia) {
      return acciones.imprimir({
        trabajoId: documento.trabajoId,
        documentoTipo: documento.tipo,
        documentoId: documento.documentoId,
        claveIdempotencia: clave,
      });
    }
    if (idDeLaCopia.current?.clave !== clave) {
      idDeLaCopia.current = { clave, trabajoId: crypto.randomUUID() };
    }
    return acciones
      .reimprimir({
        trabajoId: idDeLaCopia.current.trabajoId,
        documentoTipo: documento.tipo,
        documentoId: documento.documentoId,
        claveIdempotencia: clave,
      })
      .then((respuesta) => {
        if (respuesta.ok) trabajoDeLaCopia.current = respuesta.dato.trabajoId;
        return respuesta;
      });
  };

  return (
    <section className={estilos["impresion"]} aria-label={documento.titulo}>
      {mostrarTitulo ? <h3 className={estilos["subtitulo"]}>{documento.titulo}</h3> : null}
      <BotonDeImprimir
        textos={{ ...textos, imprimir: documento.copia ? textoDeLaCopia : textos.imprimir }}
        pedirImpresion={pedirImpresion}
        cargarPapel={() =>
          acciones.papel({
            documentoTipo: documento.tipo,
            documentoId: documento.documentoId,
            ...(documento.copia ? { copia: true } : {}),
          })
        }
        declarar={(numero, resultado) =>
          acciones.declarar({
            trabajoId: documento.copia ? trabajoDeLaCopia.current : documento.trabajoId,
            numero,
            resultado,
          })
        }
        deshabilitado={deshabilitado}
        arrancarSolo={arrancarSolo}
        empezarFallida={empezarFallida}
        {...(documento.copia || documento.trabajoId === null || empezarFallida
          ? {}
          : {
              trabajoInicial: {
                intentos: documento.intentos ?? 1,
                sinImpresora: documento.sinImpresora,
              },
            })}
        acompanamientoSinImpresora={configurarImpresoras}
      />
    </section>
  );
}
