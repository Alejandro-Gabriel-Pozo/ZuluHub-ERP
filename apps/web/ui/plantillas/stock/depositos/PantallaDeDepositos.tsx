import { Boton } from "../../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import type { FilaDeDeposito } from "./modelo-de-depositos";
import estilos from "./PantallaDeDepositos.module.css";

export type PropsDePantallaDeDepositos = Readonly<{
  filas: readonly FilaDeDeposito[];
  textos: Readonly<{ agregar: string; deVenta: string }>;
  /** Si el servidor deja agregar hoy: si no, «Agregar depósito» sale apagado. Solo una ayuda: el guard decide. */
  puedeAgregar: boolean;
  /** Adónde lleva «Agregar depósito». */
  hrefDeAgregar: string;
}>;

/**
 * La lista de depósitos de la sucursal (maqueta `stock.html`, 09/11/2026): una tarjeta por depósito con su nombre, su uso y «De venta» si lo es; al pie, «Agregar depósito». Sin textos
 * propios: todos llegan resueltos. Sin permiso, el botón sale apagado (el servidor igual rechaza).
 */
export function PantallaDeDepositos({
  filas,
  textos,
  puedeAgregar,
  hrefDeAgregar,
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
          </li>
        ))}
      </ul>
      <div>
        {puedeAgregar ? (
          <EnlaceDeAccion href={hrefDeAgregar}>{textos.agregar}</EnlaceDeAccion>
        ) : (
          <Boton deshabilitado>{textos.agregar}</Boton>
        )}
      </div>
    </div>
  );
}
