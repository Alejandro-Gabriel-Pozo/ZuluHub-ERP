import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import {
  armarLaListaDeCuentas,
  type ListaDeCuentasParaLaPantalla,
} from "./modelo-de-cuenta-corriente";
import type { TextosDeCuentaCorriente } from "./textos-de-cuenta-corriente";
import estilos from "./CuentaCorriente.module.css";

export type PropsDePantallaDeLaListaDeCuentas = Readonly<{
  lista: ListaDeCuentasParaLaPantalla;
  textos: TextosDeCuentaCorriente;
}>;

/**
 * «Clientes con cuenta corriente» (CC-5, A1; maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, pestaña «Clientes con saldo»): un cliente por fila con su estado, su saldo, lo vencido, su límite, su crédito
 * disponible y su cargo más antiguo, ordenable por saldo, por vencido o por antigüedad. SOLO LECTURA: sin «Habilitar cliente» ni «Exportar» (llegan con su caso de uso). Sin pies explicativos (decisión del dueño,
 * 26/11/2026). Cada fila es un enlace a la ficha con su nombre accesible completo. Sin estado ni hooks: es una página de servidor. El `h1` lo pone el armazón.
 */
export function PantallaDeLaListaDeCuentas({ lista, textos }: PropsDePantallaDeLaListaDeCuentas) {
  const armada = armarLaListaDeCuentas(lista, textos);
  const c = armada.columnas;
  return (
    <div className={estilos["cuerpo"]}>
      <ul className={estilos["ordenes"]}>
        {armada.ordenes.map((o) => (
          <li key={o.orden}>
            <EnlaceDeAccion href={o.href} variante={o.activo ? "primaria" : "secundaria"}>
              {o.texto}
            </EnlaceDeAccion>
          </li>
        ))}
      </ul>
      {armada.vacio === null ? (
        <div className={estilos["contenedorDeTabla"]}>
          <table className={estilos["tabla"]}>
            <thead>
              <tr>
                <th scope="col">{c.cliente}</th>
                <th scope="col">{c.estado}</th>
                <th scope="col" className={estilos["numerica"]}>
                  {c.saldo}
                </th>
                <th scope="col" className={estilos["numerica"]}>
                  {c.vencido}
                </th>
                <th scope="col" className={estilos["numerica"]}>
                  {c.limite}
                </th>
                <th scope="col" className={estilos["numerica"]}>
                  {c.creditoDisponible}
                </th>
                <th scope="col">{c.cargoMasAntiguo}</th>
              </tr>
            </thead>
            <tbody>
              {armada.filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a className={estilos["enlace"]} href={f.href} aria-label={f.nombreAccesible}>
                      {f.cliente}
                    </a>
                    <div className={estilos["suave"]}>{f.cuit}</div>
                  </td>
                  <td>
                    <Insignia tono={f.estado.tono}>{f.estado.texto}</Insignia>
                  </td>
                  <td className={estilos["numerica"]}>{f.saldo}</td>
                  <td className={estilos["numerica"]}>{f.vencido}</td>
                  <td className={estilos["numerica"]}>{f.limite}</td>
                  <td className={estilos["numerica"]}>{f.creditoDisponible}</td>
                  <td>{f.cargoMasAntiguo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={estilos["suave"]}>{armada.vacio}</p>
      )}
    </div>
  );
}
