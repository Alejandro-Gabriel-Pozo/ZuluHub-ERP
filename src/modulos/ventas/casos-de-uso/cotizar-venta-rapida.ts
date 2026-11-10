import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  cotizarParaVender,
  type ErrorDeCotizacion,
  type LecturasDeCatalogo,
} from "../../catalogo/publico";
import { calcularTicket, type LineaACalcular } from "../dominio/calcular-ticket";
import { comprobarCantidadDeLinea } from "../dominio/cantidad-de-linea";
import { esUuid } from "../dominio/identificadores";

export type EntradaDeCotizarVentaRapida = Readonly<{
  sucursalId: string;
  lineas: readonly Readonly<{
    productoId: string;
    varianteId?: string | undefined;
    opcionIds: readonly string[];
    cantidad: string;
  }>[];
}>;

export type SalidaDeCotizarVentaRapida = Readonly<{
  total: ImporteJson;
  lineas: readonly Readonly<{ precioUnitario: ImporteJson; importe: ImporteJson }>[];
}>;

type Error_ =
  ErrorDeCotizacion | "IDENTIFICADOR_INVALIDO" | "CANTIDAD_INVALIDA" | "PRODUCTO_SIN_PRECIO";

/**
 * `cotizarVentaRapida` (E4 §3.13): el total de un carrito del mostrador con LA MISMA cuenta pura que el cierre (`calcularTicket`), sin
 * escribir nada ni confiar en el cliente: el precio sale del catálogo (`cotizarParaVender`), nunca de quien pide. La autorización y el
 * alcance los resuelve quien llama (la consulta). Un producto en precio abierto no se vende todavía (`PRODUCTO_SIN_PRECIO`).
 */
export async function cotizarVentaRapida(
  tx: LecturasDeCatalogo,
  contexto: ContextoOperativo,
  entrada: EntradaDeCotizarVentaRapida,
): Promise<Resultado<SalidaDeCotizarVentaRapida, Error_>> {
  const lineas: LineaACalcular[] = [];
  for (const [i, l] of entrada.lineas.entries()) {
    const elegidas = [...(l.varianteId === undefined ? [] : [l.varianteId]), ...l.opcionIds];
    if (![l.productoId, ...elegidas].every(esUuid)) return err("IDENTIFICADOR_INVALIDO");
    let cantidad;
    try {
      cantidad = cantidadDesdeTexto(l.cantidad);
    } catch (e) {
      if (e instanceof ErrorDeValor) return err("CANTIDAD_INVALIDA");
      throw e;
    }
    const cota = comprobarCantidadDeLinea(cantidad);
    if (!cota.ok) return cota;
    const q = await cotizarParaVender(tx, {
      empresaId: contexto.empresaId,
      sucursalId: sucursalId(entrada.sucursalId),
      productoId: l.productoId,
      opcionIds: elegidas,
      cantidad: cantidadATexto(cantidad),
      ahora: contexto.ahora,
    });
    if (!q.ok) return q;
    if (q.valor.precioUnitario === null) return err("PRODUCTO_SIN_PRECIO");
    const precio = precioDeVentaDesdeTexto(q.valor.precioUnitario);
    if (!precio.ok) throw new Error("el catálogo devolvió un precio que no es un importe exacto");
    lineas.push({ id: String(i), precioUnitario: precio.valor, cantidad });
  }
  const calculado = calcularTicket(lineas);
  return ok({
    total: importeAJson(calculado.total),
    lineas: calculado.renglones.map((r, i) => ({
      precioUnitario: {
        moneda: "ARS",
        monto: precioUnitarioATexto((lineas[i] as LineaACalcular).precioUnitario),
      },
      importe: importeAJson(r.importe),
    })),
  });
}
