import { estadoDeModulos } from "../../../capacidades/modulos/activos";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
} from "../../../primitivas/cantidad/con-signo";
import { sucursalId as aSucursalId } from "../../../primitivas/identificadores/marca";
import { situacionDeConsumo, type ProductoParaExplotar } from "../dominio/explosion";
import { esUnidadConocida } from "../dominio/composicion";
import { MAXIMO_DE_NIVELES_DE_RECETA } from "../dominio/subcomposicion";
import { esUuid } from "../persistencia/filas";
import type { TxDeStock } from "./contrato";
import { claveDePar, disponibleDe } from "./lectura-de-lotes";
import type {
  TxDeLecturaDeStock,
  ControlDeUnProducto,
  ExistenciaDeProducto,
} from "./tipos-de-puertos";

// ---- el módulo está activo ----------------------------------------------------------------------------------------------------

/**
 * ¿Opera el módulo `stock` para la empresa ahora? Es lo que el guard mira de un módulo (activo, solo lectura, en desarrollo o no activo), sin
 * rol ni acción: los puertos no autorizan, pero un módulo apagado no descuenta ni recibe nada (P20; nace cerrado). Los datos salen de la misma
 * transacción, sin caché.
 */
export async function estadoDelModuloDeStock(
  tx: Pick<TxDeStock, "autorizacion">,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
): Promise<"ACTIVO" | "MODULO_EN_DESARROLLO" | "MODULO_NO_ACTIVO" | "MODULO_EN_SOLO_LECTURA"> {
  const datos = await tx.autorizacion.delActor(contexto);
  const estado = estadoDeModulos(reglas.catalogo, datos.modulosActivados, datos.modulosHabilitados);
  if (estado.modulosActivos.has("stock")) return "ACTIVO";
  if (estado.modulosEnSoloLectura.has("stock")) return "MODULO_EN_SOLO_LECTURA";
  return reglas.catalogo.stock.estado === "en_desarrollo"
    ? "MODULO_EN_DESARROLLO"
    : "MODULO_NO_ACTIVO";
}

// ---- lectura de lo que hace falta para explotar ------------------------------------------------------------------------------

export const unidadConocida = (texto: string) => {
  if (!esUnidadConocida(texto)) throw new RangeError(`unidad desconocida en la base: ${texto}`);
  return texto;
};

/**
 * Los productos de esos ids en la forma que necesita la explosión (E5 §3.3, E6 §3.3): su clase, su unidad base, su artículo propio (activo o no)
 * y su receta vigente (la última versión; una versión vacía retira la receta y vale `null`) con la merma de cada componente y los elaborados
 * que lleva. Los elaborados de las recetas se leen también, hasta `MAXIMO_DE_NIVELES_DE_RECETA` + 1 rondas (una más que las que explota:
 * la explosión dice `RECETA_DEMASIADO_ANIDADA` en lugar de un producto desconocido). Los ids que no existen no figuran. Todo se lee en la
 * transacción del llamador.
 */
export async function productosParaExplotar(
  tx: Pick<TxDeLecturaDeStock, "articulosDeStock" | "composicionesDeStock" | "productosParaStock">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  productoIds: readonly string[],
): Promise<Map<string, ProductoParaExplotar>> {
  const resultado = new Map<string, ProductoParaExplotar>();
  let pendientes: readonly string[] = [...new Set(productoIds)];
  for (let ronda = 0; ronda <= MAXIMO_DE_NIVELES_DE_RECETA && pendientes.length > 0; ronda++) {
    const leidos = await productosDeUnaRonda(tx, contexto, pendientes);
    const siguientes = new Set<string>();
    for (const [id, producto] of leidos.productos) {
      resultado.set(id, producto);
      for (const hijo of leidos.elaboradosDe.get(id) ?? []) {
        if (!resultado.has(hijo)) siguientes.add(hijo);
      }
    }
    pendientes = [...siguientes];
  }
  return resultado;
}

async function productosDeUnaRonda(
  tx: Pick<TxDeLecturaDeStock, "articulosDeStock" | "composicionesDeStock" | "productosParaStock">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  productoIds: readonly string[],
): Promise<
  Readonly<{
    productos: Map<string, ProductoParaExplotar>;
    elaboradosDe: ReadonlyMap<string, readonly string[]>;
  }>
> {
  const empresa = contexto.empresaId;
  const productos = await tx.productosParaStock.porIds(empresa, productoIds);
  const ids = productos.map((p) => p.id);
  const articulos = await tx.articulosDeStock.porProductos(empresa, ids);
  const articuloDe = new Map(articulos.map((a) => [a.productoId, a]));
  const recetas = await tx.composicionesDeStock.ultimasVersiones(empresa, ids);
  const deComponentes = await tx.articulosDeStock.porIds(
    empresa,
    [...recetas.values()].flatMap((r) =>
      r.componentes.flatMap((c) => (c.articuloId === null ? [] : [c.articuloId])),
    ),
  );
  const unidadDe = new Map(deComponentes.map((a) => [a.id, unidadConocida(a.unidadDeStockId)]));
  const unidadDelComponente = (articuloId: string) => {
    const unidad = unidadDe.get(articuloId);
    if (unidad === undefined)
      throw new RangeError("el artículo de un componente de la receta no existe");
    return unidad;
  };
  const resultado = new Map<string, ProductoParaExplotar>();
  const elaboradosDe = new Map<string, readonly string[]>();
  for (const p of productos) {
    const propio = articuloDe.get(p.id);
    const receta = recetas.get(p.id);
    if (receta !== undefined) {
      elaboradosDe.set(
        p.id,
        receta.componentes.flatMap((c) => (c.compuestoId === null ? [] : [c.compuestoId])),
      );
    }
    resultado.set(p.id, {
      claseDeUso: p.claseDeUso,
      unidadBaseId: unidadConocida(p.unidadBaseId),
      articulo:
        propio === undefined
          ? null
          : {
              articuloId: propio.id,
              unidadDeStockId: unidadConocida(propio.unidadDeStockId),
              activo: propio.activo,
            },
      composicion:
        receta === undefined || receta.componentes.length === 0
          ? null
          : {
              composicionId: receta.id,
              rinde: cantidadDesdeTexto(receta.rinde),
              componentes: receta.componentes.flatMap((c) =>
                c.articuloId === null
                  ? []
                  : [
                      {
                        articuloId: c.articuloId,
                        cantidad: cantidadDesdeTexto(c.cantidad),
                        unidadId: unidadConocida(c.unidadId),
                        unidadDeStockId: unidadDelComponente(c.articuloId),
                        perdida: porcentajeDesdeTexto(c.perdida),
                      },
                    ],
              ),
              compuestos: receta.componentes.flatMap((c) =>
                c.compuestoId === null
                  ? []
                  : [
                      {
                        compuestoId: c.compuestoId,
                        cantidad: cantidadDesdeTexto(c.cantidad),
                        unidadId: unidadConocida(c.unidadId),
                        perdida: porcentajeDesdeTexto(c.perdida),
                      },
                    ],
              ),
            },
    });
  }
  return { productos: resultado, elaboradosDe };
}

