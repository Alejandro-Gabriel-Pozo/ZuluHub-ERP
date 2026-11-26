import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { seControlaStockLaClase, seProduceLaClase } from "../../catalogo/publico";
import { esUuid } from "../persistencia/filas";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

type R<S> = Resultado<S, ErrorDeStock>;

/** La confirmación de que la persona vio que las cuentas abiertas con este plato pasarán a descontar el plato y no sus ingredientes (PRO-D1). */
export const CONFIRMACION_DE_CUENTAS_ABIERTAS = "stock.cuentas_abiertas_con_el_plato";

export type EntradaDeControlarArticulo = Readonly<{
  productoId: string;
  /** `[CONFIRMACION_DE_CUENTAS_ABIERTAS]` si la persona aceptó el aviso; cualquier otro valor se rechaza (lista de permitidos). */
  confirmaciones?: readonly string[] | undefined;
}>;
export type SalidaDeControlarArticulo = Readonly<{ articuloId: string; yaExistia: boolean }>;
export type EntradaDeDejarDeControlar = Readonly<{ productoId: string }>;
export type SalidaDeDejarDeControlar = Readonly<{ yaEstaba: boolean }>;

/**
 * Controlar el stock de un producto (E5 §3.2): crea su artículo de stock, con la unidad base del producto (que no cambia nunca). Guard
 * `articulos.controlar` con alcance TODAS (el artículo es de la empresa, no de una sucursal: SUPUESTO (DEC-0077), igual que los datos del producto en
 * el catálogo). El producto existe y está activo (se lee con `FOR SHARE`: desactivarlo a la vez espera a este comando). Solo la materia prima,
 * el insumo y la reventa se controlan (`CLASE_NO_CONTROLABLE`): lo impone la base, una sola vez, y el caso de uso traduce el error. Si el
 * producto ya tuvo artículo y se dejó de controlar, se reactiva el MISMO (su libro sigue). Repetición (`YA_ESTABA`): ya controlado devuelve
 * `yaExistia` sin escribir ni auditar.
 *
 * Stock propio de un elaborado o vendible (E6, D94): solo con la perilla `produccion` y una receta vigente; la venta pasa a descontar ese artículo y no sus ingredientes.
 * Si hay cuentas abiertas con ese plato (PRO-D1, condición del dueño sobre DEC-PRO-001), al cerrarse descontarán el plato y no sus ingredientes: sin la confirmación de la persona
 * devuelve `CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION` y no escribe nada; con ella crea o reactiva el artículo y la auditoría deja cuántas eran. La lectura corre en la MISMA transacción
 * (SERIALIZABLE) que la activación: una línea agregada a la vez se serializa con ella. Encenderlo ya encendido no pide nada (`yaExistia`).
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
        // Lista de permitidos: la única confirmación que existe es la de las cuentas abiertas; cualquier otra cosa se rechaza.
        const confirmaciones = entrada.confirmaciones ?? [];
        if (
          !Array.isArray(confirmaciones) ||
          confirmaciones.some((c: unknown) => c !== CONFIRMACION_DE_CUENTAS_ABIERTAS)
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
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
        // La base admite también el elaborado y el vendible (0032, E6: stock propio, D94); este caso de uso solo los controla con la perilla `produccion`
        // y una receta vigente. Sin ellas nace cerrado: lo que no se declara no se habilita.
        if (!seControlaStockLaClase(producto.claseDeUso)) {
          if (!seProduceLaClase(producto.claseDeUso)) {
            return err("CLASE_NO_CONTROLABLE");
          }
          const derechos = await tx.derechos.deLaEmpresa(contexto);
          if (!exigirPerilla(derechos, "produccion", { empresaId }).ok) {
            return err({ error: "FUNCION_NO_INCLUIDA", perilla: "produccion" });
          }
          const receta = await tx.composicionesDeStock.ultimaVersion(empresaId, producto.id);
          if (receta === null || receta.componentes.length === 0) return err("SIN_COMPOSICION");
        }
        let cuentasConfirmadas = 0;
        if (
          !seControlaStockLaClase(producto.claseDeUso) &&
          dependencias.cuentasAbiertas !== undefined
        ) {
          const cuentas = await dependencias.cuentasAbiertas(tx, contexto, producto.id);
          if (cuentas > 0) {
            if (!confirmaciones.includes(CONFIRMACION_DE_CUENTAS_ABIERTAS)) {
              return err({ error: "CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION", cuentas });
            }
            cuentasConfirmadas = cuentas;
          }
        }
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
            ...(cuentasConfirmadas > 0 ? { cuentasAbiertasAceptadas: cuentasConfirmadas } : {}),
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
