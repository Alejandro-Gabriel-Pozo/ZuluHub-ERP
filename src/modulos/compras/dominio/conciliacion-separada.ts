import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { leerCantidad, leerCantidadPositiva, textoDeCantidad } from "./decimal";
import {
  camposDeHuellaDeFactura,
  leerFactura,
  type ErrorDeFactura,
  type FacturaPedida,
} from "./factura";
import { huellaDeComando } from "./huella";
import { esUuid } from "./identificadores";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

/**
 * La factura del proveedor en N3 y N4 (E9 §3.8): llega SOLA, antes o después de la mercadería, y se concilia con lo recibido. Pura: sin reloj ni azar.
 * Quien la carga dice de qué producto es cada línea (`productoId`): con él se propone la conciliación (0065). Las cantidades y los precios van en la unidad base del
 * producto, como en N2 (DEC-0303).
 */
export type FacturaSeparadaPedida = Readonly<{
  factura: FacturaPedida;
  /** El producto de cada línea de la factura, en el mismo orden que `factura.lineas`. */
  productos: readonly string[];
}>;

export type ErrorDeFacturaSeparada = ErrorDeFactura | "PRODUCTO_NO_ENCONTRADO";

/**
 * Lee la factura de N3: la forma de la de N2 (`leerFactura`, que numera las líneas por posición) más el `productoId` de cada una. Una línea sin producto, o con un id que no
 * es un identificador, es `PRODUCTO_NO_ENCONTRADO` (en N3 el producto es obligatorio: sin él no hay conciliación).
 */
export function leerFacturaSeparada(
  valor: unknown,
): Resultado<FacturaSeparadaPedida, ErrorDeFacturaSeparada> {
  const crudo =
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};
  const lineas = Array.isArray(crudo["lineas"]) ? (crudo["lineas"] as readonly unknown[]) : null;
  if (lineas === null || lineas.length === 0) return err("LINEAS_REQUERIDAS");
  const productos: string[] = [];
  const conRenglon = lineas.map((l, i) => {
    const linea =
      typeof l === "object" && l !== null && !Array.isArray(l)
        ? (l as Record<string, unknown>)
        : {};
    const productoId = linea["productoId"];
    productos.push(typeof productoId === "string" && esUuid(productoId) ? productoId : "");
    return { ...linea, renglon: i + 1 };
  });
  const factura = leerFactura({ ...crudo, lineas: conRenglon });
  if (!factura.ok) return factura;
  if (productos.some((p) => p === "")) return err("PRODUCTO_NO_ENCONTRADO");
  return ok({ factura: factura.valor, productos });
}

/** La huella del pedido de la factura de N3: la de la factura más el producto de cada línea (otro producto, otro pedido). */
export function huellaDeLaFacturaSeparada(
  proveedorId: string,
  pedido: FacturaSeparadaPedida,
): string {
  return huellaDeComando(
    "registrar_factura",
    [proveedorId, ...camposDeHuellaDeFactura(pedido.factura), JSON.stringify(pedido.productos)],
    [],
  );
}

// ---- la conciliación ---------------------------------------------------------------------------------------------------------------

export type AsignacionPedida = Readonly<{
  lineaDeFactura: number;
  recepcionId: string;
  lineaDeRecepcion: number;
  /** Texto decimal de hasta 4 decimales, mayor que cero, en la unidad base. */
  cantidad: string;
}>;

export type ErrorDeAsignacion = "ASIGNACIONES_INVALIDAS";

/**
 * Lee lo que la persona confirma: una lista (no vacía, con tope) de asignaciones con forma exacta, la cantidad en forma canónica y sin repetir el mismo par de líneas.
 * Que la línea exista, sea del mismo producto y haya saldo lo comprueba el caso de uso con lo guardado; el tope «no más de lo recibido ni de lo facturado» lo impone la base.
 */
