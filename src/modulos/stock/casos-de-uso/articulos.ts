import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { seConsumeLaClase } from "../../catalogo/publico";
import { esUuid } from "../persistencia/filas";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

type R<S> = Resultado<S, ErrorDeStock>;

export type EntradaDeControlarArticulo = Readonly<{ productoId: string }>;
export type SalidaDeControlarArticulo = Readonly<{ articuloId: string; yaExistia: boolean }>;
export type EntradaDeDejarDeControlar = Readonly<{ productoId: string }>;
export type SalidaDeDejarDeControlar = Readonly<{ yaEstaba: boolean }>;

/**
 * Controlar el stock de un producto (E5 §3.2): crea su artículo de stock, con la unidad base del producto (que no cambia nunca). Guard
 * `articulos.controlar` con alcance TODAS (el artículo es de la empresa, no de una sucursal: SUPUESTO, igual que los datos del producto en
 * el catálogo). El producto existe y está activo (se lee con `FOR SHARE`: desactivarlo a la vez espera a este comando). Solo la materia prima,
 * el insumo y la reventa se controlan (`CLASE_NO_CONTROLABLE`): lo impone la base, una sola vez, y el caso de uso traduce el error. Si el
 * producto ya tuvo artículo y se dejó de controlar, se reactiva el MISMO (su libro sigue). Repetición (`YA_ESTABA`): ya controlado devuelve
 * `yaExistia` sin escribir ni auditar.
 */
export function armarControlarArticulo(dependencias: DependenciasDeStock) {
  return async function controlarArticulo(
    contexto: ContextoOperativo,
    entrada: EntradaDeControlarArticulo,
  ): Promise<R<SalidaDeControlarArticulo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeControlarArticulo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["articulos.controlar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.productoId)) return err("PRODUCTO_NO_ENCONTRADO");
        const producto = await tx.productosParaStock.bloquearCompartido(
          empresaId,
          entrada.productoId,
        );
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        const existente = await tx.articulosDeStock.bloquearPorProducto(empresaId, producto.id);
        if (existente !== null && existente.activo) {
          return ok({ articuloId: existente.id, yaExistia: true });
        }
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        // La base admite también el elaborado y el vendible (0032, E6: stock propio, D94); este caso de uso solo los controla cuando la empresa
        // enciende la producción (T9). Hasta entonces nace cerrado: lo que no se declara no se habilita.
        if (!seConsumeLaClase(producto.claseDeUso)) return err("CLASE_NO_CONTROLABLE");
        const articulo =
          existente === null
            ? await tx.articulosDeStock.insertar(empresaId, {
                productoId: producto.id,
                unidadDeStockId: producto.unidadBaseId,
                dimension: producto.dimension,
              })
            : await tx.articulosDeStock.cambiarActivo(empresaId, existente.id, true);
        if (articulo === null) throw new Error("el artículo bloqueado desapareció");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ARTICULO_CONTROLADO",
          entidad: "articulo_de_stock",
          entidadId: articulo.id,
          antes: existente === null ? null : { activo: false },
          despues: {
            productoId: producto.id,
            unidadDeStockId: articulo.unidadDeStockId,
            activo: true,
          },
        });
        return ok({ articuloId: articulo.id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Dejar de controlar el stock de un producto (E5 §3.2): el artículo queda INACTIVO; no se borra nada (sus movimientos y su saldo siguen
 * consultables). Guard `articulos.dejar_de_controlar` con alcance TODAS. Con el producto en la composición vigente de otro, la base lo
 * rechaza (`ARTICULO_EN_COMPOSICION_ACTIVA`, S-10). Repetición (`YA_ESTABA`): sin artículo, o ya inactivo, devuelve `yaEstaba`.
 */
export function armarDejarDeControlar(dependencias: DependenciasDeStock) {
  return async function dejarDeControlar(
    contexto: ContextoOperativo,
    entrada: EntradaDeDejarDeControlar,
  ): Promise<R<SalidaDeDejarDeControlar>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeDejarDeControlar>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "articulos.dejar_de_controlar",
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.productoId)) return err("PRODUCTO_NO_ENCONTRADO");
        const producto = await tx.productosParaStock.obtener(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        const actual = await tx.articulosDeStock.bloquearPorProducto(empresaId, producto.id);
        if (actual === null || !actual.activo) return ok({ yaEstaba: true });
        await tx.articulosDeStock.cambiarActivo(empresaId, actual.id, false);
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ARTICULO_DEJADO_DE_CONTROLAR",
          entidad: "articulo_de_stock",
          entidadId: actual.id,
          antes: { activo: true },
          despues: { activo: false },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
