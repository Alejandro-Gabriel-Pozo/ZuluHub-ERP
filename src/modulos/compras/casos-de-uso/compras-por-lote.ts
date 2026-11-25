import type { ContextoOperativo } from "../../../contexto/contexto";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { crearDirectorioDePartes } from "../../clientes/publico";
import {
  FICHA_DE_TIPO_DE_COMPROBANTE,
  type TipoDeComprobanteDeProveedor,
} from "../dominio/comprobante";
import { importeVigenteDeLinea, totalDeCompra } from "../dominio/importe-vigente";
import { estadoDerivadoDeCompra, type EstadoDeCompra } from "../dominio/niveles";
import type { CorreccionGuardada } from "../persistencia/repositorio-de-correcciones";
import type { FilaDeListaDeCompras } from "../persistencia/repositorio-de-lecturas-de-compras";
import type { LineaDeRecepcion, Recepcion } from "../persistencia/repositorio-de-recepciones";
import type { TxDeConsultasDeCompras } from "./contrato";

/**
 * Las lecturas POR LOTE de la lista y la ficha de compras (Compras PR 3): las líneas, las últimas correcciones de precio, los productos, las presentaciones, los proveedores y las facturas de una página se
 * piden con una consulta cada una (nunca una por fila), dentro de la transacción de quien llama. Vive aparte de `lectura.ts` para que ese archivo no pase del tope de tamaño.
 */

const directorio = crearDirectorioDePartes();

/** La factura vigente de una compra, tal como la nombra la fila de la lista. */
export type FacturaDeLista = Readonly<{
  tipo: TipoDeComprobanteDeProveedor;
  /** La letra del tipo: A, B o C. */
  letra: "A" | "B" | "C";
  puntoDeVenta: number;
  numero: number;
}>;

export type CompraDeLista = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  /** El nombre del proveedor para mostrar (también si está desactivado); `null` si la parte está anonimizada. */
  proveedorNombre: string | null;
  fechaNegocio: string;
  remito: Recepcion["remito"];
  estado: EstadoDeCompra;
  /** Texto decimal de 2 decimales en pesos (ARS): la suma de los importes VIGENTES de las líneas; `null` («Sin precio») si alguna línea no tiene precio, nunca cero. */
  total: string | null;
  /** La factura vigente (registrada), o `null` si no tiene. */
  factura: FacturaDeLista | null;
}>;

export const claveDeLinea = (recepcionId: string, numero: number): string =>
  `${recepcionId}|${numero}`;

/**
 * El importe vigente de cada línea (clave `recepcionId|número`) de esas recepciones: lecturas por lote, constantes por página (las líneas, la última corrección
 * de cada línea corregida y, solo para las corregidas, los productos y las presentaciones). Es la ÚNICA cuenta: la lista suma estos importes y la ficha los muestra.
 * Un dato que no se puede leer para recalcular una línea corregida es un error de integridad: se lanza, no se esconde detrás de «Sin precio».
 */
export async function importesVigentes(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  recepcionIds: readonly string[],
): Promise<
  Readonly<{
    lineas: readonly (LineaDeRecepcion & Readonly<{ recepcionId: string }>)[];
    importes: ReadonlyMap<string, string | null>;
    /** Las líneas (clave `recepcionId|número`) que tienen alguna corrección de precio. */
    corregidas: ReadonlySet<string>;
  }>
> {
  const empresa = contexto.empresaId;
  const lineas = await tx.recepciones.lineasDeVarias(empresa, recepcionIds);
  const ultimas = new Map<string, CorreccionGuardada>(
    (await tx.correccionesDeCompra.ultimasDeVarias(empresa, recepcionIds)).map((c) => [
      claveDeLinea(c.recepcionId, c.linea),
      c,
    ]),
  );
  const corregidas = lineas.filter((l) => ultimas.has(claveDeLinea(l.recepcionId, l.numero)));
  const productos = new Map(
    (
      await tx.productosParaCompras.deVarios(
        empresa,
        corregidas.map((l) => l.productoId),
      )
    ).map((p) => [p.id, p]),
  );
  const presentaciones = new Map(
    (
      await tx.presentacionesDeProducto.obtenerVarias(
        empresa,
        corregidas.flatMap((l) => (l.presentacionId === null ? [] : [l.presentacionId])),
      )
    ).map((p) => [p.id, p]),
  );
  const importes = new Map<string, string | null>();
  for (const l of lineas) {
    const clave = claveDeLinea(l.recepcionId, l.numero);
    const correccion = ultimas.get(clave) ?? null;
    const producto = productos.get(l.productoId);
    const presentacion =
      l.presentacionId === null ? undefined : presentaciones.get(l.presentacionId);
    const contextoDeLinea =
      correccion === null ||
      producto === undefined ||
      (l.presentacionId !== null && presentacion === undefined)
        ? null
        : {
            unidadBase: producto.unidadBaseId as CodigoDeUnidad,
            presentacion:
              presentacion === undefined
                ? null
                : {
                    cantidadEnBase: presentacion.cantidad,
                    dePesoVariable: presentacion.dePesoVariable,
                  },
          };
    const r = importeVigenteDeLinea(l, correccion, contextoDeLinea);
    if (!r.ok) {
      throw new Error(
        `No se pudo recalcular la línea ${l.numero} de la compra ${l.recepcionId}: ${r.error}`,
      );
    }
    importes.set(clave, r.valor);
  }
  return { lineas, importes, corregidas: new Set(ultimas.keys()) };
}

/** Las filas de una página como compras de la lista, con proveedor, total y factura leídos por lote en la MISMA transacción. */
export async function armarCompras(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  filas: readonly FilaDeListaDeCompras[],
): Promise<readonly CompraDeLista[]> {
  if (filas.length === 0) return [];
  const empresa = contexto.empresaId;
  const ids = filas.map((f) => f.id);
  const { lineas, importes } = await importesVigentes(tx, contexto, ids);
  const nombres = await directorio.nombresParaMostrar(
    tx,
    empresa,
    filas.map((f) => f.proveedorId),
  );
  const facturas = new Map(
    (await tx.comprobantesDeProveedor.deVariasRecepciones(empresa, ids)).map((c) => [
      c.recepcionId,
      c,
    ]),
  );
  return filas.map((f) => {
    const comprobante = facturas.get(f.id);
    const factura: FacturaDeLista | null =
      comprobante !== undefined &&
      comprobante.estado === "REGISTRADO" &&
      comprobante.tipo !== null &&
      FICHA_DE_TIPO_DE_COMPROBANTE[comprobante.tipo].clase === "FACTURA" &&
      comprobante.puntoDeVenta !== null &&
      comprobante.numero !== null
        ? {
            tipo: comprobante.tipo,
            letra: FICHA_DE_TIPO_DE_COMPROBANTE[comprobante.tipo].letra,
            puntoDeVenta: comprobante.puntoDeVenta,
            numero: comprobante.numero,
          }
        : null;
    return {
      recepcionId: f.id,
      numero: f.numero,
      sucursalId: f.sucursalId,
      proveedorId: f.proveedorId,
      proveedorNombre: nombres.get(f.proveedorId) ?? null,
      fechaNegocio: f.fechaNegocio,
      remito: f.remito,
      estado: estadoDerivadoDeCompra(f.estado, f.comprobanteEstado),
      total: totalDeCompra(
        lineas
          .filter((l) => l.recepcionId === f.id)
          .map((l) => importes.get(claveDeLinea(f.id, l.numero)) ?? null),
      ),
      factura,
    };
  });
}
