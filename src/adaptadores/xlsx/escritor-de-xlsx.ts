import writeXlsxFile from "write-excel-file/node";
import type { HojaDePlanilla } from "../../primitivas/planilla/celda";
import type { EscritorDePlanilla } from "../../puertos/escritor-de-planilla";
import { celdaDeLaBiblioteca, textoInofensivo } from "./celdas-de-xlsx";

/**
 * El escritor de planillas `.xlsx` (puerto `EscritorDePlanilla`): el ÚNICO archivo que conoce `write-excel-file` (4.1.1, aprobada por el dueño el 25/11/2026; regla de arquitectura
 * `xlsx-solo-en-su-adaptador`). Cada hoja lleva sus encabezados en negrita y fijos arriba; las celdas pasan por `celdaDeLaBiblioteca` (números solo si son exactos, textos sin fórmulas,
 * fechas sin corrimiento). Una celda vacía queda vacía. No lee el reloj ni el disco y no hace red: el archivo se arma en memoria. Dos corridas con el mismo contenido dan las mismas
 * celdas (los bytes del zip llevan la hora de armado, así que lo que se compara es el contenido).
 * Previene: dinero escrito inexacto, fórmulas inyectadas desde datos de proveedores y días corridos por la zona horaria.
 */
export function crearEscritorDeXlsx(): EscritorDePlanilla {
  return {
    async escribir(hojas: readonly HojaDePlanilla[]): Promise<Uint8Array> {
      const archivo = await writeXlsxFile(
        hojas.map((hoja) => ({
          sheet: hoja.nombre,
          stickyRowsCount: 1,
          data: [
            hoja.encabezados.map((e) => ({
              value: textoInofensivo(e),
              type: String,
              fontWeight: "bold" as const,
            })),
            ...hoja.filas.map((fila) => fila.map((c) => celdaDeLaBiblioteca(c))),
          ],
        })),
      ).toBuffer();
      return new Uint8Array(archivo.buffer, archivo.byteOffset, archivo.byteLength);
    },
  };
}
