import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { alicuotaDelCosto, costoDeLaLinea } from "./correcciones";

type R<S> = Resultado<S, ErrorDeCompras>;

/**
 * La oferta del proveedor tras anular una compra (D11b, 0058). Por cada producto y presentación de la compra anulada cuya oferta tenía a ESTA compra como la última: se toma la oferta con
 * `FOR UPDATE` (dos anulaciones, una corrección o una compra del mismo proveedor y producto se ponen en fila: el resultado no depende del orden, porque quien llega segundo ve lo que
 * el primero confirmó), y se rehace con la última compra NO anulada de ese proveedor (con su última corrección: la misma cuenta de `corregirCompra`); si no queda ninguna, la oferta queda NO
 * vigente (no se borra) y la ficha no la muestra. Se llama DESPUÉS de marcar anulada la recepción, en la misma transacción. Una oferta que apunta a otra compra no se toca.
 */
export async function rehacerOfertasDeLaCompraAnulada(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  anulada: Readonly<{ id: string; proveedorId: string }>,
  lineas: readonly LineaDeRecepcion[],
): Promise<R<Readonly<{ rehechas: number; noVigentes: number }>>> {
  const { empresaId } = contexto;
  const vistos = new Set<string>();
  let rehechas = 0;
  let noVigentes = 0;
  for (const l of lineas) {
    if (l.precio === null || l.costoPorUnidadDeStock === null) continue;
    const clave = {
      proveedorId: anulada.proveedorId,
      productoId: l.productoId,
      presentacionId: l.presentacionId,
    };
    const id = `${clave.productoId}|${clave.presentacionId ?? ""}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const oferta = await tx.ofertasDeProveedor.bloquear(empresaId, clave);
    if (oferta === null || oferta.ultimaCompraId !== anulada.id) continue;

    const anterior = await tx.recepciones.ultimaLineaVigenteDe(empresaId, clave);
    if (anterior === null) {
      await tx.ofertasDeProveedor.marcarNoVigente(empresaId, clave);
      noVigentes += 1;
      continue;
    }
    const lineasAnteriores = await tx.recepciones.lineasDe(empresaId, anterior.recepcionId);
    const linea = lineasAnteriores.find((x) => x.numero === anterior.numero);
    if (linea === undefined || linea.precio === null || linea.costoPorUnidadDeStock === null) {
      throw new Error("la línea de la compra anterior no existe o no tiene precio");
    }
    const ultima = await tx.correccionesDeCompra.ultimaDeLaLinea(
      empresaId,
      anterior.recepcionId,
      linea.numero,
    );
    const precioGuardado: string = linea.precio;
    const costoGuardado: string = linea.costoPorUnidadDeStock;
    let precio = precioGuardado;
    let costo = costoGuardado;
    if (ultima !== null) {
      precio = ultima.precioNuevo ?? precioGuardado;
      const alicuota = await alicuotaDelCosto(
        tx,
        contexto,
        dependencias,
        anterior.recepcionId,
        linea.numero,
      );
      if (!alicuota.ok) return alicuota;
      const recalculado = await costoDeLaLinea(tx, contexto, linea, precio, alicuota.valor);
      if (!recalculado.ok) return recalculado;
      costo = recalculado.valor;
    }
    await tx.ofertasDeProveedor.reemplazar(empresaId, {
      ...clave,
      precioPorTipo: linea.precioPorTipo as "PRESENTACION" | "UNIDAD",
      unidadDePrecioId: linea.unidadDePrecioId,
      ultimoPrecio: precio,
      ultimoCostoPorUnidadDeStock: costo,
      ultimaCompraId: anterior.recepcionId,
      ultimaCompraEn: anterior.hechoEn,
    });
    rehechas += 1;
  }
  return ok({ rehechas, noVigentes });
}
