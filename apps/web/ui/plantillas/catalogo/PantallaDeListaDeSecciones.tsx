import type { ReactNode } from "react";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { ListaDeSecciones } from "./ListaDeSecciones.cliente";
import estilos from "./PantallasDeSecciones.module.css";
import type { ListaDeSeccionesArmada } from "./modelo-de-secciones";

export type PropsDePantallaDeListaDeSecciones = Readonly<{
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaDeSeccionesArmada | null;
  /** La acción de las flechas, ya ligada a las secciones que la página vio. */
  accion: AccionDeFormulario;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de las secciones de la carta (A8, parte 1; maqueta `productos-secciones.html`, 12/11/2026): todas, también las desactivadas, en el orden de la carta, con las flechas de las activas.
 * «Nueva sección» (al final, como el pie de la maqueta) solo si llega armada, es decir, si la persona puede editar. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeSecciones({
  lista,
  accion,
  error,
}: PropsDePantallaDeListaDeSecciones) {
  return (
    <div className={estilos["raiz"]}>
      {error ?? null}
      {lista === null ? null : (
        <>
          <ListaDeSecciones lista={lista} accion={accion} />
          {lista.nueva === null ? null : (
            <div>
              <EnlaceDeAccion href={lista.nueva.href}>{lista.nueva.texto}</EnlaceDeAccion>
            </div>
          )}
        </>
      )}
    </div>
  );
}
