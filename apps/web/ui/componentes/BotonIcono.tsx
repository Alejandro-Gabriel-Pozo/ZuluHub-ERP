import { Icono } from "../iconos/Icono";
import type { ClaveDeIcono } from "../iconos/catalogo";
import estilos from "./BotonIcono.module.css";

export type PropsDeBotonIcono = Readonly<{
  /**
   * Obligatoria: un botón que es solo un ícono no tiene texto que lo nombre. Sin `etiqueta` no
   * compila (P-8). Pasa a `aria-label`.
   */
  etiqueta: string;
  icono: ClaveDeIcono;
  alTocar?: () => void;
  deshabilitado?: boolean;
}>;

export function BotonIcono({ etiqueta, icono, alTocar, deshabilitado = false }: PropsDeBotonIcono) {
  return (
    <button
      type="button"
      className={estilos["botonIcono"]}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={() => {
        alTocar?.();
      }}
    >
      <Icono clave={icono} tamano="medio" decorativo />
    </button>
  );
}
