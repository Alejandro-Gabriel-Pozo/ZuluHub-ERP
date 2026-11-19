import { writeFileSync } from "node:fs";
import { documentoDeIntegracion } from "../src/capacidades/integracion/documento";
import { CONTEXTOS } from "../src/capacidades/integracion/contextos";
import { OPERACIONES } from "../src/capacidades/integracion/operaciones";

/**
 * Regenera `arquitectura/integracion/operaciones-contextuales.md` desde los registros: `npm run integracion:documento`.
 * `test/arquitectura/operaciones-contextuales.test.ts` falla si el archivo commiteado difiere de lo generado.
 */
writeFileSync(
  new URL("../arquitectura/integracion/operaciones-contextuales.md", import.meta.url),
  documentoDeIntegracion(CONTEXTOS, OPERACIONES),
);
