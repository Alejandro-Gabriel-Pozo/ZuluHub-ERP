import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import type { ListaDeRolesArmada } from "./modelo-de-roles";
import estilos from "./PantallaDeRoles.module.css";

export type PropsDePantallaDeListaDeRoles = Readonly<{ lista: ListaDeRolesArmada }>;

/**
 * «Roles»: los roles propios de la empresa, uno por fila con su nombre y cuántas personas lo tienen; el archivado lleva su insignia con texto. Cada fila es un enlace a su ficha. «Nuevo rol» (arriba) solo si
 * quien mira puede crear (`lista.nuevo`; `null` no se dibuja). Sin estado ni hooks: es una página de servidor.
 */
export function PantallaDeListaDeRoles({ lista }: PropsDePantallaDeListaDeRoles) {
  return (
    <div className={estilos["cuerpo"]}>
      {lista.nuevo === null ? null : (
        <div className={estilos["botones"]}>
          <EnlaceDeAccion href={lista.nuevo.href}>{lista.nuevo.texto}</EnlaceDeAccion>
        </div>
      )}
      {lista.vacia === null ? null : <p className={estilos["detalle"]}>{lista.vacia}</p>}
      <ul className={estilos["lista"]}>
        {lista.filas.map((f) => (
          <li key={f.rolId}>
            <a className={estilos["fila"]} href={f.href}>
              <span className={estilos["nombre"]}>{f.nombre}</span>{" "}
              <span className={estilos["detalle"]}>{f.personas}</span>{" "}
              {f.insignia === null ? null : (
                <span className={estilos["estado"]}>
                  <Insignia tono={f.insignia.tono}>{f.insignia.texto}</Insignia>
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
