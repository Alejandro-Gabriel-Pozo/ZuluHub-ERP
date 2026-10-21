import { Insignia } from "../../web/ui/componentes/Insignia";
import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import { rotuloDeEstado } from "../logica/filtros-de-empresas";
import { cuitConGuiones } from "../logica/formato-de-cuit";
import type { FilaDeEmpresa } from "../servidor/empresas";
import estilos from "./empresas.module.css";

export type PropsDeTablaDeEmpresas = Readonly<{
  filas: readonly FilaDeEmpresa[];
}>;

/**
 * La lista de empresas: tabla en escritorio y tarjetas en el celular (el mismo marcado, el CSS decide). El estado
 * se dice con texto e ícono (la insignia), nunca solo con color. La fila todavía no es un enlace: la ficha no existe.
 */
export function TablaDeEmpresas({ filas }: PropsDeTablaDeEmpresas) {
  return (
    <table className={estilos["tabla"]}>
      <caption>
        <SoloLector>Empresas</SoloLector>
      </caption>
      <thead>
        <tr>
          <th scope="col">Empresa</th>
          <th scope="col">CUIT</th>
          <th scope="col">Submarca</th>
          <th scope="col">Plan</th>
          <th scope="col">Estado</th>
          <th scope="col">
            <SoloLector>Acción</SoloLector>
          </th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => {
          const rotulo = rotuloDeEstado(fila.estadoEfectivo);
          return (
            <tr key={fila.id}>
              <th scope="row" className={estilos["nombre"]}>
                {fila.razonSocial}
              </th>
              <td>
                <span className={estilos["rotulo"]}>CUIT</span>
                <span>{cuitConGuiones(fila.cuit)}</span>
              </td>
              <td>
                <span className={estilos["rotulo"]}>Submarca</span>
                <span>{fila.submarca}</span>
              </td>
              <td>
                <span className={estilos["rotulo"]}>Plan</span>
                <span>{fila.plan}</span>
              </td>
              <td>
                <span className={estilos["rotulo"]}>Estado</span>
                <span>
                  <Insignia tono={rotulo.tono}>{rotulo.texto}</Insignia>
                  {fila.motivoEstado === null ? null : (
                    <span className={estilos["motivo"]}>{fila.motivoEstado}</span>
                  )}
                </span>
              </td>
              <td>
                <a
                  className={estilos["enlaceSimple"]}
                  href={`/empresas/${encodeURIComponent(fila.id)}/plan`}
                  aria-label={`Plan de ${fila.razonSocial}`}
                >
                  Plan
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
