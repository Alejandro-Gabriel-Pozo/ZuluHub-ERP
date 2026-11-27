import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
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
  /** «Nuevo producto», ya armado solo si la persona puede crear; sin él (o `null`) no se muestra: nace cerrado. */
  nuevo?: Readonly<{ href: string; texto: string }> | null;
  /** El filtro «Oculto» (C2), ya armado solo si se pudo leer dónde está oculto cada producto; sin él (o `null`) no se muestra. */
  filtroDeOcultos?: Readonly<{ href: string; texto: string }> | null;
}>;

/**
 * La lista de productos (A1, T1; maqueta `productos.html`, 12/11/2026), solo lectura: los filtros y una tarjeta por producto, también los desactivados. Cada tarjeta dice el
 * nombre, su marca de estado, «clase · sección» («clase · —» si se vende y no tiene sección; solo la clase si no se vende) y el precio. «Nuevo producto» (al final, como el pie de la maqueta) solo si llega armado, es decir, si la persona puede crear. El nombre enlaza a la ficha del producto (`/catalogo/productos/[id]`; sin él solo se llegaba por la redirección al crear); sin «Ocultar» acá: es de otro tramo. Una lista vacía dice «Sin resultados» (aviso informativo, el mismo patrón del listado de comprobantes). Una sola lista de tarjetas en celular y escritorio. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeProductos({
  filtros,
  lista,
  error,
  nuevo = null,
  filtroDeOcultos = null,
}: PropsDePantallaDeListaDeProductos) {
  return (
    <div className={estilos["raiz"]}>
      {/* La `key` reinicia los campos cuando cambian los filtros de la dirección. */}
      <FormularioDeFiltrosDeProductos
        key={direccionDeLaLista(filtros.valores, null)}
        filtros={filtros}
      />
      {filtroDeOcultos === null ? null : (
        <div>
          <EnlaceDeAccion href={filtroDeOcultos.href}>{filtroDeOcultos.texto}</EnlaceDeAccion>
        </div>
      )}
      {error ?? null}
      {lista === null ? null : (
        <>
          {lista.vacio !== null ? (
            <Aviso tono="info">{lista.vacio}</Aviso>
          ) : (
            <ul className={estilos["lista"]}>
              {lista.filas.map((fila) => (
                <li key={fila.id} className={estilos["tarjeta"]}>
                  <div className={estilos["renglon"]}>
                    <a className={estilos["enlaceDelNombre"]} href={fila.href}>
                      <strong className={estilos["nombre"]}>{fila.nombre}</strong>
                    </a>
                    {fila.marca === null ? null : (
                      <Insignia tono={fila.marca.tono}>{fila.marca.texto}</Insignia>
                    )}
                    {fila.avisosDeOculto.map((aviso) => (
                      <Insignia key={aviso} tono="aviso">
                        {aviso}
                      </Insignia>
                    ))}
                  </div>
                  <div className={estilos["renglon"]}>
                    <span className={estilos["clase"]}>
                      {fila.seccion === null ? fila.clase : `${fila.clase} · ${fila.seccion}`}
                      {fila.sinSeccion ? <span aria-hidden="true"> · —</span> : null}
                    </span>
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
      {nuevo === null ? null : (
        <div>
          <EnlaceDeAccion href={nuevo.href}>{nuevo.texto}</EnlaceDeAccion>
        </div>
      )}
    </div>
  );
}