export const soloUuids = (ids: readonly string[]): string[] => [...new Set(ids.filter(esUuid))];

/**
 * ¿Controla stock y le falta receta cada uno de estos productos? Es `situacionDeConsumo` del dominio (una sola regla): controla = tiene
 * artículo activo o una receta con componentes; falta receta = es `VENDIBLE` y no tiene ninguna de las dos. Con el módulo apagado (o fuera de
 * su plan) NADA controla (P20): el producto sigue vendiéndose sin descontar. Un producto que no existe en la empresa no controla ni falta
 * receta; todo id pedido figura en el resultado.
 */
export async function controlaStock(
  tx: Pick<TxDeStock, "autorizacion"> & TxDeLecturaDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  productoIds: readonly string[],
): Promise<ReadonlyMap<string, ControlDeUnProducto>> {
  const resultado = new Map<string, ControlDeUnProducto>(
    productoIds.map((id) => [id, { controla: false, faltaReceta: false }]),
  );
  if ((await estadoDelModuloDeStock(tx, contexto, reglas)) !== "ACTIVO") return resultado;
  const productos = await productosParaExplotar(tx, contexto, soloUuids(productoIds));
  for (const id of productoIds) {
    const producto = productos.get(id.toLowerCase());
    if (producto === undefined) continue;
    const situacion = situacionDeConsumo(producto);
    resultado.set(id, {
      controla: situacion === "ARTICULO" || situacion === "COMPOSICION",
      faltaReceta: situacion === "FALTA_RECETA",
    });
  }
  return resultado;
}

/** El depósito de venta ACTIVO de la sucursal, o `null` si no hay (ventas decide qué hacer: con stock activo y líneas que controlan, falla cerrado). */
export async function depositoDeVentaDe(
  tx: Pick<TxDeLecturaDeStock, "depositos">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  sucursalId: string,
): Promise<Readonly<{ depositoId: string }> | null> {
  if (typeof sucursalId !== "string" || !esUuid(sucursalId)) return null;
  const deposito = await tx.depositos.deVentaDe(
    contexto.empresaId,
    aSucursalId(sucursalId.toLowerCase()),
  );
  return deposito === null ? null : { depositoId: deposito.id };
}

/**
 * La existencia de cada producto con artículo en ese depósito, para MOSTRAR («quedan 2»): texto decimal exacto en la unidad de stock (no se
 * convierte a la unidad de venta: eso es de la pantalla). Un producto sin artículo no figura; con artículo y sin movimientos vale `0.0000`.
 * Un depósito que no existe en la empresa da una lista vacía.
 */
export async function existenciasParaMostrar(
  tx: TxDeLecturaDeStock,
  contexto: Pick<ContextoOperativo, "empresaId" | "ahora">,
  productoIds: readonly string[],
  depositoId: string,
): Promise<readonly ExistenciaDeProducto[]> {
  if (typeof depositoId !== "string" || !esUuid(depositoId)) return [];
  const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId.toLowerCase());
  if (deposito === null) return [];
  const articulos = await tx.articulosDeStock.porProductos(
    contexto.empresaId,
    soloUuids(productoIds).map((id) => id.toLowerCase()),
  );
  const saldos = await tx.movimientosDeStock.leerSaldos(
    contexto.empresaId,
    articulos.map((a) => ({ depositoId: deposito.id, articuloId: a.id })),
    false,
  );
  const existenciaDe = (articuloId: string): string => {
    const guardado = cantidadConSignoDesdeTexto(saldos.get(`${deposito.id}|${articuloId}`) ?? "0");
    if (!guardado.ok) throw new RangeError("stock: el saldo guardado no es una cantidad");
    return cantidadConSignoATexto(guardado.valor);
  };
  // E6: lo que se muestra es lo DISPONIBLE (lotes liberados y no vencidos; el depósito de venta es `NORMAL`): la misma regla que elige los lotes.
  const disponibles = await disponibleDe(
    tx,
    contexto,
    articulos.map((a) => ({
      depositoId: deposito.id,
      articuloId: a.id,
      uso: deposito.uso,
      existencia: existenciaDe(a.id),
    })),
  );
  return articulos.map((a) => ({
    productoId: a.productoId,
    existencia: disponibles.get(claveDePar(deposito.id, a.id)) ?? existenciaDe(a.id),
    unidadId: a.unidadDeStockId,
  }));
}
