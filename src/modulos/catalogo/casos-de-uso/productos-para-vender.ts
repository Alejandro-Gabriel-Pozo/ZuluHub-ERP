import type { ContextoOperativo } from "../../../contexto/contexto";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ocultoPor, type Disponibilidad } from "../dominio/carta-publica";
import {
  armarInstantanea,
  comprobarQueSeVende,
  type Elegida,
  type GrupoConOpciones,
} from "../dominio/cotizar";
import { leerCantidad } from "../dominio/forma-de-venta";
import type { FilaDePrecio, Producto } from "../dominio/modelo";
import type { LecturasDeCatalogo } from "./contrato";

/** Tope de productos por página: el de la lista de gestión (50) llevado a 100, que es lo que cabe en una pantalla de venta con sus opciones leídas en la misma transacción. */
export const TAMANO_DE_PAGINA_PARA_VENDER = 100;

/** Lo que muestra el mostrador como precio: el del producto, «Según medida» (con variante: cada medida lleva el suyo) o «Sin precio» (precio abierto: se escribe al vender). */
export type PrecioParaVender =
  | Readonly<{ tipo: "BASE"; importe: string }>
  | Readonly<{ tipo: "SEGUN_MEDIDA" }>
  | Readonly<{ tipo: "SIN_PRECIO" }>;

export type MedidaParaVender = Readonly<{
  id: string;
  nombre: string;
  /** El precio unitario de esa medida en la sucursal, texto decimal exacto. */
  precio: string;
}>;

export type OpcionParaVender = Readonly<{
  id: string;
  nombre: string;
  /** El recargo que rige en la sucursal (el propio del local o el de la empresa), texto decimal exacto. */
  recargo: string;
}>;

export type GrupoParaVender = Readonly<{
  id: string;
  clase: "INCLUIDA" | "ADICIONAL";
  nombre: string;
  obligatorio: boolean;
  admiteVarias: boolean;
  opciones: readonly OpcionParaVender[];
}>;

export type ProductoParaVender = Readonly<{
  id: string;
  nombre: string;
  /** La sección ACTIVA de la carta del producto; `null` si no tiene o la suya está desactivada. */
  seccionId: string | null;
  unidadDeVentaId: string;
  pasoMinimo: string;
  /** Las fracciones que ofrece (2, 4, 8); vacío = no se vende por fracciones. */
  porcionesOfrecidas: readonly number[];
  precio: PrecioParaVender;
  /** El grupo de la variante con una entrada por medida vendible; `null` si el producto no tiene variante. */
  variante: Readonly<{
    grupoId: string;
    nombre: string;
    esTamano: boolean;
    opciones: readonly MedidaParaVender[];
  }> | null;
  grupos: readonly GrupoParaVender[];
}>;

export type PaginaParaVender = Readonly<{
  secciones: readonly Readonly<{ id: string; nombre: string; orden: number }>[];
  productos: readonly ProductoParaVender[];
  /** Pasar como `despuesDe` para pedir la página siguiente; `null` si no hay más. */
  siguiente: Readonly<{ nombreClave: string; id: string }> | null;
}>;

type Armado = Readonly<{
  tx: LecturasDeCatalogo;
  contexto: ContextoOperativo;
  sucursal: SucursalId;
}>;

/**
 * El precio de UNA elección parcial con la cuenta única (`armarInstantanea`, la de `cotizarParaVender`): nada se suma acá. `precioBase` es lo que resolvió `precio_vigente`;
 * `recargos`, lo que resolvió para cada opción adicional elegida.
 */
function cotizar(
  a: Armado,
  p: Producto,
  elegidas: readonly Elegida[],
  precioBase: FilaDePrecio | null,
  recargos: ReadonlyMap<string, FilaDePrecio | null>,
) {
  const paso = leerCantidad(p.pasoMinimo);
  if (paso === null) return null;
  const r = armarInstantanea({
    producto: p,
    sucursalId: a.sucursal,
    cantidad: paso,
    elegidas,
    precioBase,
    recargosDeSucursal: recargos,
  });
  return r.ok ? r.valor : null;
}

const vigente = (a: Armado, p: Producto, opcionId: string | null) =>
  a.tx.precios.vigente(a.contexto.empresaId, p.id, opcionId, a.sucursal, a.contexto.ahora);

/** La medida vendible de cada opción activa de la variante: la que no resuelve a precio no se ofrece (no se podría cotizar: `VARIANTE_SIN_PRECIO`). */
async function medidasDe(a: Armado, p: Producto, g: GrupoConOpciones) {
  const medidas: MedidaParaVender[] = [];
  for (const opcion of g.opciones) {
    const q = cotizar(
      a,
      p,
      [{ grupo: g.grupo, opcion }],
      await vigente(a, p, opcion.id),
      new Map(),
    );
    if (q === null || q.precioUnitario === null) continue;
    medidas.push({ id: opcion.id, nombre: opcion.nombre, precio: q.precioUnitario });
  }
  return medidas;
}

