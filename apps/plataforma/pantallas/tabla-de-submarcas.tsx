import { Insignia } from "../../web/ui/componentes/Insignia";
import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import type { FilaDeSubmarca } from "../servidor/submarcas";
import estilos from "./empresas.module.css";
import propios from "./submarcas.module.css";

export type PropsDeTablaDeSubmarcas = Readonly<{
  filas: readonly FilaDeSubmarca[];
}>;

type Rotulo = Readonly<{ tono: "exito" | "aviso" | "neutro"; texto: string }>;

/** El estado de la submarca con palabras de la persona. Lo que no se conoce se muestra tal cual, sin color. */
function rotuloDeEstado(estado: string): Rotulo {
  switch (estado.toUpperCase()) {
    case "ACTIVA":
    case "ACTIVO":
      return { tono: "exito", texto: "Activa" };
    case "RETIRADA":
    case "RETIRADO":
      return { tono: "aviso", texto: "Retirada" };
    default:
      return { tono: "neutro", texto: estado };
  }
}

/**
 * La lista de submarcas: tabla en escritorio y tarjetas en el celular (el mismo marcado, el CSS decide). Todo
 * estado se dice con texto e ícono (la insignia), nunca solo con color.
 */
export function TablaDeSubmarcas({ filas }: PropsDeTablaDeSubmarcas) {
  return (
    <table className={estilos["tabla"]}>
      <caption>
        <SoloLector>Submarcas</SoloLector>
      </caption>
      <thead>
        <tr>
          <th scope="col">Submarca</th>
          <th scope="col">Código</th>
          <th scope="col">Estado</th>
          <th scope="col">Versión</th>
          <th scope="col">Pendientes</th>
          <th scope="col">
            <SoloLector>Acción</SoloLector>
          </th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => {
          const rotulo = rotuloDeEstado(fila.estado);
          return (
            <tr key={fila.id}>
              <th scope="row" className={estilos["nombre"]}>
                {fila.nombre}
              </th>
              <td>
                <span className={estilos["rotulo"]}>Código</span>
                <span>{fila.codigo}</span>
              </td>
              <td>
                <span className={estilos["rotulo"]}>Estado</span>
                <span>
                  <Insignia tono={rotulo.tono}>{rotulo.texto}</Insignia>
                </span>
              </td>
              <td>
                <span className={estilos["rotulo"]}>Versión</span>
                <span>
                  {fila.versionVigente === null
                    ? "Sin versión vigente"
                    : `Versión vigente ${String(fila.versionVigente)}`}
                </span>
              </td>
              <td>
                <span className={estilos["rotulo"]}>Pendientes</span>
                <span className={propios["insignias"]}>
                  {fila.hayBorrador ? (
                    <Insignia tono="aviso">Borrador sin confirmar</Insignia>
                  ) : null}
                  {fila.hayProgramada ? <Insignia tono="info">Cambio programado</Insignia> : null}
                  {fila.hayBorrador || fila.hayProgramada ? null : <span>Ninguno</span>}
                </span>
              </td>
              <td>
                <a
                  className={estilos["enlaceSimple"]}
                  href={`/submarcas/${encodeURIComponent(fila.id)}`}
                  aria-label={`Editar ${fila.nombre}`}
                >
                  Editar
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
