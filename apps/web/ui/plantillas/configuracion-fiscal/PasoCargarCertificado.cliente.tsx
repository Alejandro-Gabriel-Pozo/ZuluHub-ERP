"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton";
import { Pila } from "../../primitivas/Pila";
import estilos from "./AsistenteDeCertificado.module.css";
import { AvisosDelEnvio } from "./AvisosDelEnvio";
import { armarLaCargaDeCertificado, lugarDelErrorDeLaCarga } from "./modelo-de-certificado";
import { useEnvioFijado } from "./useEnvioFijado";

export type PropsDePasoCargarCertificado = Readonly<{
  /** El pedido que el estado informa como pendiente en este ambiente: el servidor valida el certificado contra ESTE. */
  certificadoId: string;
  /** `cargarCertificadoAccion`. */
  cargar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  alTerminar: () => void;
  alCancelar: () => void;
  /** El título del paso, que nombra el campo. */
  idDelTitulo: string;
}>;

/**
 * Paso 3 del asistente: se PEGA el certificado que devolvió ARCA (dueño, 2026-11-03: no se sube archivo). Cargar el mismo certificado
 * dos veces no escribe nada (`yaEstaba`), así que un reintento tras un corte es seguro y el primer envío fija lo pegado
 * (`useEnvioFijado`). Cada rechazo (no es el del pedido, venció, no se lee…) sale con el mensaje genérico y su referencia, y se puede
 * volver a pegar. Lo pegado vive solo en la pantalla: no se guarda en el navegador ni se registra.
 *
 * El campo NO lleva `name` a propósito: `leerCamposDeLaPagina` guarda en `sessionStorage` todo `main textarea[name]` al vencer la sesión,
 * y un envío nativo antes de hidratar pondría el texto en la URL. Previene: que el certificado pegado se guarde o viaje en la URL.
 * Chequeo: `PasoCargarCertificado.test.tsx` (falla si se le vuelve a poner `name`).
 */
export function PasoCargarCertificado({
  certificadoId,
  cargar,
  alTerminar,
  alCancelar,
  idDelTitulo,
}: PropsDePasoCargarCertificado) {
  const formulario = useRef<HTMLFormElement>(null);
  const [pem, setPem] = useState("");
  const { envio, enviarCon, referenciaIncierta } = useEnvioFijado<object, unknown>(cargar, {
    inesperadoEsDefinitivo: true,
  });
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueado = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const marcado = rechazo !== null && lugarDelErrorDeLaCarga(rechazo.campo) !== null;
  const hecho = estado.tipo === "hecho";

  useEffect(() => {
    if (hecho) alTerminar();
  }, [hecho, alTerminar]);

  useEffect(() => {
    if (rechazo !== null) {
      formulario.current?.querySelector<HTMLElement>("textarea")?.focus();
    }
  }, [rechazo]);

  function alEnviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    formulario.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    enviarCon(armarLaCargaDeCertificado(certificadoId, pem));
  }

  return (
    <form ref={formulario} noValidate onSubmit={alEnviar}>
      <Pila separacion={4}>
        <AvisosDelEnvio
          enCurso={envio.enCurso}
          incierto={incierto}
          referenciaIncierta={referenciaIncierta}
          rechazo={rechazo}
        />
        <textarea
          className={estilos["area"]}
          rows={10}
          aria-labelledby={idDelTitulo}
          aria-invalid={marcado ? true : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={pem}
          disabled={bloqueado}
          onChange={(evento) => {
            setPem(evento.target.value);
            envio.reiniciar();
          }}
        />
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" enviando={envio.enCurso} alTocar={alCancelar}>
            {texto({}, "fiscal.pantalla.config_pv_cancelar")}
          </Boton>
          <Boton
            tipo="submit"
            enviando={envio.enCurso}
            textoEnviando={texto({}, "fiscal.pantalla.config_pv_guardando")}
            deshabilitado={!envio.enCurso && envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
          >
            {texto({}, "fiscal.pantalla.config_cert_cargar")}
          </Boton>
        </div>
      </Pila>
    </form>
  );
}
