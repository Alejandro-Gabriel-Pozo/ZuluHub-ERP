"use client";

import { REGLA_DE_CANTIDAD } from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { Campo } from "../../../componentes/Campo";
import { CampoDeDocumento } from "../../../componentes/CampoDeDocumento";
import { CampoImporte } from "../../../componentes/CampoImporte";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { Selector } from "../../../componentes/Selector";
import { formatearImporte } from "../../../patrones/formato-fiscal";
import { Texto } from "../../../primitivas/Texto";
import {
  ALICUOTAS_PARA_ELEGIR,
  TIPOS_DE_FACTURA,
  alicuotaDeLaLinea,
  cantidadDeLaLinea,
  conLinea,
  discriminaIva,
  precioDeLaLinea,
  type FacturaCotizada,
  type FacturaEscrita,
} from "./modelo-de-factura";
import type { RenglonCotizado, RenglonEscrito } from "./modelo-de-nueva-compra";
import type { TextosDeNuevaCompra } from "./textos-de-nueva-compra";
import estilos from "./NuevaCompra.module.css";

export type PropsDeBloqueDeFactura = Readonly<{
  factura: FacturaEscrita;
  alCambiar: (factura: FacturaEscrita) => void;
  renglones: readonly RenglonEscrito[];
  cotizados: ReadonlyMap<string, RenglonCotizado>;
  /** Las cuentas que hizo el servidor con lo escrito (`cotizarFactura`); `null` mientras falta algo. La pantalla no suma ni redondea. */
  cuentas: FacturaCotizada | null;
  /** El proveedor elegido todavía no tiene CUIT: la primera factura lo pide acá y queda guardado en su ficha. */
  pideCuit: boolean;
  textos: TextosDeNuevaCompra;
  deshabilitado: boolean;
}>;

/**
 * La factura del proveedor dentro de «Nueva compra» (maqueta `compra.html`, estados `factura` y `factura-total`; Compras PR 7), solo cuando la empresa compra «Con factura»: el comprobante (tipo, punto de venta, número, fecha y
 * vencimiento), cada línea con su cantidad, su precio neto y su IVA (una factura A; una B o C no discrimina), las percepciones y el total según la factura. Lo que muestra de importes (neto de cada línea, total calculado y si coincide con el
 * papel) lo calcula el SERVIDOR (`cotizarFactura`, la misma cuenta del alta): la pantalla no suma nada. Un total que no coincide avisa y deja guardar igual («tal como vino»). Mostrar no es autorizar: el servidor decide si se puede.
 */
