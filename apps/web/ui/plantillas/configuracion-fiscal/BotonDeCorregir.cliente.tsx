"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton";
import { Pila } from "../../primitivas/Pila";
import { AvisosDelEnvio } from "./AvisosDelEnvio";
import { useEnvioFijado } from "./useEnvioFijado";

export type PropsDeBotonDeCorregir = Readonly<{
  emisorId: string;
  /** La acción del servidor `empezarCorreccionDeDatosFiscalesAccion`. Recibe el pedido tal cual se armó. */
  empezar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** El formulario de corrección. */
  rutaAlTerminar: string;
}>;

/**
 * «Corregir» (D-62): pide al servidor el borrador de la corrección y sigue al formulario, que lo lee precargado. Cada toque trae un
 * `borradorId` NUEVO (la clave de idempotencia del borrador que se crea); el primer envío lo fija y un reintento por red cortada
 * reenvía el mismo. Si ya había un borrador (de otra pantalla), el servidor devuelve ESE (D-68) y el formulario lo abre. Sin datos
 * vigentes (`FISCAL_SIN_DATOS_FISCALES`) no hay qué corregir: el formulario parte de cero. Cualquier otro rechazo se dice con su texto.
 */
export function BotonDeCorregir({ emisorId, empezar, rutaAlTerminar }: PropsDeBotonDeCorregir) {
  const router = useRouter();
  const { envio, enviarCon, referenciaIncierta } = useEnvioFijado<object, unknown>(empezar);
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const sinDatos = rechazo?.codigo === "FISCAL_SIN_DATOS_FISCALES";
  const sigue = estado.tipo === "hecho" || sinDatos;

  useEffect(() => {
    if (sigue) router.push(rutaAlTerminar);
  }, [sigue, router, rutaAlTerminar]);

  return (
    <Pila separacion={3}>
      <AvisosDelEnvio
        enCurso={envio.enCurso}
        incierto={incierto}
        referenciaIncierta={referenciaIncierta}
        rechazo={sinDatos ? null : rechazo}
      />
      <div>
        <Boton
          enviando={envio.enCurso}
          deshabilitado={!envio.enCurso && envio.bloqueado}
          motivo={envio.motivoQueNoPuede}
          alTocar={() => {
            enviarCon({ emisorId, borradorId: crypto.randomUUID() });
          }}
        >
          {texto({}, "fiscal.pantalla.config_df_corregir")}
        </Boton>
      </div>
    </Pila>
  );
}
