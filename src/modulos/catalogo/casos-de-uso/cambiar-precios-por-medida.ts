import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { revisarLosCambiosDePrecios } from "../dominio/pedido-de-precios-por-medida";
import { aplicarCambioDePrecio, type SalidaDeCambiarPrecio } from "./cambiar-precio";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCambiarPreciosPorMedida = Readonly<{
  productoId: string;
  /** Los cambios de precio de la EMPRESA de cada medida que la persona tocó. Cada `precioId` es la clave de idempotencia de SU cambio (lo manda la aplicación). */
  cambios: ReadonlyArray<
    Readonly<{
      precioId: string;
      opcionId: string;
      /** La fila vigente de la empresa para esa medida según quien pide (`null` si no tenía). */
      precioIdEsperado: string | null;
      /** Texto decimal exacto, ARS con IVA incluido. */
      precio: string;
    }>
  >;
}>;

export type SalidaDeCambiarPreciosPorMedida = Readonly<{
  cambios: readonly SalidaDeCambiarPrecio[];
  /** `true` si TODOS los cambios ya estaban aplicados (reintento o doble toque): no se escribió nada. */
  yaExistia: boolean;
}>;

/**
 * Cambiar el precio de la empresa de VARIAS medidas de un producto, todo o nada (la lista de precios de las medidas no puede quedar a medias). Guard
 * `productos.cambiar_precio`. UNA transacción: bloquea el producto (`FOR UPDATE`, así dos guardados a la vez se serializan: gana uno y el otro ve
 * `PRECIO_DESACTUALIZADO` sin escribir nada) y aplica cada cambio con las MISMAS reglas y el mismo control de versión por medida (`precioIdEsperado`) que
 * `cambiarPrecio` (`aplicarCambioDePrecio`), cada uno con su auditoría `PRECIO_CAMBIADO` en la misma transacción. El primer error revierte todo y es el que
 * vuelve. Una medida repetida en el pedido, o un `precioId` repetido, se rechaza antes de escribir. Repetición: el mismo pedido por segunda vez (mismos
 * `precioId`) deja todos en `yaExistia` y no escribe, aunque la versión esperada ya sea vieja. Sin cambios no hace nada.
 */
export function armarCambiarPreciosPorMedida(dependencias: DependenciasDeCatalogo) {
  return async function cambiarPreciosPorMedida(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarPreciosPorMedida,
  ): Promise<R<SalidaDeCambiarPreciosPorMedida>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarPreciosPorMedida>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "productos.cambiar_precio",
        ]);
        if (!permiso.ok) return permiso;
        const forma = revisarLosCambiosDePrecios(entrada.cambios);
        if (forma !== null) return err(forma);
        const salidas: SalidaDeCambiarPrecio[] = [];
        for (const cambio of entrada.cambios) {
          const aplicado = await aplicarCambioDePrecio(tx, contexto, {
            precioId: cambio.precioId,
            productoId: entrada.productoId,
            opcionId: cambio.opcionId,
            sucursalId: null,
            precioIdEsperado: cambio.precioIdEsperado,
            precio: cambio.precio,
          });
          if (!aplicado.ok) return aplicado;
          salidas.push(aplicado.valor);
        }
        return ok({ cambios: salidas, yaExistia: salidas.every((s) => s.yaExistia) });
      },
    );
    return traducir(resultado);
  };
}