export function leerAsignaciones(
  valor: unknown,
): Resultado<readonly AsignacionPedida[], ErrorDeAsignacion> {
  if (!Array.isArray(valor) || valor.length === 0) return err("ASIGNACIONES_INVALIDAS");
  if (valor.length > MAXIMO_DE_RENGLONES_DE_UNA_COMPRA) return err("ASIGNACIONES_INVALIDAS");
  const vistas = new Set<string>();
  const leidas: AsignacionPedida[] = [];
  for (const crudo of valor as readonly unknown[]) {
    const a =
      typeof crudo === "object" && crudo !== null && !Array.isArray(crudo)
        ? (crudo as Record<string, unknown>)
        : {};
    const cantidad = typeof a["cantidad"] === "string" ? leerCantidadPositiva(a["cantidad"]) : null;
    const recepcionId = a["recepcionId"];
    if (
      !Number.isInteger(a["lineaDeFactura"]) ||
      (a["lineaDeFactura"] as number) < 1 ||
      !Number.isInteger(a["lineaDeRecepcion"]) ||
      (a["lineaDeRecepcion"] as number) < 1 ||
      typeof recepcionId !== "string" ||
      !esUuid(recepcionId) ||
      cantidad === null
    ) {
      return err("ASIGNACIONES_INVALIDAS");
    }
    const par = `${String(a["lineaDeFactura"])}|${recepcionId}|${String(a["lineaDeRecepcion"])}`;
    if (vistas.has(par)) return err("ASIGNACIONES_INVALIDAS");
    vistas.add(par);
    leidas.push({
      lineaDeFactura: a["lineaDeFactura"] as number,
      recepcionId,
      lineaDeRecepcion: a["lineaDeRecepcion"] as number,
      cantidad: textoDeCantidad(cantidad),
    });
  }
  return ok(leidas);
}

/**
 * Lo que queda de una línea: el total menos lo ya asignado, como texto decimal de 4 decimales; `null` si no queda nada (o los datos no son decimales válidos: nunca se
 * propone con lo que no se entiende).
 */
export function pendienteDeLinea(total: string, asignada: string): string | null {
  const t = leerCantidad(total);
  const a = leerCantidad(asignada);
  if (t === null || a === null || t <= a) return null;
  return textoDeCantidad(t - a);
}

/** Lo que cada línea de la factura tiene todavía sin conciliar y lo que cada línea recibida tiene todavía sin asignar, para proponer. */
export type LineaFacturadaPendiente = Readonly<{
  numero: number;
  productoId: string;
  /** Lo facturado menos lo ya asignado (decimal de 4). */
  sinConciliar: string;
}>;

export type LineaRecibidaDisponible = Readonly<{
  recepcionId: string;
  linea: number;
  productoId: string;
  /** Lo recibido menos lo ya asignado (decimal de 4). */
  sinAsignar: string;
}>;

/**
 * La propuesta de un toque (E9 §3.8): cada línea de la factura toma, por producto y en el ORDEN en que se recibieron (el de `recibidas`: la más vieja primero), lo que
 * haya sin asignar hasta cubrir lo facturado. Una línea sin saldo en un producto no genera asignación. La persona la confirma o la corrige: esto solo propone. Puro y
 * determinista. Las líneas rechazadas no llegan acá (el caso de uso no las pasa).
 */
export function proponerAsignaciones(
  facturadas: readonly LineaFacturadaPendiente[],
  recibidas: readonly LineaRecibidaDisponible[],
): readonly AsignacionPedida[] {
  const saldos = new Map<string, bigint>();
  for (const r of recibidas) {
    const unidades = leerCantidadPositiva(r.sinAsignar);
    if (unidades !== null) saldos.set(`${r.recepcionId}|${String(r.linea)}`, unidades);
  }
  const propuestas: AsignacionPedida[] = [];
  for (const f of facturadas) {
    let falta = leerCantidadPositiva(f.sinConciliar);
    if (falta === null) continue;
    for (const r of recibidas) {
      if (falta === 0n) break;
      if (r.productoId !== f.productoId) continue;
      const clave = `${r.recepcionId}|${String(r.linea)}`;
      const saldo = saldos.get(clave) ?? 0n;
      if (saldo === 0n) continue;
      const tomar = falta < saldo ? falta : saldo;
      saldos.set(clave, saldo - tomar);
      falta -= tomar;
      propuestas.push({
        lineaDeFactura: f.numero,
        recepcionId: r.recepcionId,
        lineaDeRecepcion: r.linea,
        cantidad: textoDeCantidad(tomar),
      });
    }
  }
  return propuestas;
}
