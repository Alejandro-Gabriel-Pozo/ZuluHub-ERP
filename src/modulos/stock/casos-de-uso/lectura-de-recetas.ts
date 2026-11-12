import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  formatearDecimalFijo,
  parsearDecimalFijo,
} from "../../../primitivas/cantidad/decimal-fijo";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import type { ClaseDeUso } from "../../catalogo/publico";
import type { TxDeConsultasDeStock } from "./contrato";
import { unidadConocida } from "./lectura-de-venta";
import {
  compararVersiones as compararVersionesDeReceta,
  costearReceta,
  type ComponenteParaCosto,
  type CostoDeReceta,
} from "../dominio/costo-de-receta";
import { brutoComoTexto } from "../dominio/merma";
import { MAXIMO_DE_NIVELES_DE_RECETA } from "../dominio/subcomposicion";
import type { ComposicionGuardada } from "../persistencia/modelo";

/** Escala del costo (`numeric(18,6)`): los costos de la receta salen con 6 decimales, en pesos (`ARS`). */
const ESCALA_DEL_COSTO = 6;
const costoATexto = (unidades: bigint): string => formatearDecimalFijo(unidades, ESCALA_DEL_COSTO);

export type LineaDeFicha = Readonly<{
  numero: number;
  productoId: string;
  nombre: string;
  /** Un artículo de stock o un elaborado (subcomposición). */
  tipo: "ARTICULO" | "ELABORADO";
  clase: ClaseDeUso;
  /** NETO (lo que lleva el plato), en `unidadId`; la merma se suma (DEC-0100). */
  cantidad: string;
  unidadId: string;
  merma: string;
  /** BRUTO: lo que se descuenta y se costea, en `unidadId` (un redondeo). */
  bruto: string;
  /** Un insumo operativo (packaging, limpieza): se muestra aparte y no entra al costo (D77). */
  noEntraAlCosto: boolean;
  /** Costo de la línea para toda la receta, 6 decimales, o `null` si no hay costo (nunca cero). SOLO con `costos.ver`. */
  costo?: string | null | undefined;
}>;

export type CostosDeFicha = Readonly<{
  moneda: "ARS";
  /** Lo que cuesta lo que rinde la receta entera (un redondeo). */
  total: string;
  /** Cuánto cuesta cada unidad que rinde (un redondeo, del total exacto). */
  porUnidad: string;
  /** Hay componentes que cuentan y no tienen costo: el total y el costo por unidad están incompletos. */
  incompleto: boolean;
  /** Los productos que cuentan y no tienen costo. */
  sinCosto: readonly string[];
}>;

export type FichaDeReceta = Readonly<{
  productoId: string;
  version: number;
  /** La versión pedida es la vigente (la de mayor número). */
  esLaVigente: boolean;
  rinde: string;
  pasos: string | null;
  componentes: readonly LineaDeFicha[];
  /** SOLO con `costos.ver`. */
  costos?: CostosDeFicha | undefined;
}>;

export type CambioDeComponente = Readonly<{
  productoId: string;
  nombre: string;
  tipo: "AGREGADO" | "QUITADO" | "CAMBIADO";
}>;

export type ComparacionDeVersiones = Readonly<{
  productoId: string;
  desde: number;
  hasta: number;
  cambios: readonly CambioDeComponente[];
  /** Con los precios DE HOY en las dos versiones (así la diferencia es solo la receta). SOLO con `costos.ver`. */
  costos?:
    | Readonly<{
        moneda: "ARS";
        porUnidadDesde: string;
        porUnidadHasta: string;
        /** `hasta − desde`, con signo; `null` si alguna de las dos versiones tiene componentes sin costo (no se compara lo incompleto). */
        diferencia: string | null;
        incompleto: boolean;
      }>
    | undefined;
}>;

export type VersionDeReceta = Readonly<{
  version: number;
  rinde: string;
  pasos: string | null;
  creadaPor: string;
  creadaEn: Date;
}>;

