import type { ReactNode } from "react";
import { Insignia } from "../../componentes/Insignia";
import { FormularioDeFiltrosDeProductos } from "./FormularioDeFiltrosDeProductos.cliente";
import estilos from "./PantallaDeListaDeProductos.module.css";
import { direccionDeLaLista, type FiltrosArmados } from "./filtros-de-productos";
import type { ListaArmada } from "./modelo-de-productos";

export type PropsDePantallaDeListaDeProductos = Readonly<{
  filtros: FiltrosArmados;
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaArmada | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de productos (A1, T1; maqueta `productos.html`, 12/11/2026), solo lectura: los filtros y una tarjeta por producto, también los desactivados. Cada tarjeta dice el
 * nombre, su marca de estado, la clase y el precio. Sin enlace a la ficha, sin «Nuevo producto» ni «Ocultar»: son de otros tramos. Una lista vacía no dice nada (no hay un
 * texto aprobado para eso). Una sola lista de tarjetas en celular y escritorio. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeProductos({
  filtros,
  lista,
  error,
}: PropsDePantallaDeListaDeProductos) {
  return (
    <div className={estilos["raiz"]}>
      {/* La `key` reinicia los campos cuando cambian los filtros de la dirección. */}
      <FormularioDeFiltrosDeProductos
        key={direccionDeLaLista(filtros.valores, null)}
        filtros={filtros}
      />
      {error ?? null}
      {lista === null ? null : (
        <>
          {lista.filas.length === 0 ? null : (
            <ul className={estilos["lista"]}>
              {lista.filas.map((fila) => (
                <li key={fila.id} className={estilos["tarjeta"]}>
                  <div className={estilos["renglon"]}>
                    <strong className={estilos["nombre"]}>{fila.nombre}</strong>
                    {fila.marca === null ? null : (
                      <Insignia tono={fila.marca.tono}>{fila.marca.texto}</Insignia>
                    )}
                  </div>
                  <div className={estilos["renglon"]}>
                    <span className={estilos["clase"]}>{fila.clase}</span>
                    {fila.precio === null ? null : (
                      <span className={estilos["precio"]}>{fila.precio}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {lista.siguiente === null ? null : (
            <a className={estilos["siguiente"]} href={lista.siguiente.href}>
              {lista.siguiente.texto}
            </a>
          )}
        </>
      )}
    </div>
  );
}
