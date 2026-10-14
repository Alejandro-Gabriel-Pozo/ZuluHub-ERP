"use client";

import { bytesDeDigest } from "../../../../src/capacidades/experiencia/referencia-web";
import { texto } from "../../../../src/capacidades/vocabulario/vocabulario";
import { referenciaDeError } from "../../../../src/plataforma/dominio/referencia";
import { Boton } from "../componentes/Boton";
import { PlantillaNeutra } from "../plantillas/PlantillaNeutra";
import { ErrorConReferencia } from "./ErrorConReferencia";

type PropsDeErrorDeSuperficie = Readonly<{
  /** El error que atajó Next. En producción NO trae el mensaje, solo el `digest`: no se muestra nada más. */
  error: Error & { digest?: string };
  /** Vuelve a pintar el segmento. Es seguro: toda operación declara cómo se repite sin duplicar. */
  reset: () => void;
}>;

/**
 * El 500 de una superficie (ADR-016): un texto genérico, la referencia `ZH-…` derivada del `digest` que
 * Next ya dejó en el registro del servidor, y «Reintentar». Nunca el mensaje, el nombre ni la pila del
 * error. Sin `digest` (un fallo solo del navegador) no hay referencia que mostrar.
 */
export function ErrorDeSuperficie({ error, reset }: PropsDeErrorDeSuperficie) {
  const digest = error.digest;
  const referencia = digest === undefined ? null : referenciaDeError(bytesDeDigest(digest));
  return (
    <PlantillaNeutra titulo={texto({}, "estado.error_titulo")}>
      <ErrorConReferencia
        texto={texto({}, "error.inesperado")}
        textoDeReferencia={referencia === null ? "" : texto({}, "error.referencia", { referencia })}
        accion={<Boton alTocar={reset}>{texto({}, "estado.reintentar")}</Boton>}
      />
    </PlantillaNeutra>
  );
}
