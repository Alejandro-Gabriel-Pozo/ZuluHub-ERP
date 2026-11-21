import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { Insignia } from "../../componentes/Insignia";
import type { ListaArmada } from "./modelo-de-ordenes";
import estilos from "./PantallaDeListaDeOrdenes.module.css";

export type PropsDePantallaDeListaDeOrdenes = Readonly<{
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaArmada | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de órdenes de producción (maqueta `produccion.html`, 09/11/2026), solo lectura: los filtros «Todas» y «Abiertas» (enlaces, no campos) y una tarjeta por orden, que lleva a su
 * ficha: «Orden N · producto», el estado en texto y la cantidad con su unidad. Sin «Nueva orden» (otro tramo). Una lista vacía dice «Sin resultados» (aviso informativo). Sin textos
 * propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeOrdenes({ lista, error }: PropsDePantallaDeListaDeOrdenes) {
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
                    <span className={estilos["renglon"]}>
                      <span className={estilos["nombre"]}>{fila.titulo}</span>
                      <span className={estilos["cantidad"]}>{fila.cantidad}</span>
                    </span>
                    <span>
                      <Insignia tono={fila.estado.tono}>{fila.estado.texto}</Insignia>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
