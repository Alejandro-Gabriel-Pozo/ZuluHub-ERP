import { Aviso } from "../../componentes/Aviso";
import { Insignia } from "../../componentes/Insignia";
import {
  armarLaFichaDeLaCuenta,
  type FichaDeCuentaParaLaPantalla,
} from "./modelo-de-cuenta-corriente";
import type { TextosDeCuentaCorriente } from "./textos-de-cuenta-corriente";
import estilos from "./CuentaCorriente.module.css";

export type PropsDePantallaDeLaFichaDeCuenta = Readonly<{
  ficha: FichaDeCuentaParaLaPantalla;
  textos: TextosDeCuentaCorriente;
}>;

/**
 * La ficha de un cliente con su estado de cuenta (CC-5, A1; maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, pestañas «Ficha y estado de cuenta» y «Ficha suspendida»): su CUIT y su estado, las condiciones
 * (límite, plazo), el saldo y el crédito disponible, el banner si la cuenta está suspendida y los movimientos con su origen. SOLO LECTURA: sin «Cambiar plazo o límite», «Suspender» ni «Reactivar» (llegan con su caso
 * de uso). Sin pies explicativos. Sin estado ni hooks: es una página de servidor. El `h1` (el nombre del cliente) lo pone la página.
 */
export function PantallaDeLaFichaDeCuenta({ ficha, textos }: PropsDePantallaDeLaFichaDeCuenta) {
  const armada = armarLaFichaDeLaCuenta(ficha, textos);
  const c = armada.condiciones;
  const k = armada.columnas;
  return (
    <div className={estilos["cuerpo"]}>
      <div className={estilos["encabezado"]}>
        <span className={estilos["suave"]}>{armada.cuit}</span>
        <Insignia tono={armada.estado.tono}>{armada.estado.texto}</Insignia>
      </div>
      {armada.suspendida === null ? null : (
        <Aviso tono="aviso">
          <strong>{armada.suspendida.titulo}</strong> {armada.suspendida.detalle}
        </Aviso>
      )}
      <dl className={estilos["condiciones"]}>
        {[c.limiteDeCredito, c.plazo, c.saldo, c.creditoDisponible].map((d) => (
          <div key={d.rotulo}>
            <dt>{d.rotulo}</dt>
            <dd>{d.valor}</dd>
          </div>
        ))}
      </dl>
      <div className={estilos["contenedorDeTabla"]}>
        <table className={estilos["tabla"]}>
          <thead>
            <tr>
              <th scope="col">{k.fecha}</th>
              <th scope="col">{k.movimiento}</th>
              <th scope="col">{k.origenDelMovimiento}</th>
              <th scope="col">{k.vence}</th>
              <th scope="col" className={estilos["numerica"]}>
                {k.importe}
              </th>
            </tr>
          </thead>
          <tbody>
            {armada.movimientos.map((m) => (
              <tr key={m.clave}>
                <td>{m.fecha}</td>
                <td>
                  {m.movimiento}
                  {m.vencida === null ? null : (
                    <>
                      {" "}
                      <Insignia tono="peligro">{m.vencida}</Insignia>
                    </>
                  )}
                </td>
                <td>{m.origen}</td>
                <td>{m.vence}</td>
                <td className={estilos["numerica"]}>{m.importe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
