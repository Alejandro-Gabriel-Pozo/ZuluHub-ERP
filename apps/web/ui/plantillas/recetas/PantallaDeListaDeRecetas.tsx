import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import type { ListaDeRecetasArmada } from "./modelo-de-recetas";
import estilos from "./PantallaDeListaDeRecetas.module.css";

export type PropsDePantallaDeListaDeRecetas = Readonly<{
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaDeRecetasArmada | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de recetas (maqueta `receta.html`, 15/11/2026), solo lectura: los filtros «Todas» y «Sin receta» (enlaces, no campos) y una tarjeta por producto, que lleva a su ficha: el
 * nombre y, a la derecha, el costo de la comida (solo con `costos.ver`) o «Sin receta». «Nueva receta» abajo, solo si el modelo la ofrece. Una lista vacía dice «Sin resultados» (aviso informativo). Sin
 * textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeRecetas({ lista, error }: PropsDePantallaDeListaDeRecetas) {
  return (
    <div className={estilos["raiz"]}>
      {error ?? null}
      {lista === null ? null : (
        <>
          <ul className={estilos["filtros"]}>
            {lista.filtros.map((filtro) => (
              <li key={filtro.href}>
                <a
                  className={estilos["filtro"]}
                  href={filtro.href}
                  {...(filtro.actual ? { "aria-current": "page" as const } : {})}
                >
                  {filtro.texto}
                </a>
              </li>
            ))}
          </ul>
          {lista.vacio !== null ? (
            <Aviso tono="info">{lista.vacio}</Aviso>
          ) : (
            <ul className={estilos["lista"]}>
              {lista.filas.map((fila) => (
                <li key={fila.id}>
                  <a className={estilos["tarjeta"]} href={fila.href}>
                    <span className={estilos["nombre"]}>{fila.nombre}</span>
                    {fila.sinReceta !== null ? (
                      <span>{fila.sinReceta}</span>
                    ) : fila.costo === null ? null : (
                      <span className={estilos["costo"]}>{fila.costo}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {lista.siguiente === null ? null : (
            <a className={estilos["siguiente"]} href={lista.siguiente.href}>
              {lista.siguiente.texto}
            </a>
          )}
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
