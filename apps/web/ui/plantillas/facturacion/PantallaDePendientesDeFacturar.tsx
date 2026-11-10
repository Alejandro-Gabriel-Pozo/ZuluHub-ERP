import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import estilos from "./PantallaDeListadoDeComprobantes.module.css";
import type { PendientesArmados } from "./modelo-de-pendientes";

export type PropsDePantallaDePendientesDeFacturar = Readonly<{
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  pendientes: PendientesArmados | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * «Pendientes de facturar»: una tarjeta por venta cobrada sin comprobante (el número, el día y el total); toda la tarjeta es el enlace a
 * Emitir desde ese ticket. Las mismas tarjetas del Listado (6A) en celular y escritorio. Sin filtros ni acciones propias: la sucursal es la
 * que la persona eligió en el Listado y el `h1` lo pone el armazón.
 */
export function PantallaDePendientesDeFacturar({
  pendientes,
  error,
}: PropsDePantallaDePendientesDeFacturar) {
  return (
    <div className={estilos["raiz"]}>
      {error ?? null}
      {pendientes === null ? null : pendientes.vacio !== null ? (
        <Aviso tono="info">{pendientes.vacio}</Aviso>
      ) : (
        <ul className={estilos["tarjetas"]}>
          {pendientes.filas.map((fila) => (
            <li key={fila.id}>
              <a className={estilos["tarjeta"]} href={fila.href}>
                <span className={estilos["datos"]}>
                  <span className={estilos["cliente"]}>{fila.venta}</span>
                  <span className={estilos["secundario"]}>{fila.fecha}</span>
                </span>
                <span className={estilos["cifras"]}>
                  <span className={estilos["importe"]}>{fila.total}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {pendientes?.siguiente == null ? null : (
        <a className={estilos["siguiente"]} href={pendientes.siguiente.href}>
          {pendientes.siguiente.texto}
        </a>
      )}
    </div>
  );
}
