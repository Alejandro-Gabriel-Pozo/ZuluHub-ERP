import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import type { TextosDeCompras } from "../textos-de-compras";
import { armarLaFicha, type FichaDeCompraParaLaPantalla } from "./modelo-de-ficha-de-compra";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeFichaDeCompra = Readonly<{
  ficha: FichaDeCompraParaLaPantalla;
  textos: TextosDeCompras;
}>;

/**
 * La ficha de una compra (maqueta `compra-corregir-anular.html`, `vFicha`, sin «Corregir», «Anular», el pago ni «Corregido por…»; Compras PR 3): proveedor y fecha, el remito, cada línea con
 * lo que entra a tu stock y su costo por unidad de stock, el total y la factura si la hay; si está anulada, el motivo, quién y cuándo. SOLO LECTURA: ningún botón de acción, solo «Volver».
 * Sin estado ni hooks: es una página de servidor. «Anulada» se dice con texto, no solo con color. El `h1` («Compra 5») lo pone el armazón.
 */
export function PantallaDeFichaDeCompra({ ficha, textos }: PropsDePantallaDeFichaDeCompra) {
  const f = armarLaFicha(ficha, textos);
  return (
    <div className={estilos["cuerpo"]}>
      <EnlaceDeAccion href={f.volver.href} variante="secundaria">
        {f.volver.texto}
      </EnlaceDeAccion>
      {f.anulada === null ? null : <Insignia tono="peligro">{f.anulada}</Insignia>}
      <p className={estilos["suave"]}>{f.proveedorYFecha}</p>
      {f.anulacion === null ? null : (
        <section className={estilos["tarjeta"]}>
          <p className={estilos["renglon"]}>
            <span className={estilos["suave"]}>{f.anulacion.rotulo}</span>
            <span>{f.anulacion.motivo}</span>
          </p>
          {f.anulacion.quien === null ? null : (
            <p className={estilos["suave"]}>{f.anulacion.quien}</p>
          )}
        </section>
      )}
      <p className={estilos["renglon"]}>
        <span className={estilos["suave"]}>{f.remito.rotulo}</span>
        {f.remito.valor === "" ? null : <span>{f.remito.valor}</span>}
      </p>
      <ul className={estilos["lista"]}>
        {f.lineas.map((l) => (
          <li key={l.clave} className={estilos["linea"]}>
            <span className={estilos["titulo"]}>{l.nombre}</span>
            <span className={estilos["importe"]}>{l.importe}</span>
            <span className={estilos["detalle"]}>{l.cantidad}</span>
            {l.costo === null ? null : <span className={estilos["detalle"]}>{l.costo}</span>}
          </li>
        ))}
      </ul>
      <p className={estilos["total"]}>
        <span>{f.total.rotulo}</span>
        <span className={estilos["importe"]}>{f.total.valor}</span>
      </p>
      {f.factura === null ? null : (
        <section className={estilos["tarjeta"]}>
          <h3 className={estilos["seccion"]}>{f.factura.titulo}</h3>
          {f.factura.fechas === null ? null : (
            <p className={estilos["suave"]}>{f.factura.fechas}</p>
          )}
          <p className={estilos["total"]}>
            <span>{f.factura.rotuloDelTotal}</span>
            <span className={estilos["importe"]}>{f.factura.total}</span>
          </p>
        </section>
      )}
      {f.quien === null ? null : <p className={estilos["suave"]}>{f.quien}</p>}
    </div>
  );
}
