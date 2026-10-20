import { Aviso } from "../../web/ui/componentes/Aviso";
import { Texto } from "../../web/ui/primitivas/Texto";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import estilos from "./empresas.module.css";

export type PropsDeAvisoDeError = Readonly<{
  error: ErrorParaLaPantalla;
  referencia?: string | undefined;
  /** Adónde lleva «Reintentar» (la misma pantalla). */
  reintentarHref: string;
  /** Qué no se pudo hacer, para el caso inesperado («No pudimos cargar las empresas.»). */
  textoInesperado: string;
}>;

/** El error de una pantalla que no pudo cargar: nunca un código técnico; la referencia solo si vino. */
export function AvisoDeError({
  error,
  referencia,
  reintentarHref,
  textoInesperado,
}: PropsDeAvisoDeError) {
  const reintentar = (
    <a className={estilos["enlaceSimple"]} href={reintentarHref}>
      Reintentar
    </a>
  );
  if (error.tipo === "OCULTAR_ACCION") {
    return (
      <Aviso tono="aviso">
        <Texto>No tenés permiso para ver esto.</Texto>
      </Aviso>
    );
  }
  if (error.tipo === "GENERAL" || error.tipo === "PANTALLA_VIEJA" || error.tipo === "CAMPO") {
    return (
      <Aviso tono="peligro" accion={reintentar}>
        <Texto>{error.texto}</Texto>
      </Aviso>
    );
  }
  return (
    <Aviso tono="peligro" accion={reintentar}>
      <Texto>{textoInesperado}</Texto>
      {referencia === undefined ? null : <Texto>Código de referencia: {referencia}</Texto>}
    </Aviso>
  );
}
