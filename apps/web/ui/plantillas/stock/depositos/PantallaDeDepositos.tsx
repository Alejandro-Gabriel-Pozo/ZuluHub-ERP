import type { ReactNode } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeEstadoDeDeposito } from "./FormularioDeEstadoDeDeposito.cliente";
import type { FilaDeDeposito } from "./modelo-de-depositos";
import estilos from "./PantallaDeDepositos.module.css";

export type PropsDePantallaDeDepositos = Readonly<{
  filas: readonly FilaDeDeposito[];
  textos: Readonly<{
    agregar: string;
    deVenta: string;
    desactivado: string;
    editar: string;
    desactivar: string;
    reactivar: string;
  }>;
  /** Qué botones por fila se ofrecen hoy. Solo una ayuda: cada acción vuelve a pasar por el guard. Sin permiso, el botón no se dibuja (maqueta `stock-depositos-gestion.html`). */
  puede: Readonly<{ editar: boolean; desactivar: boolean; reactivar: boolean }>;
  /** Adónde lleva «Editar» de un depósito. */
  hrefDeEditar: (depositoId: string) => string;
  /** La acción de servidor de «Desactivar» (`activar: false`) o «Reactivar» (`activar: true`) con el depósito ya ligado. */
  accionDeEstado: (depositoId: string, activar: boolean) => AccionDeFormulario;
  /** Si el servidor deja agregar hoy: si no, «Agregar depósito» sale apagado. Solo una ayuda: el guard decide. */
  puedeAgregar: boolean;
  /** Adónde lleva «Agregar depósito». */
  hrefDeAgregar: string;
  /** Lo que se dibuja al pie en lugar de «Agregar depósito» (el formulario del alta, que va debajo de la lista). Sin él, la lista muestra el botón. */
  pie?: ReactNode;
}>;

/**
 * La lista de depósitos de la sucursal (maquetas `stock.html`, 09/11/2026, y `stock-depositos-gestion.html`, 25/11/2026): una tarjeta por depósito con su nombre, su uso, «De venta» si lo es y
 * «Desactivado» si lo está, con «Editar» y «Desactivar» (o «Reactivar» si está desactivado) para quien tiene el permiso; al pie, «Agregar depósito». Sin textos propios: todos llegan resueltos.
 * Sin permiso, «Agregar depósito» sale apagado y los botones de cada fila no se dibujan (el servidor igual rechaza). El alta reutiliza esta misma lista y pasa su formulario como `pie`.
 */
export function PantallaDeDepositos({
  filas,
  textos,
  puede,
  hrefDeEditar,
  accionDeEstado,
  puedeAgregar,
  hrefDeAgregar,
  pie,
}: PropsDePantallaDeDepositos) {
  return (
    <div className={estilos["raiz"]}>
      <ul className={estilos["lista"]}>
        {filas.map((fila) => (
          <li key={fila.id} className={estilos["tarjeta"]}>
            <div className={estilos["cabecera"]}>
              <strong className={estilos["titulo"]}>{fila.titulo}</strong>
              <Insignia tono="neutro">{fila.uso}</Insignia>
            </div>
            {fila.deVenta ? <span className={estilos["detalle"]}>{textos.deVenta}</span> : null}
            {fila.activo ? null : <Insignia tono="aviso">{textos.desactivado}</Insignia>}
            {(fila.activo && (puede.editar || puede.desactivar)) ||
            (!fila.activo && puede.reactivar) ? (
              <div className={estilos["acciones"]}>
                {fila.activo && puede.editar ? (
                  <EnlaceDeAccion href={hrefDeEditar(fila.id)} variante="secundaria">
                    {textos.editar}
                  </EnlaceDeAccion>
                ) : null}
                {fila.activo && puede.desactivar ? (
                  <FormularioDeEstadoDeDeposito
                    texto={textos.desactivar}
                    accion={accionDeEstado(fila.id, false)}
                  />
                ) : null}
                {!fila.activo && puede.reactivar ? (
                  <FormularioDeEstadoDeDeposito
                    texto={textos.reactivar}
                    accion={accionDeEstado(fila.id, true)}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div>
        {pie !== undefined ? (
          pie
        ) : puedeAgregar ? (
          <EnlaceDeAccion href={hrefDeAgregar}>{textos.agregar}</EnlaceDeAccion>
        ) : (
          <Boton deshabilitado>{textos.agregar}</Boton>
        )}
      </div>
    </div>
  );
}
