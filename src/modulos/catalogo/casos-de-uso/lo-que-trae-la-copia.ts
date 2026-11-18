import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { loQueSeCopia } from "../dominio/copia-de-opciones";
import type { GrupoConOpciones } from "../dominio/cotizar";
import type { Producto } from "../dominio/modelo";
import type { LecturasDeCatalogo } from "./contrato";

/**
 * Los grupos que trae «Copiar de otro producto» del origen al destino, leídos en la transacción de quien llama: la copia (que escribe) y la vista previa de la hoja (que solo mira)
 * piden lo mismo por acá, así lo que se ve antes de copiar es exactamente lo que se copia (regla única: `loQueSeCopia`). Solo lee. `puedeTraerLaVariante` (SUPUESTO DEC-0072: con otra
 * forma de venta los precios no valen igual y se deja afuera la variante entera): el destino no tiene variante activa ni precio vigente de la empresa y los dos se venden en la misma
 * unidad y paso (regla del prototipo). Chequeo: `test/integracion/catalogo-casos-de-uso.test.ts` y `test/integracion/opciones-web.test.ts` (la vista previa coincide con la copia).
 */
export async function leerLoQueTraeLaCopia(
  tx: Pick<LecturasDeCatalogo, "opciones" | "precios">,
  empresaId: EmpresaId,
  origen: Producto,
  destino: Producto,
  ahora: Date,
): Promise<readonly GrupoConOpciones[]> {
  const gruposDelOrigen = await tx.opciones.gruposDelProducto(empresaId, origen.id);
  const gruposDelDestino = await tx.opciones.gruposDelProducto(empresaId, destino.id);
  const precioDelDestino = await tx.precios.vigente(empresaId, destino.id, null, null, ahora);
  const destinoTieneVariante = gruposDelDestino.some(
    (g) => g.grupo.clase === "VARIANTE" && g.grupo.activo,
  );
  const mismaForma =
    origen.unidadDeVentaId === destino.unidadDeVentaId && origen.pasoMinimo === destino.pasoMinimo;
  return loQueSeCopia({
    gruposDelOrigen,
    gruposDelDestino,
    puedeTraerLaVariante:
      !destinoTieneVariante &&
      (precioDelDestino === null || precioDelDestino.precio === null) &&
      mismaForma,
  });
}
