import { Insignia } from "../../web/ui/componentes/Insignia";
import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import { textoDePlanes } from "../logica/textos-de-planes";
import type { FilaDePlan } from "../logica/vista-de-planes";
import estilos from "./empresas.module.css";

/** La lista de planes: tabla en escritorio y tarjetas en el celular (el mismo marcado, el CSS decide). El estado se dice con texto (la insignia), nunca solo con color. */
export function ListaDePlanes({ filas }: Readonly<{ filas: readonly FilaDePlan[] }>) {
  return (
    <table className={estilos["tabla"]}>
      <caption>
        <SoloLector>{textoDePlanes("plataforma.planes.titulo")}</SoloLector>
      </caption>
      <thead>
        <tr>
          <th scope="col">{textoDePlanes("plataforma.planes.col_plan")}</th>
          <th scope="col">{textoDePlanes("plataforma.planes.col_ultima")}</th>
          <th scope="col">{textoDePlanes("plataforma.planes.col_borrador")}</th>
          <th scope="col">{textoDePlanes("plataforma.planes.col_clientes")}</th>
          <th scope="col">{textoDePlanes("plataforma.planes.col_estado")}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => (
          <tr key={fila.id}>
            <th scope="row" className={estilos["nombre"]}>
              <a
                className={estilos["enlaceSimple"]}
                href={`/planes/${encodeURIComponent(fila.id)}`}
              >
                {fila.codigo}
              </a>
            </th>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.planes.col_ultima")}
              </span>
              <span>
                {fila.ultima === null
                  ? textoDePlanes("plataforma.planes.ninguna")
                  : `v${String(fila.ultima.numero)} · ${fila.ultima.nombreComercial}`}
              </span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.planes.col_borrador")}
              </span>
              <span>
                {fila.hayBorrador ? textoDePlanes("plataforma.planes.hay_borrador") : "—"}
              </span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.planes.col_clientes")}
              </span>
              <span>{fila.clientes}</span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.planes.col_estado")}
              </span>
              <span>
                <Insignia tono={fila.retirado ? "neutro" : "exito"}>
                  {textoDePlanes(
                    fila.retirado
                      ? "plataforma.planes.estado_retirado"
                      : "plataforma.planes.estado_activo",
                  )}
                </Insignia>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
