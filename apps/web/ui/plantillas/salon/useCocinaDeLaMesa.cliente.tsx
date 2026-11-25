"use client";

import { useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import type { DocumentoAImprimir } from "./ImpresionDelDocumento.cliente";

type Accion<R> = (pedido: unknown) => Promise<Respuesta<R>>;

/** Lo que el servidor devuelve al enviar a cocina o pedir que salga (la pantalla solo usa esto). */
type EnvioHecho = Readonly<{
  envioId: string;
  numero: number;
  trabajoId: string;
  sinImpresora: boolean;
  yaExistia: boolean;
}>;
/** Lo que devuelve anular un ítem ya enviado. */
type AnulacionHecha = Readonly<{
  avisoId: string;
  trabajoId: string;
  sinImpresora: boolean;
  yaExistia: boolean;
}>;

export type AccionesDeLaCocina = Readonly<{
  enviar: Accion<EnvioHecho>;
  pedirQueSalga: Accion<EnvioHecho>;
  anular: Accion<AnulacionHecha>;
}>;

type Ejecutar = <R>(
  accion: Accion<R>,
  pedido: unknown,
  alTerminar: (dato: R) => void,
) => Promise<void>;

type Intento = Readonly<{ para: string; id: string; clave: string }>;

const nuevoId = (): string => crypto.randomUUID();

/**
 * Lo que la ficha de la mesa hace con la cocina (SAL-C): enviar, pedir que salga, anular un ítem enviado y qué documento se imprime después. Cada paso corre por el `ejecutar` de la pantalla (una acción a la vez) y
 * al terminar bien recarga. Repetir no duplica: el `envioId`, la clave y el `avisoId` de un intento se fijan UNA vez y se reutilizan si se repite exactamente lo mismo (un corte de red, un reintento); recién un
 * resultado bueno los descarta. Si el servidor dice que el envío o el aviso «ya existía» (otro mozo, otra pestaña), NO se vuelve a abrir el diálogo de impresión: ese papel ya salió o lo pidió el otro.
 */
export function useCocinaDeLaMesa(
  cuentaId: string | null,
  acciones: AccionesDeLaCocina,
  ejecutar: Ejecutar,
  recargar: () => void,
) {
  const [documento, setDocumento] = useState<DocumentoAImprimir | null>(null);
  const intentoDelEnvio = useRef<Intento | null>(null);
  const intentoDelAviso = useRef<Intento | null>(null);

  const intento = (ref: { current: Intento | null }, para: string): Intento => {
    if (ref.current === null || ref.current.para !== para) {
      ref.current = { para, id: nuevoId(), clave: nuevoId() };
    }
    return ref.current;
  };

  const alEnviar = (titulo: (numero: number) => string) => (dato: EnvioHecho) => {
    intentoDelEnvio.current = null;
    if (!dato.yaExistia) {
      setDocumento({
        clave: dato.envioId,
        tipo: "COMANDA",
        documentoId: dato.envioId,
        trabajoId: dato.trabajoId,
        titulo: titulo(dato.numero),
        sinImpresora: dato.sinImpresora,
        copia: false,
      });
    }
    recargar();
  };

  return {
    documento,
    cerrarDocumento: () => {
      setDocumento(null);
    },
    /** «Enviar a cocina»: todo lo que sale ahora y todavía no se envió. */
    enviar: (titulo: (numero: number) => string) => {
      if (cuentaId === null) return;
      const i = intento(intentoDelEnvio, "ENVIAR");
      void ejecutar(
        acciones.enviar,
        { envioId: i.id, cuentaId, claveIdempotencia: i.clave },
        alEnviar(titulo),
      );
    },
    /** «Pedir que salga»: algunos platos (sus ids) o todos los que esperan. */
    pedirQueSalga: (lineaIds: readonly string[] | "TODAS", titulo: (numero: number) => string) => {
      if (cuentaId === null) return;
      const i = intento(intentoDelEnvio, JSON.stringify(["SALGA", lineaIds]));
      void ejecutar(
        acciones.pedirQueSalga,
        { envioId: i.id, cuentaId, lineaIds, claveIdempotencia: i.clave },
        alEnviar(titulo),
      );
    },
    /** Anular un ítem ya enviado: el aviso a cocina sale por el mismo camino de impresión. */
    anular: (
      pedido: Readonly<{ lineaId: string; cantidad: string; motivo: string }>,
      titulo: string,
      alTerminar: () => void,
    ) => {
      if (cuentaId === null) return;
      const i = intento(intentoDelAviso, JSON.stringify(pedido));
      void ejecutar(acciones.anular, { cuentaId, ...pedido, avisoId: i.id }, (dato) => {
        intentoDelAviso.current = null;
        alTerminar();
        if (!dato.yaExistia && dato.trabajoId !== "") {
          setDocumento({
            clave: dato.avisoId,
            tipo: "ANULACION",
            documentoId: dato.avisoId,
            trabajoId: dato.trabajoId,
            titulo,
            sinImpresora: dato.sinImpresora,
            copia: false,
          });
        }
        recargar();
      });
    },
    /** Una copia del papel de un envío: se imprime sola al confirmar. */
    copiar: (envioId: string, titulo: string) => {
      setDocumento({
        clave: `copia-${envioId}-${nuevoId()}`,
        tipo: "COMANDA",
        documentoId: envioId,
        trabajoId: null,
        titulo,
        sinImpresora: false,
        copia: true,
      });
    },
  };
}