export type LineaDeCocina = Readonly<{
  productoId: string;
  nombre: string;
  tipo: "ARTICULO" | "ELABORADO";
  /** BRUTO, en `unidadId`: sin costos ni precios (D99, idea 6). */
  cantidad: string;
  unidadId: string;
}>;

export type FichaDeCocina = Readonly<{
  productoId: string;
  version: number;
  rinde: string;
  pasos: string | null;
  componentes: readonly LineaDeCocina[];
}>;

type Tx = TxDeConsultasDeStock;

/** Lo que se sabe de cada componente de una versión, por su clave (id del artículo o del elaborado). */
type Resuelto = Readonly<{
  clave: string;
  numero: number;
  productoId: string;
  nombre: string;
  tipo: "ARTICULO" | "ELABORADO";
  clase: ClaseDeUso;
  cantidad: string;
  unidadId: string;
  perdida: string;
  /** La unidad de stock del artículo o la base del elaborado, en la que va el costo. */
  unidadDeCosto: string;
  articuloId: string | null;
}>;

async function resolverComponentes(
  tx: Tx,
  contexto: ContextoOperativo,
  version: ComposicionGuardada,
): Promise<readonly Resuelto[]> {
  const empresa = contexto.empresaId;
  const articulos = await tx.articulosDeStock.porIds(
    empresa,
    version.componentes.flatMap((c) => (c.articuloId === null ? [] : [c.articuloId])),
  );
  const articuloDe = new Map(articulos.map((a) => [a.id, a]));
  const productos = await tx.productosParaStock.porIds(empresa, [
    ...articulos.map((a) => a.productoId),
    ...version.componentes.flatMap((c) => (c.compuestoId === null ? [] : [c.compuestoId])),
  ]);
  const productoDe = new Map(productos.map((p) => [p.id, p]));
  return version.componentes.map((c): Resuelto => {
    const articulo = c.articuloId === null ? undefined : articuloDe.get(c.articuloId);
    const productoId = c.compuestoId ?? articulo?.productoId;
    const producto = productoId === undefined ? undefined : productoDe.get(productoId);
    // Una receta guardada solo apunta a lo que existe (claves foráneas): lo que falta es una falla, no un dato.
    if (productoId === undefined || producto === undefined) {
      throw new RangeError("stock: un componente de la receta apunta a un producto que no existe");
    }
    return {
      clave: c.articuloId ?? c.compuestoId ?? "",
      numero: c.numero,
      productoId,
      nombre: producto.nombre,
      tipo: c.articuloId === null ? "ELABORADO" : "ARTICULO",
      clase: producto.claseDeUso,
      cantidad: c.cantidad,
      unidadId: c.unidadId,
      perdida: c.perdida,
      unidadDeCosto: articulo === undefined ? producto.unidadBaseId : articulo.unidadDeStockId,
      articuloId: c.articuloId,
    };
  });
}

