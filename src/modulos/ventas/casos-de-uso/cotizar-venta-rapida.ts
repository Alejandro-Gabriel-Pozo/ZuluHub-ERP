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
import { decidirPrecioDeLaLinea, type ErrorDePrecioAbierto } from "../dominio/precio-abierto";

export type EntradaDeCotizarVentaRapida = Readonly<{
  sucursalId: string;
  lineas: readonly Readonly<{
    productoId: string;
    varianteId?: string | undefined;
    opcionIds: readonly string[];
    cantidad: string;
    /** Solo para un producto en precio abierto (decisión 179). */
    precioAbierto?: string | undefined;
  }>[];
}>;

export type SalidaDeCotizarVentaRapida = Readonly<{
  total: ImporteJson;
  lineas: readonly Readonly<{ precioUnitario: ImporteJson; importe: ImporteJson }>[];
}>;

type Error_ =
  ErrorDeCotizacion | ErrorDePrecioAbierto | "IDENTIFICADOR_INVALIDO" | "CANTIDAD_INVALIDA";

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
    const cotizado =
      q.valor.precioUnitario === null ? null : precioDeVentaDesdeTexto(q.valor.precioUnitario);
    if (cotizado !== null && !cotizado.ok) {
      throw new Error("el catálogo devolvió un precio que no es un importe exacto");
    }
    const precio = decidirPrecioDeLaLinea({
      precioCotizado: cotizado === null ? null : cotizado.valor,
      precioAbierto: l.precioAbierto,
    });
    if (!precio.ok) return precio;
    lineas.push({ id: String(i), precioUnitario: precio.valor.precioUnitario, cantidad });
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
