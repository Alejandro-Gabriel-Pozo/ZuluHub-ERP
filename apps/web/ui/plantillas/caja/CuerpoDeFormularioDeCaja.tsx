import { useRef, type ReactNode, type SyntheticEvent } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Pila } from "../../primitivas/Pila";
import { AvisosDelEnvio } from "../configuracion-fiscal/AvisosDelEnvio";
import estilos from "./PantallaDeCaja.module.css";

export type PropsDeCuerpoDeFormularioDeCaja = Readonly<{
  children: ReactNode;
  /** Se llama al enviar (Enter en un campo o el botón principal), solo si `puedeEnviar`. */
  alEnviar: () => void;
  textoDeEnviar: string;
  /** El botón principal sale apagado si falta algo, si la persona no puede (el servidor lo dijo) o si no se puede enviar ahora. */
  puedeEnviar: boolean;
  textoDeCancelar: string;
  alCancelar: () => void;
  /** «Cancelar» sale apagado (el servidor no deja cancelar hoy). Solo una ayuda: el guard decide. */
  cancelarApagado?: boolean;
  /** Hay un pedido en vuelo o verificándose: los dos botones ignoran el toque. */
  ocupado: boolean;
  enCurso: boolean;
  incierto: boolean;
  referenciaIncierta: string | undefined;
  rechazo: ErrorPublico | null;
  /** Por qué no se puede enviar ahora (sin conexión o verificando). */
  motivoQueNoPuede: string | undefined;
}>;

/**
 * El esqueleto de los formularios de la pantalla «Caja» (abrir, movimiento, anular y contar): los campos, lo que dice el envío (verificando, el rechazo del servidor con su texto) y al pie
 * «Cancelar» y el botón principal. Con Enter dentro de un campo, el foco pasa al botón principal antes de que el campo se apague (`disabled`) al enviar: si no, caería al `<body>`.
 */
export function CuerpoDeFormularioDeCaja({
  children,
  alEnviar,
  textoDeEnviar,
  puedeEnviar,
  textoDeCancelar,
  alCancelar,
  cancelarApagado = false,
  ocupado,
  enCurso,
  incierto,
  referenciaIncierta,
  rechazo,
  motivoQueNoPuede,
}: PropsDeCuerpoDeFormularioDeCaja) {
  const formulario = useRef<HTMLFormElement>(null);
  function enviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    if (!puedeEnviar) return;
    formulario.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    alEnviar();
  }
  return (
    <form ref={formulario} noValidate onSubmit={enviar}>
      <Pila separacion={4}>
        {children}
        <AvisosDelEnvio
          enCurso={enCurso}
          incierto={incierto}
          referenciaIncierta={referenciaIncierta}
          rechazo={rechazo}
        />
        <div className={estilos["botones"]}>
          <Boton
            variante="secundaria"
            enviando={ocupado}
            deshabilitado={cancelarApagado && !ocupado}
            alTocar={alCancelar}
          >
            {textoDeCancelar}
          </Boton>
          <Boton
            tipo="submit"
            enviando={ocupado}
            deshabilitado={!puedeEnviar && !ocupado}
            motivo={motivoQueNoPuede}
          >
            {textoDeEnviar}
          </Boton>
        </div>
      </Pila>
    </form>
  );
}
