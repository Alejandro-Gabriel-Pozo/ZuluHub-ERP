import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { BotonIcono } from "../componentes/BotonIcono";
import estilos from "./Superposicion.module.css";

export type PropositoDeSuperposicion = "elegir" | "confirmar" | "editar" | "detalle";

export type PropsDeSuperposicion = Readonly<{
  abierta: boolean;
  /** Nombre accesible de la superposición (texto ya resuelto). */
  titulo: string;
  proposito: PropositoDeSuperposicion;
  /** Se llama cuando el usuario pide cerrar (Escape o el botón de cerrar), solo si `cerrable`. */
  alCerrar: () => void;
  /** Falso mientras se envía: no se cierra con Escape ni queda el botón de cerrar. */
  cerrable: boolean;
  /** El texto accesible del botón de cerrar («Cerrar»). */
  etiquetaDeCerrar: string;
  children: ReactNode;
}>;

const FOCALIZABLES =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focalizablesDe(dialogo: HTMLDialogElement): HTMLElement[] {
  return [...dialogo.querySelectorAll<HTMLElement>(FOCALIZABLES)].filter(
    (el) => el.getAttribute("aria-disabled") !== "true" && el.offsetParent !== null,
  );
}

/**
 * Superposición modal sobre `<dialog>` ([01] §6.1): un solo patrón con un propósito; la presentación
 * (hoja inferior, pantalla completa, diálogo, panel) la decide el CSS según el propósito y el ancho.
 *  - El fondo queda inerte (`showModal`) y el foco no sale: Tab da la vuelta dentro de la superposición.
 *  - Foco inicial: en `confirmar` va al TÍTULO (nunca al botón que mueve dinero o anula); en los
 *    demás, al primer control.
 *  - Escape cierra solo si `cerrable`. Nunca se cierra tocando el fondo: un toque de más no pierde lo cargado.
 *  - Al cerrar, el foco vuelve a quien la abrió.
 * Un solo nivel apilado; dos solo para confirmar dentro de un `editar`.
 */
export function Superposicion({
  abierta,
  titulo,
  proposito,
  alCerrar,
  cerrable,
  etiquetaDeCerrar,
  children,
}: PropsDeSuperposicion) {
  const idDelTitulo = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulado = useRef<HTMLHeadingElement>(null);
  const quienAbrio = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = dialogo.current;
    if (el === null) return;
    if (abierta && !el.open) {
      quienAbrio.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      // `showModal` ya enfoca algo; acá se fija el foco inicial que corresponde al propósito.
      const primero = focalizablesDe(el).find(
        (c) => c.closest("[data-cerrar-superposicion]") === null,
      );
      if (proposito === "confirmar" || primero === undefined) titulado.current?.focus();
      else primero.focus();
    }
    if (!abierta && el.open) {
      el.close();
      quienAbrio.current?.focus();
      quienAbrio.current = null;
    }
  }, [abierta, proposito]);

  // Si se desmonta abierta, el foco vuelve igual.
  useEffect(
    () => () => {
      quienAbrio.current?.focus();
    },
    [],
  );

  function alTeclear(evento: KeyboardEvent<HTMLDialogElement>) {
    const el = dialogo.current;
    if (el === null) return;
    if (evento.key === "Escape") {
      // Se decide acá y no en el navegador: un segundo Escape seguido saltearía el `cancel`.
      evento.preventDefault();
      if (cerrable) alCerrar();
      return;
    }
    if (evento.key !== "Tab") return;
    const lista = focalizablesDe(el);
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const activo = document.activeElement;
    if (primero === undefined || ultimo === undefined) {
      evento.preventDefault();
      titulado.current?.focus();
    } else if (evento.shiftKey && (activo === primero || activo === titulado.current)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  return (
    <dialog
      ref={dialogo}
      className={estilos["dialogo"]}
      data-proposito={proposito}
      aria-labelledby={idDelTitulo}
      onKeyDown={alTeclear}
      onCancel={(evento) => {
        // El cierre lo gobierna `abierta`: el navegador no cierra por su cuenta.
        evento.preventDefault();
        if (cerrable) alCerrar();
      }}
    >
      {abierta ? (
        <div className={estilos["contenido"]}>
          <div className={estilos["cabecera"]}>
            <h2 id={idDelTitulo} ref={titulado} tabIndex={-1} className={estilos["titulo"]}>
              {titulo}
            </h2>
            {cerrable ? (
              <span data-cerrar-superposicion="">
                <BotonIcono etiqueta={etiquetaDeCerrar} icono="cerrar" alTocar={alCerrar} />
              </span>
            ) : null}
          </div>
          <div className={estilos["cuerpo"]}>{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
