import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import estilos from "../Compras.module.css";
import {
  armarLasFacturas,
  rutaDeLaFichaDelProveedor,
  type FichaDelProveedorParaLaPantalla,
} from "./modelo-de-ficha-de-proveedor";
import type { TextosDeProveedor } from "./textos-de-proveedor";

export type PropsDePantallaDeFacturasDelProveedor = Readonly<{
  ficha: FichaDelProveedorParaLaPantalla;
  textos: TextosDeProveedor;
}>;

/**
 * Todas las facturas y notas del proveedor, de la más nueva a la más vieja, con su estado (maqueta `compra.html`, estado `facturas-prov`; Compras PR 4). SOLO LECTURA: sin botones de acción, solo «Volver»
 * a la ficha. Sin estado ni hooks: es una página de servidor. «Anulada» se dice con texto, no solo con color; una nota de crédito lleva el signo menos. El `h1` («Facturas y notas») lo pone el armazón.
 */
export function PantallaDeFacturasDelProveedor({
  ficha,
  textos,
}: PropsDePantallaDeFacturasDelProveedor) {
  const filas = armarLasFacturas(ficha.facturas, textos);
  return (
    <div className={estilos["cuerpo"]}>
      <EnlaceDeAccion href={rutaDeLaFichaDelProveedor(ficha.parteId)} variante="secundaria">
        {textos.volver}
      </EnlaceDeAccion>
      {filas.length === 0 ? (
        <p className={estilos["suave"]}>{textos.todaviaNoTieneFacturas}</p>
      ) : null}
      <ul className={estilos["lista"]}>
        {filas.map((x) => (
          <li key={x.clave} className={estilos["linea"]}>
            <span className={estilos["titulo"]}>{x.nombre}</span>
            <span className={estilos["importe"]}>{x.total}</span>
            <span className={estilos["detalle"]}>{x.segunda}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
