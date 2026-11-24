import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import { FormularioDeFiltrosDelDirectorio } from "./FormularioDeFiltrosDelDirectorio.cliente";
import estilos from "./PantallasDelDirectorio.module.css";
import {
  direccionDeLaLista,
  type FiltrosArmados,
  type ListaDelDirectorioArmada,
} from "./modelo-de-directorio";

export type PropsDePantallaDeListaDelDirectorio = Readonly<{
  filtros: FiltrosArmados;
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaDelDirectorioArmada | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de clientes y proveedores (maqueta `directorio.html`, aprobada el 09/11/2026): los filtros y una tarjeta por parte, también las desactivadas si se pidieron; cada tarjeta es
 * un enlace a su ficha y dice el nombre, el documento, una insignia por rol y la marca «Desactivado». «Nuevo» solo si llega armado, es decir, si la persona puede crear. Una lista vacía
 * dice «Sin resultados». Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDelDirectorio({
  filtros,
  lista,
  error,
}: PropsDePantallaDeListaDelDirectorio) {
  return (
    <div className={estilos["raiz"]}>
      {/* La `key` reinicia los campos cuando cambian los filtros de la dirección. */}
      <FormularioDeFiltrosDelDirectorio
        key={direccionDeLaLista(filtros.valores)}
        filtros={filtros}
      />
      {error ?? null}
      {lista === null ? null : (
        <>
          {lista.vacio !== null ? (
            <Aviso tono="info">{lista.vacio}</Aviso>
          ) : (
            <ul className={estilos["lista"]}>
              {lista.filas.map((fila) => (
                <li key={fila.id}>
                  <a className={estilos["fila"]} href={fila.href}>
                    <span className={estilos["renglon"]}>
                      <span className={estilos["nombre"]}>{fila.nombre}</span>
                      {fila.desactivado === null ? null : (
                        <Insignia tono="aviso">{fila.desactivado}</Insignia>
                      )}
                    </span>
                    <span className={estilos["documento"]}>{fila.documento}</span>
                    {fila.roles.length === 0 ? null : (
                      <span className={estilos["renglon"]}>
                        {fila.roles.map((rol) => (
                          <Insignia key={rol} tono="neutro">
                            {rol}
                          </Insignia>
                        ))}
                      </span>
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
          {lista.nuevo === null ? null : (
            <div>
              <EnlaceDeAccion href={lista.nuevo.href}>{lista.nuevo.texto}</EnlaceDeAccion>
            </div>
          )}
        </>
      )}
    </div>
  );
}
