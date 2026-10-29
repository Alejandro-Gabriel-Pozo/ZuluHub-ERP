import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { EleccionDeSucursal } from "./EleccionDeSucursal.cliente";
import { FormularioDeFiltros } from "./FormularioDeFiltros.cliente";
import estilos from "./PantallaDeListadoDeComprobantes.module.css";
import { direccionDelListado, type FiltrosArmados } from "./filtros-del-listado";
import type { EleccionDeSucursalArmada, FilaArmada, ListadoArmado } from "./modelo-del-listado";

export type PropsDePantallaDeListadoDeComprobantes = Readonly<{
  /** Elegir la sucursal; `null` si no hay nada que elegir (D-36). */
  eleccionDeSucursal: EleccionDeSucursalArmada | null;
  accionDeSucursal: AccionDeFormulario;
  /** Los filtros; `null` mientras no hay una sucursal con la que listar. */
  filtros: FiltrosArmados | null;
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  listado: ListadoArmado | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

function Estados({ fila }: Readonly<{ fila: FilaArmada }>) {
  return (
    <span className={estilos["estados"]}>
      <Insignia tono={fila.estado.tono}>{fila.estado.texto}</Insignia>
      {fila.anulacion === null ? null : <Insignia tono="aviso">{fila.anulacion}</Insignia>}
    </span>
  );
}

/** 6A: en el celular, una tarjeta por comprobante (cliente, documento, comprobante y fecha: D-53); toda la tarjeta es el enlace al detalle. */
function Tarjetas({ filas }: Readonly<{ filas: readonly FilaArmada[] }>) {
  return (
    <ul className={estilos["tarjetas"]}>
      {filas.map((fila) => (
        <li key={fila.id}>
          <a className={estilos["tarjeta"]} href={fila.href}>
            <span className={estilos["datos"]}>
              <span className={estilos["cliente"]}>{fila.cliente}</span>
              <span className={estilos["secundario"]}>{fila.documento}</span>
              <span className={estilos["secundario"]}>
                {fila.comprobante} · {fila.fecha}
              </span>
            </span>
            <span className={estilos["cifras"]}>
              <span className={estilos["importe"]}>{fila.total}</span>
              <Estados fila={fila} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** 6C: en escritorio, una tabla; el enlace al detalle está en el comprobante y cubre toda la fila. */
function Tabla({ listado }: Readonly<{ listado: ListadoArmado }>) {
  const c = listado.columnas;
  return (
    <div className={estilos["contenedorDeTabla"]}>
      <table className={estilos["tabla"]}>
        <thead>
          <tr>
            <th scope="col">{c.fecha}</th>
            <th scope="col">{c.comprobante}</th>
            <th scope="col">{c.cliente}</th>
            <th scope="col">{c.documento}</th>
            <th scope="col">{c.puntoDeVenta}</th>
            <th scope="col" className={estilos["numerica"]}>
              {c.total}
            </th>
            <th scope="col">{c.estado}</th>
          </tr>
        </thead>
        <tbody>
          {listado.filas.map((fila) => (
            <tr key={fila.id}>
              <td>{fila.fecha}</td>
              <td className={estilos["celdaQueCede"]}>
                <a className={estilos["enlaceDeFila"]} href={fila.href}>
                  {fila.comprobante}
                </a>
              </td>
              <td className={estilos["cliente"]}>{fila.cliente}</td>
              <td>{fila.documento}</td>
              <td>{fila.puntoDeVenta}</td>
              <td className={`${estilos["numerica"]} ${estilos["importe"]}`}>{fila.total}</td>
              <td className={estilos["celdaDeEstado"]}>
                <Estados fila={fila} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * El listado de comprobantes (contrato de la pantalla 1, 6A + 6C): los filtros, la lista y «Página siguiente». Una sola lista de
 * datos que se pinta como tarjetas en el celular y como tabla en escritorio (el CSS elige cuál se ve; la otra queda fuera del
 * árbol de accesibilidad). Sin Exportar, Origen, Pago, Referencias, «+ Emitir», cantidad ni total del resultado: no están en el
 * contrato (D-3, D-33, D-23, D-32). El `h1` lo pone el armazón.
 */
export function PantallaDeListadoDeComprobantes({
  eleccionDeSucursal,
  accionDeSucursal,
  filtros,
  listado,
  error,
}: PropsDePantallaDeListadoDeComprobantes) {
  return (
    <div className={estilos["raiz"]}>
      {eleccionDeSucursal === null ? null : (
        // Con nombre («Sucursal»): el grupo de la elección de sucursal se anuncia aparte del formulario de filtros.
        <div className={estilos["sucursal"]} role="group" aria-label={eleccionDeSucursal.rotulo}>
          <EleccionDeSucursal eleccion={eleccionDeSucursal} accion={accionDeSucursal} />
        </div>
      )}
      {filtros === null ? null : (
        // La `key` reinicia los campos cuando cambian los filtros de la dirección («Limpiar», un filtro nuevo).
        <FormularioDeFiltros key={direccionDelListado(filtros.valores, null)} filtros={filtros} />
      )}
      {error ?? null}
      {listado === null ? null : listado.vacio !== null ? (
        <Aviso tono="info">{listado.vacio}</Aviso>
      ) : (
        <>
          <Tarjetas filas={listado.filas} />
          <Tabla listado={listado} />
        </>
      )}
      {listado?.siguiente == null ? null : (
        <a className={estilos["siguiente"]} href={listado.siguiente.href}>
          {listado.siguiente.texto}
        </a>
      )}
    </div>
  );
}
