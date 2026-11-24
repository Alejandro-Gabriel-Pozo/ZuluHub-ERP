"use client";

import { REGLA_DE_CANTIDAD } from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { Boton } from "../../../componentes/Boton.cliente";
import { CampoImporte } from "../../../componentes/CampoImporte";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { Selector } from "../../../componentes/Selector";
import {
  opcionesDeUnidad,
  type RenglonEscrito,
  type ResumenDeRenglon,
} from "./modelo-de-nueva-compra";
import type { TextosDeNuevaCompra } from "./textos-de-nueva-compra";
import estilos from "./NuevaCompra.module.css";

export type PropsDeTarjetaDeRenglon = Readonly<{
  renglon: RenglonEscrito;
  /** Lo que vuelve del servidor para este renglón (cuánto entra al stock y cuánto cuesta); `null` mientras falta la cantidad. */
  resumen: ResumenDeRenglon | null;
  alCambiar: (cambios: Partial<Omit<RenglonEscrito, "id" | "productoId">>) => void;
  alQuitar: () => void;
  textos: TextosDeNuevaCompra;
  deshabilitada: boolean;
}>;

/**
 * Un renglón de «Nueva compra» (maqueta `compra.html`, `tarjetaLinea`): el producto, «Cómo se compra» (su unidad base u otra de su misma dimensión; las de otra dimensión aparecen apagadas),
 * «Cantidad», «Precio por» y «Precio», y debajo lo que calcula el servidor: «Entra a tu stock», «Costo por unidad de stock» y el importe de la línea («Sin precio» si no hay precio: nunca cero).
 * La pantalla NO calcula nada: el resumen es el que devolvió `cotizarCompra`, la misma cuenta que usa el alta.
 */
export function TarjetaDeRenglon({
  renglon,
  resumen,
  alCambiar,
  alQuitar,
  textos,
  deshabilitada,
}: PropsDeTarjetaDeRenglon) {
  const unidades = opcionesDeUnidad(renglon.unidadBase);
  return (
    <section className={estilos["tarjeta"]} aria-label={renglon.nombre}>
      <h3 className={estilos["producto"]}>{renglon.nombre}</h3>
      <Selector
        dato="unidad-de-compra"
        etiqueta={textos.comoSeCompra}
        nombreAccesible={`${textos.comoSeCompra}: ${renglon.nombre}`}
        valor={renglon.unidadDeCompra}
        alCambiar={(unidadDeCompra) => {
          alCambiar({ unidadDeCompra });
        }}
        opciones={unidades}
        deshabilitado={deshabilitada}
      />
      <CampoNumero
        dato="cantidad-de-compra"
        etiqueta={textos.cantidad}
        valor={renglon.cantidad}
        alCambiar={(cantidad) => {
          alCambiar({ cantidad });
        }}
        regla={REGLA_DE_CANTIDAD}
        deshabilitado={deshabilitada}
      />
      <Selector
        dato="unidad-de-precio-de-compra"
        etiqueta={textos.precioPor}
        nombreAccesible={`${textos.precioPor}: ${renglon.nombre}`}
        valor={renglon.unidadDePrecio}
        alCambiar={(unidadDePrecio) => {
          alCambiar({ unidadDePrecio });
        }}
        opciones={unidades}
        deshabilitado={deshabilitada}
      />
      <CampoImporte
        dato="precio-de-compra"
        etiqueta={textos.precio}
        valor={renglon.precio}
        alCambiar={(precio) => {
          alCambiar({ precio });
        }}
        deshabilitado={deshabilitada}
      />
      {resumen === null ? null : (
        <div className={estilos["resumen"]}>
          <p className={estilos["destacado"]}>{resumen.entra}</p>
          <p className={estilos["suave"]}>{resumen.costo}</p>
          <p className={estilos["importe"]}>{resumen.importe}</p>
        </div>
      )}
      <Boton
        variante="secundaria"
        ancho="completo"
        deshabilitado={deshabilitada}
        alTocar={alQuitar}
      >
        {textos.quitar}
      </Boton>
    </section>
  );
}