/** Cuánto cuesta la receta de una versión (puro sobre lo leído) y lo que dice cada línea; la raíz del costeo recursivo de los elaborados. */
async function costearVersion(
  tx: Tx,
  contexto: ContextoOperativo,
  alcance: AlcanceDeSucursales,
  version: ComposicionGuardada,
  nivel: number,
  memo: Map<string, bigint | null>,
): Promise<CostoDeReceta | null> {
  if (nivel > MAXIMO_DE_NIVELES_DE_RECETA || version.componentes.length === 0) return null;
  const empresa = contexto.empresaId;
  const resueltos = await resolverComponentes(tx, contexto, version);
  // Los artículos con costo propio: los de compra (último costo de compra, D91) y, si no hay, el promedio vigente del depósito de venta.
  const idsDeArticulos = resueltos.flatMap((r) => (r.articuloId === null ? [] : [r.articuloId]));
  const elaboradosConStock = await tx.articulosDeStock.porProductos(
    empresa,
    resueltos.filter((r) => r.tipo === "ELABORADO").map((r) => r.productoId),
  );
  const stockPropioDe = new Map(
    elaboradosConStock.filter((a) => a.activo).map((a) => [a.productoId, a.id]),
  );
  const promedios = await tx.costosDeStock.promediosEnDepositosDeVenta(empresa, alcance, [
    ...idsDeArticulos,
    ...stockPropioDe.values(),
  ]);
  /** El costo por unidad de un componente (texto, 6 decimales) o `null` si no se sabe. */
  const costoDelComponente = async (r: Resuelto): Promise<string | null> => {
    if (r.tipo === "ARTICULO" && r.articuloId !== null) {
      const compra = await tx.costosDeStock.ultimaCompraConCosto(empresa, alcance, r.articuloId);
      return compra?.costoUnitario ?? promedios.get(r.articuloId) ?? null;
    }
    const propio = stockPropioDe.get(r.productoId);
    if (propio !== undefined) return promedios.get(propio) ?? null; // con stock propio, el promedio vigente de su artículo (D94)
    const del = await costoDeElaboradoSinStock(tx, contexto, alcance, r.productoId, nivel, memo);
    return del === null ? null : costoATexto(del);
  };
  const componentes: ComponenteParaCosto[] = [];
  for (const r of resueltos) {
    const costo = await costoDelComponente(r);
    const aStock = convertirCantidad(
      cantidadDesdeTexto(r.cantidad),
      unidadConocida(r.unidadId),
      unidadConocida(r.unidadDeCosto),
    );
    if (!aStock.ok)
      throw new RangeError("stock: la unidad de un componente de la receta no convierte");
    componentes.push({
      clave: r.clave,
      noEntraAlCosto: r.clase === "INSUMO",
      neto: aStock.valor,
      merma: porcentajeDesdeTexto(r.perdida),
      costoUnitario: costo === null ? null : parsearDecimalFijo(costo, ESCALA_DEL_COSTO, "costo"),
    });
  }
  return costearReceta(cantidadDesdeTexto(version.rinde), componentes);
}

/** El costo por unidad de un elaborado sin stock propio: el de su receta vigente, recursivo; `null` si no tiene receta o está incompleto. */
async function costoDeElaboradoSinStock(
  tx: Tx,
  contexto: ContextoOperativo,
  alcance: AlcanceDeSucursales,
  productoId: string,
  nivel: number,
  memo: Map<string, bigint | null>,
): Promise<bigint | null> {
  if (memo.has(productoId)) return memo.get(productoId) ?? null;
  // Se marca antes de bajar: un ciclo que alguien escribió por SQL no cuelga la consulta (la base lo impide, esto es la red de seguridad).
  memo.set(productoId, null);
  const receta = await tx.composicionesDeStock.ultimaVersion(contexto.empresaId, productoId);
  const costo =
    receta === null ? null : await costearVersion(tx, contexto, alcance, receta, nivel + 1, memo);
  const porUnidad = costo === null || costo.incompleto ? null : costo.costoPorUnidad;
  memo.set(productoId, porUnidad);
  return porUnidad;
}

/** La ficha de una versión: componentes con neto, merma y bruto y, con `conCostos`, el costo por línea y de la receta. */
export async function fichaDeLaVersion(
  tx: Tx,
  contexto: ContextoOperativo,
  alcance: AlcanceDeSucursales,
  version: ComposicionGuardada,
  ultima: ComposicionGuardada,
  conCostos: boolean,
): Promise<FichaDeReceta> {
  const resueltos = await resolverComponentes(tx, contexto, version);
  const costo = conCostos
    ? await costearVersion(tx, contexto, alcance, version, 1, new Map())
    : null;
  const costoDe = new Map(costo?.lineas.map((l) => [l.clave, l.costo]) ?? []);
  const componentes = resueltos.map((r): LineaDeFicha => {
    const bruto = brutoComoTexto(cantidadDesdeTexto(r.cantidad), porcentajeDesdeTexto(r.perdida));
    if (bruto === null) throw new RangeError("stock: el bruto de un componente no entra");
    const base = {
      numero: r.numero,
      productoId: r.productoId,
      nombre: r.nombre,
      tipo: r.tipo,
      clase: r.clase,
      cantidad: r.cantidad,
      unidadId: r.unidadId,
      merma: r.perdida,
      bruto,
      noEntraAlCosto: r.clase === "INSUMO",
    };
    if (!conCostos) return base;
    const linea = costoDe.get(r.clave);
    return { ...base, costo: linea === undefined || linea === null ? null : costoATexto(linea) };
  });
  return {
    productoId: version.productoId,
    version: version.numero,
    esLaVigente: version.numero === ultima.numero,
    rinde: version.rinde,
    pasos: version.pasos,
    componentes,
    ...(costo === null
      ? {}
      : {
          costos: {
            moneda: "ARS" as const,
            total: costoATexto(costo.costoTotal),
            porUnidad: costoATexto(costo.costoPorUnidad),
            incompleto: costo.incompleto,
            sinCosto: costo.sinCosto.map(
              (clave) => resueltos.find((r) => r.clave === clave)?.productoId ?? clave,
            ),
          },
        }),
  };
}

