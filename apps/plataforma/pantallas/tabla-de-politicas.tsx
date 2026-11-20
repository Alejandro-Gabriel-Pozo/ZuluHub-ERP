import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import {
  diasConUnidad,
  fechaDeLaVersion,
  type VersionDePolitica,
} from "../logica/politica-de-plan";
import { textoDePlanes } from "../logica/textos-de-planes";
import estilos from "./empresas.module.css";

/** El historial de la política, la versión más nueva arriba (viene ya ordenado del servidor): tabla en escritorio y tarjetas en el celular. Nada se edita ni se borra: cada versión es un registro. */
export function TablaDePoliticas({ filas }: Readonly<{ filas: readonly VersionDePolitica[] }>) {
  return (
    <table className={estilos["tabla"]}>
      <caption>
        <SoloLector>{textoDePlanes("plataforma.politica.historial")}</SoloLector>
      </caption>
      <thead>
        <tr>
          <th scope="col">{textoDePlanes("plataforma.politica.col_fecha")}</th>
          <th scope="col">{textoDePlanes("plataforma.politica.col_suba")}</th>
          <th scope="col">{textoDePlanes("plataforma.politica.col_baja")}</th>
          <th scope="col">{textoDePlanes("plataforma.politica.col_arrepentimiento")}</th>
          <th scope="col">{textoDePlanes("plataforma.politica.col_definida_por")}</th>
          <th scope="col">{textoDePlanes("plataforma.politica.col_motivo")}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => (
          <tr key={fila.version}>
            <th scope="row" className={estilos["nombre"]}>
              {fechaDeLaVersion(fila)}
            </th>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.politica.col_suba")}
              </span>
              <span>{diasConUnidad(fila.suba)}</span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.politica.col_baja")}
              </span>
              <span>{diasConUnidad(fila.baja)}</span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.politica.col_arrepentimiento")}
              </span>
              <span>{diasConUnidad(fila.arrepentimiento)}</span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.politica.col_definida_por")}
              </span>
              <span>{fila.definidaPor}</span>
            </td>
            <td>
              <span className={estilos["rotulo"]}>
                {textoDePlanes("plataforma.politica.col_motivo")}
              </span>
              <span className={estilos["motivo"]}>{fila.motivo}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
