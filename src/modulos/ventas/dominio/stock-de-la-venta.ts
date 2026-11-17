import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * LO QUE VENTAS LE DICE A STOCK DE UNA VENTA (E5-T12; E4 §3.10). Funciones puras: de las líneas selladas del ticket arman los renglones del puerto
 * de stock y el motivo con que se devuelve la salida. Lo que stock hace con ellos (explotar el consumo, el factor de tamaño) no se repite acá.
 */

/** Una línea del ticket tal como está sellada (cantidad y versiones de lo vendido; nada de lo que el catálogo cambie después). */
export type LineaParaStock = Readonly<{
  posicion: number;
  productoId: string;
  cantidad: string;
  unidadDeVenta: string;
  varianteOpcionId: string | null;
  varianteVersionDeOpcionId: string | null;
  opciones: readonly Readonly<{ versionDeOpcionId: string }>[];
}>;

export type RenglonDeSalidaDeStock = Readonly<{
  posicion: number;
  productoId: string;
  cantidad: string;
  unidadDeVentaId: string;
  varianteVersionDeOpcionId?: string | undefined;
  opciones: readonly Readonly<{ versionDeOpcionId: string }>[];
}>;

/**
 * Los renglones de la salida, uno por línea y en el orden dado. La cantidad sale como texto decimal canónico. Una línea con variante pero sin la
 * versión sellada (anterior a 0036) no se puede explotar con el factor de lo que se vendió: `VARIANTE_SIN_VERSION_SELLADA`, y el cierre falla
 * cerrado en vez de descontar con un factor supuesto. Una línea sin variante no lleva versión.
 */
export function renglonesParaStock(
  lineas: readonly LineaParaStock[],
): Resultado<readonly RenglonDeSalidaDeStock[], "VARIANTE_SIN_VERSION_SELLADA"> {
  const renglones: RenglonDeSalidaDeStock[] = [];
  for (const linea of lineas) {
    if (linea.varianteOpcionId !== null && linea.varianteVersionDeOpcionId === null) {
      return err("VARIANTE_SIN_VERSION_SELLADA");
    }
    renglones.push({
      posicion: linea.posicion,
      productoId: linea.productoId,
      cantidad: cantidadATexto(cantidadDesdeTexto(linea.cantidad)),
      unidadDeVentaId: linea.unidadDeVenta,
      ...(linea.varianteVersionDeOpcionId === null
        ? {}
        : { varianteVersionDeOpcionId: linea.varianteVersionDeOpcionId }),
      opciones: linea.opciones.map((o) => ({ versionDeOpcionId: o.versionDeOpcionId })),
    });
  }
  return ok(renglones);
}

/**
 * El detalle con que queda en el libro de stock la devolución de un ticket anulado. Es SOLO el número del ticket: el motivo que escribe quien anula
 * (hasta 500 caracteres, con signos que el detalle de stock no admite) no viaja, así un motivo válido para ventas nunca hace fallar la devolución.
 */
export const detalleDeLaDevolucionDeStock = (numeroDeTicket: number): string =>
  `Anulación del ticket ${numeroDeTicket}`;