/** Qué cambió entre dos versiones y, con `conCostos`, cuánto cambia el costo por unidad con los precios de hoy. */
export async function comparacionDeVersiones(
  tx: Tx,
  contexto: ContextoOperativo,
  alcance: AlcanceDeSucursales,
  desde: ComposicionGuardada,
  hasta: ComposicionGuardada,
  conCostos: boolean,
): Promise<ComparacionDeVersiones> {
  const resueltosDesde = await resolverComponentes(tx, contexto, desde);
  const resueltosHasta = await resolverComponentes(tx, contexto, hasta);
  const paraComparar = (rs: readonly Resuelto[]) =>
    rs.map((r) => ({
      clave: r.clave,
      neto: cantidadDesdeTexto(r.cantidad),
      merma: porcentajeDesdeTexto(r.perdida),
    }));
  const porClave = new Map(
    [...resueltosDesde, ...resueltosHasta].map((r) => [r.clave, r] as const),
  );
  const cambios = compararVersionesDeReceta(
    paraComparar(resueltosDesde),
    paraComparar(resueltosHasta),
  ).map((cambio): CambioDeComponente => {
    const r = porClave.get(cambio.clave);
    return {
      productoId: r?.productoId ?? cambio.clave,
      nombre: r?.nombre ?? "",
      tipo: cambio.tipo,
    };
  });
  const base = { productoId: desde.productoId, desde: desde.numero, hasta: hasta.numero, cambios };
  if (!conCostos) return base;
  const costoDesde = await costearVersion(tx, contexto, alcance, desde, 1, new Map());
  const costoHasta = await costearVersion(tx, contexto, alcance, hasta, 1, new Map());
  if (costoDesde === null || costoHasta === null) return base;
  const incompleto = costoDesde.incompleto || costoHasta.incompleto;
  return {
    ...base,
    costos: {
      moneda: "ARS",
      porUnidadDesde: costoATexto(costoDesde.costoPorUnidad),
      porUnidadHasta: costoATexto(costoHasta.costoPorUnidad),
      diferencia: incompleto
        ? null
        : costoATexto(costoHasta.costoPorUnidad - costoDesde.costoPorUnidad),
      incompleto,
    },
  };
}

/** La ficha de cocina de una versión: cantidades BRUTAS y pasos, sin costos ni precios (D99, idea 6). */
export async function fichaDeCocinaDe(
  tx: Tx,
  contexto: ContextoOperativo,
  version: ComposicionGuardada,
): Promise<FichaDeCocina> {
  const resueltos = await resolverComponentes(tx, contexto, version);
  return {
    productoId: version.productoId,
    version: version.numero,
    rinde: version.rinde,
    pasos: version.pasos,
    componentes: resueltos.map((r): LineaDeCocina => {
      const bruto = brutoComoTexto(cantidadDesdeTexto(r.cantidad), porcentajeDesdeTexto(r.perdida));
      if (bruto === null) throw new RangeError("stock: el bruto de un componente no entra");
      return {
        productoId: r.productoId,
        nombre: r.nombre,
        tipo: r.tipo,
        cantidad: bruto,
        unidadId: r.unidadId,
      };
    }),
  };
}
