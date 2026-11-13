import { caminoDeNodo, type ArbolDeClasificacion } from "../../../primitivas/clasificacion/arbol";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  armarInstantanea,
  comprobarCantidad,
  comprobarQueSeVende,
  elegirOpciones,
  tienePrecioParaLaCarta,
  type ClasificacionDelRenglon,
  type ErrorDeCotizacion,
  type InstantaneaDeProducto,
} from "../dominio/cotizar";
import type { FilaDePrecio } from "../dominio/modelo";
import type { LecturasDeCatalogo } from "./contrato";

export type EntradaDeCotizarParaVender = Readonly<{
  /** La empresa del contexto de quien llama: el catálogo filtra siempre por ella (y la RLS lo repite). */
  empresaId: EmpresaId;
  sucursalId: SucursalId;
  productoId: string;
  /** Las opciones elegidas, INCLUIDA la de la variante. */
  opcionIds: readonly string[];
  /** Texto decimal exacto (no entero ni `number`), mayor que cero y múltiplo del paso del producto. */
  cantidad: string;
  ahora: Date;
}>;

/** Lo que ventas congela en el renglón: la instantánea del producto y su clasificación comercial vigente AHORA (`null` = «Sin elegir»). */
export type CotizacionParaVender = InstantaneaDeProducto &
  Readonly<{ clasificacion: ClasificacionDelRenglon | null }>;

/**
 * La clasificación que rige hoy para el producto, con el camino (departamento → nodo) y los nombres de cada nodo, leída en la MISMA transacción que la cotización. Un nodo desactivado
 * después de asignarlo se copia igual (el producto lo conserva). Un árbol dañado no se interpreta: `CLASIFICACION_INCONSISTENTE` (no se vende con un camino inventado).
 */
async function clasificacionDelRenglon(
  tx: LecturasDeCatalogo,
  empresaId: EmpresaId,
  productoId: string,
  ahora: Date,
): Promise<Resultado<ClasificacionDelRenglon | null, ErrorDeCotizacion>> {
  const { vigente } = await tx.clasificacion.clasificacionDelProducto(empresaId, productoId, ahora);
  if (vigente === null || vigente.nodoId === null) return ok(null);
  const nodos = await tx.clasificacion.todos(empresaId);
  const arbol: ArbolDeClasificacion = new Map(
    nodos.map((n) => [n.id, { id: n.id, padreId: n.padreId, activo: n.activo }]),
  );
  const camino = caminoDeNodo(arbol, vigente.nodoId);
  if (!camino.ok) return err("CLASIFICACION_INCONSISTENTE");
  const nombres = new Map(nodos.map((n) => [n.id, n.nombre]));
  const raiz = camino.valor[0];
  if (raiz === undefined) return err("CLASIFICACION_INCONSISTENTE");
  return ok({
    departamentoId: raiz,
    camino: camino.valor.map((id) => ({ id, nombre: nombres.get(id) ?? "" })),
  });
}

/**
 * `cotizarParaVender` (E2 mínimo §3.6): el puerto que usa ventas para fijar la línea del ticket. LECTURA PURA, dentro de la transacción de
 * quien agrega la línea (no abre ninguna y no tiene acción propia: ventas autoriza con la suya). Devuelve el precio vigente de la sucursal
 * con las opciones elegidas y todo lo que ventas congela en la línea (`precioId`, `versionDeOpcionId` de cada opción, recargos, alícuota,
 * nombres): el cierre no vuelve a cotizar. Un producto de otra empresa es `PRODUCTO_NO_ENCONTRADO`, igual que uno inexistente. El precio
 * sale de `precio_vigente` y la cuenta es UNA función pura (`armarInstantanea`): la que usará la carta.
 */
export async function cotizarParaVender(
  tx: LecturasDeCatalogo,
  entrada: EntradaDeCotizarParaVender,
): Promise<Resultado<CotizacionParaVender, ErrorDeCotizacion>> {
  const { empresaId } = entrada;
  const producto = await tx.productos.obtener(empresaId, entrada.productoId);
  if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
  const seVende = comprobarQueSeVende(producto);
  if (!seVende.ok) return seVende;
  const sucursal = await tx.sucursales.obtener(empresaId, entrada.sucursalId);
  if (sucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (!sucursal.activa) return err("SUCURSAL_INACTIVA");
  const cantidad = comprobarCantidad(producto, entrada.cantidad);
  if (!cantidad.ok) return cantidad;

  const grupos = await tx.opciones.gruposDelProducto(empresaId, producto.id);
  const elegidas = elegirOpciones(grupos, entrada.opcionIds);
  if (!elegidas.ok) return elegidas;

  const variante = elegidas.valor.find((e) => e.grupo.clase === "VARIANTE") ?? null;
  const precioBase = await tx.precios.vigente(
    empresaId,
    producto.id,
    variante === null ? null : variante.opcion.id,
    entrada.sucursalId,
    entrada.ahora,
  );
  const recargosDeSucursal = new Map<string, FilaDePrecio | null>();
  for (const { grupo, opcion } of elegidas.valor) {
    if (grupo.clase !== "ADICIONAL") continue;
    recargosDeSucursal.set(
      opcion.id,
      await tx.precios.vigente(
        empresaId,
        producto.id,
        opcion.id,
        entrada.sucursalId,
        entrada.ahora,
      ),
    );
  }
  const instantanea = armarInstantanea({
    producto,
    sucursalId: entrada.sucursalId,
    cantidad: cantidad.valor,
    elegidas: elegidas.valor,
    precioBase,
    recargosDeSucursal,
  });
  if (!instantanea.ok) return instantanea;
  const clasificacion = await clasificacionDelRenglon(tx, empresaId, producto.id, entrada.ahora);
  if (!clasificacion.ok) return clasificacion;
  return ok({ ...instantanea.valor, clasificacion: clasificacion.valor });
}

/**
 * ¿Se puede mostrar este producto en la carta pública de esta sucursal? Decisión 175: sin precio (precio abierto) NO se muestra; en el
 * mostrador sí se vende. Usa el MISMO `precio_vigente` que `cotizarParaVender`: con variante, un tamaño se muestra solo si resuelve a precio
 * y el producto se muestra si al menos uno lo hace. La carta (otra etapa) la aplica además de sus condiciones propias.
 */
export async function tienePrecioParaLaCartaEnSucursal(
  tx: LecturasDeCatalogo,
  entrada: Readonly<{
    empresaId: EmpresaId;
    productoId: string;
    sucursalId: SucursalId;
    ahora: Date;
  }>,
): Promise<boolean> {
  const grupos = await tx.opciones.gruposDelProducto(entrada.empresaId, entrada.productoId);
  const variante = grupos.find((g) => g.grupo.clase === "VARIANTE" && g.grupo.activo);
  const duenos =
    variante === undefined ? [null] : variante.opciones.filter((o) => o.activa).map((o) => o.id);
  const resueltas = await Promise.all(
    duenos.map((opcion) =>
      tx.precios.vigente(
        entrada.empresaId,
        entrada.productoId,
        opcion,
        entrada.sucursalId,
        entrada.ahora,
      ),
    ),
  );
  return tienePrecioParaLaCarta(resueltas);
}
