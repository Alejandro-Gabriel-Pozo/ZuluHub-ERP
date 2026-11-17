import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { ocultoPor } from "../dominio/carta-publica";
import type { LecturasDeCatalogo } from "./contrato";
import { tienePrecioParaLaCartaEnSucursal } from "./cotizar-para-vender";

/** Cuántos productos se quedan afuera de la carta de una sucursal y por qué (carta real §6.2). Cada producto cuenta en UN solo motivo, el primero que le toca. */
export type VisibilidadDeLaCarta = Readonly<{
  /** Cuántos productos saldrían hoy en la carta de esa sucursal. */
  salen: number;
  faltan: Readonly<{
    /** Productos desactivados. */
    desactivados: number;
    /** Productos ocultos en esa sucursal (por el local o por toda la empresa). */
    ocultos: number;
    /** Productos sin sección, o con la sección apagada. */
    sinSeccion: number;
    /** Productos activos, con sección, que no tienen precio para la carta en esa sucursal. */
    sinPrecio: number;
  }>;
}>;

/**
 * Qué productos saldrían en la carta de una sucursal, con las reglas de la carta real §4.3: activo, con sección activa, no oculto en la sucursal (la regla única
 * `ocultoPor`) y con precio para la carta (el MISMO `precio_vigente` que la caja). Con `hastaElPrimero` corta cuando encuentra uno que sale (alcanza para
 * saber si la carta tendría algo): `salen` es 1 y el resto de la cuenta queda incompleto. No mira si la sucursal o la empresa operan: eso lo decide quien llama.
 */
export async function visibilidadDeLaCarta(
  tx: LecturasDeCatalogo,
  entrada: Readonly<{
    empresaId: EmpresaId;
    sucursalId: SucursalId;
    ahora: Date;
    hastaElPrimero?: boolean;
  }>,
): Promise<VisibilidadDeLaCarta> {
  const { empresaId, sucursalId, ahora } = entrada;
  const productos = await tx.lectorDeCarta.productosQueSeVenden(empresaId);
  const filas = await tx.disponibilidadDeProductos.delLocal(empresaId, sucursalId);
  const porProducto = new Map<string, (typeof filas)[number][]>();
  for (const f of filas)
    porProducto.set(f.productoId, [...(porProducto.get(f.productoId) ?? []), f]);
  let salen = 0;
  const faltan = { desactivados: 0, ocultos: 0, sinSeccion: 0, sinPrecio: 0 };
  for (const p of productos) {
    if (!p.activo) faltan.desactivados += 1;
    else if (ocultoPor(porProducto.get(p.id) ?? [], sucursalId) !== null) faltan.ocultos += 1;
    else if (p.seccionActiva !== true) faltan.sinSeccion += 1;
    else if (
      !(await tienePrecioParaLaCartaEnSucursal(tx, {
        empresaId,
        productoId: p.id,
        sucursalId,
        ahora,
      }))
    )
      faltan.sinPrecio += 1;
    else {
      salen += 1;
      if (entrada.hastaElPrimero === true) break;
    }
  }
  return { salen, faltan };
}
