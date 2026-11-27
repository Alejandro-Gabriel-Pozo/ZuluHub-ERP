import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import type { ListaDeSucursalesArmada } from "./modelo-de-sucursales";
import estilos from "./PantallaDeSucursales.module.css";

export type PropsDePantallaDeListaDeSucursales = Readonly<{ lista: ListaDeSucursalesArmada }>;

/**
 * «Sucursales»: las sucursales activas de la empresa, una por fila con su nombre (sin enlaces ni estados). «Nueva sucursal» (arriba) solo si quien mira puede crear (`lista.nuevo`; `null` no se dibuja).
 * Sin estado ni hooks: es una página de servidor.
 */
export function PantallaDeListaDeSucursales({ lista }: PropsDePantallaDeListaDeSucursales) {
  return (
    <div className={estilos["cuerpo"]}>
      {lista.nuevo === null ? null : (
        <div className={estilos["botones"]}>
          <EnlaceDeAccion href={lista.nuevo.href}>{lista.nuevo.texto}</EnlaceDeAccion>
        </div>
      )}
      <ul className={estilos["lista"]}>
        {lista.filas.map((f) => (
          <li key={f.id} className={estilos["fila"]}>
            <span className={estilos["nombre"]}>{f.nombre}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
