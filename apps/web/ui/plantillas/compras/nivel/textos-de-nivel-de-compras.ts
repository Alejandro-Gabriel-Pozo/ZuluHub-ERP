import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import type { TextosDeNivelDeCompras } from "./modelo-de-nivel-de-compras";

/**
 * Los textos de «Nivel de compras» ya resueltos (Compras PR 11). Acá no se arma ningún texto nuevo: «Nivel de compras», «Sin factura» y «Con factura» son los aprobados por el dueño el 24/11/2026
 * (`compra-nivel.html`) y «Guardar» es el ya aprobado del catálogo. «Recepción separada» y «Tres vías» (aprobados) son de la fase 5, pausada: no se construyen ni se ofrecen.
 */
export function textosDeNivelDeCompras(): TextosDeNivelDeCompras {
  return {
    titulo: texto({}, "compras.nivel.titulo"),
    guardar: texto({}, "caja.accion.guardar"),
    niveles: {
      COMPRA_SIMPLE: texto({}, "compras.nivel.compra_simple"),
      CON_COMPROBANTE: texto({}, "compras.nivel.con_comprobante"),
    },
  };
}