/** Las opciones activas de un grupo de incluidas o adicionales con su recargo de la sucursal; `null` si alguna no se puede cotizar (falla cerrada: el producto no se ofrece). */
async function opcionesDe(a: Armado, p: Producto, g: GrupoConOpciones) {
  const opciones: OpcionParaVender[] = [];
  for (const opcion of g.opciones) {
    const recargos = new Map<string, FilaDePrecio | null>();
    if (g.grupo.clase === "ADICIONAL") recargos.set(opcion.id, await vigente(a, p, opcion.id));
    const q = cotizar(a, p, [{ grupo: g.grupo, opcion }], null, recargos);
    const recargo = q?.opciones[0]?.recargo;
    if (recargo === undefined || !precioDeVentaDesdeTexto(recargo).ok) return null;
    opciones.push({ id: opcion.id, nombre: opcion.nombre, recargo });
  }
  return opciones;
}

/** El producto tal como lo ofrece el mostrador, o `null` si no se podría vender completo (nada a medias: un producto con un grupo obligatorio sin opciones o sin precio no se ofrece). */
async function productoParaVender(
  a: Armado,
  p: Producto,
  grupos: readonly GrupoConOpciones[],
  seccionesActivas: ReadonlySet<string>,
): Promise<ProductoParaVender | null> {
  const activos = grupos
    .filter((g) => g.grupo.activo)
    .map((g) => ({ grupo: g.grupo, opciones: g.opciones.filter((o) => o.activa) }));
  if (activos.some((g) => g.grupo.esObligatorio && g.opciones.length === 0)) return null;

  const deVariante = activos.find((g) => g.grupo.clase === "VARIANTE");
  let precio: PrecioParaVender;
  let variante: ProductoParaVender["variante"] = null;
  if (deVariante === undefined) {
    const q = cotizar(a, p, [], await vigente(a, p, null), new Map());
    if (q === null) return null;
    precio =
      q.precioUnitario === null
        ? { tipo: "SIN_PRECIO" }
        : { tipo: "BASE", importe: q.precioUnitario };
  } else {
    const opciones = await medidasDe(a, p, deVariante);
    if (opciones.length === 0) return null;
    precio = { tipo: "SEGUN_MEDIDA" };
    variante = {
      grupoId: deVariante.grupo.id,
      nombre: deVariante.grupo.nombre,
      esTamano: deVariante.grupo.esTamano,
      opciones,
    };
  }

  const resto: GrupoParaVender[] = [];
  for (const g of activos) {
    if (g.grupo.clase === "VARIANTE") continue;
    const opciones = await opcionesDe(a, p, g);
    if (opciones === null) return null;
    resto.push({
      id: g.grupo.id,
      clase: g.grupo.clase,
      nombre: g.grupo.nombre,
      obligatorio: g.grupo.esObligatorio,
      admiteVarias: g.grupo.admiteVarias,
      opciones,
    });
  }
  return {
    id: p.id,
    nombre: p.nombre,
    seccionId:
      p.seccionDeCartaId !== null && seccionesActivas.has(p.seccionDeCartaId)
        ? p.seccionDeCartaId
        : null,
    unidadDeVentaId: p.unidadDeVentaId,
    pasoMinimo: p.pasoMinimo,
    porcionesOfrecidas: p.porcionesOfrecidas,
    precio,
    variante,
    grupos: resto,
  };
}

/**
 * UNA página de lo que el mostrador ofrece en la sucursal (la sucursal ya viene validada por quien llama: existe, es de la empresa, está abierta y dentro del alcance). Lee lo que hace falta y
 * arma cada producto con la cuenta única de precios; `null` en el cursor = primera página. Solo entran los que `cotizarParaVender` aceptaría y, de ellos, los no ocultos en la sucursal.
 */
export async function paginaParaVender(
  tx: LecturasDeCatalogo,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
  despuesDe: Readonly<{ nombreClave: string; id: string }> | undefined,
): Promise<PaginaParaVender> {
  const a: Armado = { tx, contexto, sucursal };
  const filas = await tx.productos.listar(contexto.empresaId, {
    activo: true,
    faltaCompletar: false,
    despuesDe,
    limite: TAMANO_DE_PAGINA_PARA_VENDER + 1,
  });
  const pagina = filas.slice(0, TAMANO_DE_PAGINA_PARA_VENDER);
  const secciones = (await tx.seccionesDeCarta.todas(contexto.empresaId))
    .filter((s) => s.activa)
    .sort((x, y) => x.orden - y.orden || x.nombre.localeCompare(y.nombre));
  const activas = new Set<string>(secciones.map((s) => s.id));
  const deLaSucursal = new Map<string, Disponibilidad[]>();
  for (const f of await tx.disponibilidadDeProductos.delLocal(contexto.empresaId, sucursal))
    deLaSucursal.set(f.productoId, [...(deLaSucursal.get(f.productoId) ?? []), f]);

  const productos: ProductoParaVender[] = [];
  for (const { producto: p } of pagina) {
    if (!comprobarQueSeVende(p).ok) continue;
    if (ocultoPor(deLaSucursal.get(p.id) ?? [], sucursal) !== null) continue;
    const grupos = await tx.opciones.gruposDelProducto(contexto.empresaId, p.id);
    const listo = await productoParaVender(a, p, grupos, activas);
    if (listo !== null) productos.push(listo);
  }
  const ultima = pagina[pagina.length - 1];
  return {
    secciones: secciones.map((s) => ({ id: s.id, nombre: s.nombre, orden: s.orden })),
    productos,
    siguiente:
      filas.length > TAMANO_DE_PAGINA_PARA_VENDER && ultima !== undefined
        ? { nombreClave: ultima.nombreClave, id: ultima.producto.id }
        : null,
  };
}
