"use client";

import { Boton } from "../../componentes/Boton.cliente";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { ControlDeCantidad } from "./ControlDeCantidad.cliente";
import estilos from "./VentaRapida.module.css";
import {
  cantidadParaLeer,
  formaDeCantidad,
  nombreDeLaUnidad,
  type ProductoDeLaVenta,
  type TextosDeLaVenta,
} from "./modelo-de-venta-rapida";
import {
  detalleDeLaLinea,
  type CotizacionDeLaVenta,
  type LineaDeLaVenta,
} from "./modelo-de-la-cuenta";

export type PropsDeCuentaDeLaVenta = Readonly<{
  cuenta: readonly LineaDeLaVenta[];
  productos: ReadonlyMap<string, ProductoDeLaVenta>;
  /** La cotización del servidor para ESTA cuenta, o `null` si todavía no llegó (o no se pudo): el importe de cada línea no se muestra hasta que sea del servidor. */
  cotizacion: CotizacionDeLaVenta | null;
  textos: TextosDeLaVenta;
  alCambiarCantidad: (clave: string, cantidad: number | null) => void;
  alQuitar: (clave: string) => void;
}>;

/**
 * La cuenta (maqueta `venta-rapida-v4.html`): cada línea con su cantidad, que se corrige escribiéndola, y su importe. El importe de cada línea y el total salen SIEMPRE de la cotización del servidor
 * (`cotizacion`): esta pantalla no suma nada; mientras la cotización de la cuenta actual no llega, no se muestra ningún importe (nunca uno viejo ni uno calculado acá). Con la cuenta vacía dice
 * «La cuenta está vacía». «Quitar» saca la línea; todo es local: nada se escribe ni se audita.
 */
export function CuentaDeLaVenta({
  cuenta,
  productos,
  cotizacion,
  textos,
  alCambiarCantidad,
  alQuitar,
}: PropsDeCuentaDeLaVenta) {
  if (cuenta.length === 0) {
    return (
      <section className={estilos["cuenta"]} id="cuenta-de-la-venta">
        <p className={estilos["vacia"]}>{textos.cuentaVacia}</p>
        <p className={estilos["ayuda"]}>{textos.cuentaVaciaAyuda}</p>
      </section>
    );
  }
  return (
    <section className={estilos["cuenta"]} id="cuenta-de-la-venta">
      <ul className={estilos["lineas"]}>
        {cuenta.map((linea, indice) => {
          const producto = productos.get(linea.productoId);
          if (producto === undefined) return null;
          const forma = formaDeCantidad(producto);
          const detalle = detalleDeLaLinea(producto, linea).join(" · ");
          const importe = cotizacion?.lineas[indice]?.importe.monto;
          return (
            <li key={linea.clave} className={estilos["linea"]}>
              <div className={estilos["tituloDeLinea"]}>
                <span>
                  {cantidadParaLeer(linea.cantidad, forma)} {producto.nombre}
                </span>
                <span className={estilos["importe"]}>
                  {importe === undefined ? "" : formatearImporte(importe)}
                </span>
              </div>
              {detalle === "" ? null : <p className={estilos["detalle"]}>{detalle}</p>}
              {forma === null ? null : (
                <ControlDeCantidad
                  key={linea.revision}
                  forma={forma}
                  inicial={linea.cantidad}
                  textos={textos}
                  nombreDeLaUnidad={
                    forma.tipo === "MEDIDA" ? nombreDeLaUnidad(forma.unidadDeVentaId) : null
                  }
                  conAtajos={false}
                  alCambiar={(cantidad) => {
                    alCambiarCantidad(linea.clave, cantidad);
                  }}
                />
              )}
              <Boton
                variante="secundaria"
                alTocar={() => {
                  alQuitar(linea.clave);
                }}
              >
                {textos.quitar}
              </Boton>
            </li>
          );
        })}
      </ul>
      <p className={estilos["ayuda"]}>{textos.pieIva}</p>
    </section>
  );
}
