import { huellaDeComando, type CampoDeHuella, type RenglonDeHuella } from "../../stock/publico";

/**
 * La huella de los comandos de producción: la misma función de stock (`huellaDeComando`), con el nombre de la operación. Una regla, un
 * lugar: cada comando arma SU contenido canónico acá, sin `hechoEn` que no mandó la persona.
 */
export const huellaDeCerrarOrden = (
  ordenId: string,
  obtenido: string,
  unidadId: string,
  vence: string | null,
  consumos: readonly RenglonDeHuella[],
): string =>
  huellaDeComando("produccion.cerrar_orden", [ordenId, obtenido, unidadId, vence], consumos);

/** La del movimiento del PRODUCTO de un cierre (el consumo lleva la del cierre entero): otra clave, otro contenido. */
export const huellaDelProductoDeLaOrden = (
  ordenId: string,
  obtenido: string,
  unidadId: string,
  vence: string | null,
): string =>
  huellaDeComando("produccion.producto_de_la_orden", [ordenId, obtenido, unidadId, vence], []);

export const huellaDeAnularOrden = (ordenId: string, motivo: string): string =>
  huellaDeComando("produccion.anular_orden", [ordenId, motivo], []);

export const huellaDeCancelarOrden = (ordenId: string, motivo: string): string =>
  huellaDeComando("produccion.cancelar_orden", [ordenId, motivo], []);

export const huellaDeAbrirOrden = (
  ordenId: string,
  productoId: string,
  cantidad: string,
  unidadId: string,
  depositoId: string,
  depositoDestinoId: string,
): string =>
  huellaDeComando(
    "produccion.abrir_orden",
    [
      ordenId,
      productoId,
      cantidad,
      unidadId,
      depositoId,
      depositoDestinoId,
    ] satisfies CampoDeHuella[],
    [],
  );
