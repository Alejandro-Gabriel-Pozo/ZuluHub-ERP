import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ClaseDeUso, DependenciasDeConsultasDeCatalogo } from "../casos-de-uso/contrato";
import type { PresentacionGuardada } from "../persistencia/repositorio-de-presentaciones";
import type { UnidadDeMedida } from "../persistencia/repositorio-de-unidades";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, MotivoDeRechazo | ErrorDePersistencia>;

/** Las presentaciones de compra de un producto con lo mínimo del producto para mostrarlas (E9 §3.2, X5). */
export type PresentacionesDelProducto = Readonly<{
  productoId: string;
  nombre: string;
  claseDeUso: ClaseDeUso;
  activo: boolean;
  /** La unidad base (con su símbolo) en que se cuenta la cantidad de cada presentación; `null` solo si el código guardado no figura en la lista de unidades (dato dañado: no se inventa). */
  unidadBase: UnidadDeMedida | null;
  /** Todas, también las apagadas, por nombre. */
  presentaciones: readonly PresentacionGuardada[];
}>;

/**
 * Las presentaciones de un producto para la solapa «Cómo se compra» (T0): todas, activas y apagadas (las apagadas se pueden reactivar), por nombre. Pide `productos.ver` (los tres roles).
 * Un producto de otra empresa o inexistente es `null`, indistinguible. Es una LECTURA de solo lectura: no escribe ni audita.
 */
export function crearConsultasDePresentaciones(d: DependenciasDeConsultasDeCatalogo) {
  return {
    verPresentacionesDelProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<R<PresentacionesDelProducto | null>> =>
      d.transacciones.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx): Promise<R<PresentacionesDelProducto | null>> => {
          const permiso = await exigirAccion(
            d.reglas,
            DECLARACIONES_DE_CONSULTAS.verPresentacionesDelProducto.accion,
            () => tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          const producto = await tx.productos.obtener(contexto.empresaId, entrada.productoId);
          if (producto === null) return ok(null);
          const unidades = await tx.unidades.todas();
          return ok({
            productoId: producto.id,
            nombre: producto.nombre,
            claseDeUso: producto.claseDeUso,
            activo: producto.activo,
            unidadBase: unidades.find((u) => u.id === producto.unidadBaseId) ?? null,
            presentaciones: await tx.presentacionesDeProducto.delProducto(
              contexto.empresaId,
              producto.id,
              true,
            ),
          });
        },
      ),
  };
}