export function BloqueDeFactura({
  factura,
  alCambiar,
  renglones,
  cotizados,
  cuentas,
  pideCuit,
  textos,
  deshabilitado,
}: PropsDeBloqueDeFactura) {
  const cambiar = (cambios: Partial<FacturaEscrita>) => {
    alCambiar({ ...factura, ...cambios });
  };
  const discrimina = discriminaIva(factura.tipo);
  return (
    <fieldset className={estilos["remito"]} disabled={deshabilitado}>
      <legend>{textos.comprobante}</legend>
      <Selector
        dato="tipo-de-comprobante-de-compra"
        etiqueta={textos.tipo}
        valor={factura.tipo}
        alCambiar={(tipo) => {
          cambiar({ tipo });
        }}
        textoDeElegir={textos.sinElegir}
        opciones={TIPOS_DE_FACTURA.map((t) => ({
          valor: t,
          etiqueta: textos.tiposDeFactura[t] ?? t,
        }))}
      />
      <div className={estilos["fila"]}>
        <Campo
          dato="punto-de-venta-de-factura"
          etiqueta={textos.puntoDeVenta}
          inputMode="numeric"
          autoComplete="off"
          valor={factura.puntoDeVenta}
          alCambiar={(puntoDeVenta) => {
            cambiar({ puntoDeVenta });
          }}
        />
        <Campo
          dato="numero-de-factura"
          etiqueta={textos.numero}
          inputMode="numeric"
          autoComplete="off"
          valor={factura.numero}
          alCambiar={(numero) => {
            cambiar({ numero });
          }}
        />
      </div>
      <Campo
        dato="fecha-de-factura"
        etiqueta={textos.fechaDeLaFactura}
        tipo="date"
        valor={factura.fecha}
        alCambiar={(fecha) => {
          cambiar({ fecha });
        }}
      />
      <Campo
        dato="vencimiento-de-pago"
        etiqueta={textos.vencimientoDePago}
        tipo="date"
        valor={factura.vencimientoDePago}
        alCambiar={(vencimientoDePago) => {
          cambiar({ vencimientoDePago });
        }}
      />
      {pideCuit ? (
        <CampoDeDocumento
          dato="cuit-de-proveedor-nuevo"
          etiqueta={textos.cuit}
          tipo="CUIT"
          valor={factura.cuit}
          alCambiar={(cuit) => {
            cambiar({ cuit });
          }}
        />
      ) : null}
      {renglones.map((r, i) => (
        <section
          key={r.id}
          className={estilos["tarjeta"]}
          aria-label={`${textos.comprobante}: ${r.nombre}`}
        >
          <h3 className={estilos["producto"]}>{r.nombre}</h3>
          <CampoNumero
            dato="cantidad-facturada-de-linea"
            etiqueta={textos.cantidadFacturada}
            valor={cantidadDeLaLinea(factura, r, cotizados.get(r.productoId))}
            alCambiar={(cantidad) => {
              alCambiar(conLinea(factura, r.id, { cantidad }));
            }}
            regla={REGLA_DE_CANTIDAD}
          />
          <CampoNumero
            dato="precio-neto-de-linea"
            etiqueta={textos.precioNeto}
            valor={precioDeLaLinea(factura, r)}
            alCambiar={(precio) => {
              alCambiar(conLinea(factura, r.id, { precio }));
            }}
            regla={REGLA_DE_CANTIDAD}
          />
          {discrimina ? (
            <Selector
              dato="alicuota-de-linea"
              etiqueta={textos.iva}
              nombreAccesible={`${textos.iva}: ${r.nombre}`}
              valor={alicuotaDeLaLinea(factura, r)}
              alCambiar={(alicuota) => {
                alCambiar(conLinea(factura, r.id, { alicuota }));
              }}
              opciones={ALICUOTAS_PARA_ELEGIR.map((a) => ({
                valor: a,
                etiqueta: textos.alicuotas[a] ?? a,
              }))}
            />
          ) : factura.tipo === "" ? null : (
            <Texto>{textos.sinIvaDiscriminado}</Texto>
          )}
          {cuentas?.lineas[i] === undefined ? null : (
            <p className={estilos["suave"]}>
              {textos.netoDeLaLinea}: {formatearImporte(cuentas.lineas[i].netoDeLinea)}
            </p>
          )}
        </section>
      ))}
      <CampoImporte
        dato="percepciones"
        etiqueta={textos.percepciones}
        valor={factura.percepciones}
        alCambiar={(percepciones) => {
          cambiar({ percepciones });
        }}
      />
      {cuentas === null ? null : (
        <p className={estilos["total"]}>
          <span>{textos.totalCalculado}</span>{" "}
          <span className={estilos["importe"]}>{formatearImporte(cuentas.totalCalculado)}</span>
        </p>
      )}
      <CampoImporte
        dato="total-segun-la-factura"
        etiqueta={textos.totalSegunLaFactura}
        valor={factura.totalSegunFactura}
        alCambiar={(totalSegunFactura) => {
          cambiar({ totalSegunFactura });
        }}
      />
      {cuentas === null ? null : (
        <Texto>{cuentas.totalCoincide ? textos.totalCoincide : textos.totalNoCoincide}</Texto>
      )}
    </fieldset>
  );
}
