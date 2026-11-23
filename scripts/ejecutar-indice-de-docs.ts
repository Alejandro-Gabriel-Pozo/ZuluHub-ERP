import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { ARCHIVO_DEL_INDICE, construirIndiceDeDocs } from "./indice-de-docs.ts";

/**
 * Regenera `arquitectura/grafo/indice-de-docs.json` desde una copia local del repositorio de documentos:
 * `npm run grafo:indice -- <carpeta de docs>`; después `npm run format` (el JSON se commitea con el formato del repositorio).
 * El commit de docs sale de la propia copia (`git rev-parse HEAD`): el índice dice de qué versión de los documentos es foto.
 */
const carpeta = process.argv[2];
if (carpeta === undefined || carpeta === "") {
  process.stderr.write("Uso: npm run grafo:indice -- <carpeta del repositorio de documentos>\n");
  process.exit(2);
}
const commit = execFileSync("git", ["-C", carpeta, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const indice = construirIndiceDeDocs(carpeta, commit);
writeFileSync(
  new URL(`../${ARCHIVO_DEL_INDICE}`, import.meta.url),
  `${JSON.stringify(indice, null, 2)}\n`,
);
process.stdout.write(
  `Índice escrito: ${indice.maquetas.length} maquetas y ${indice.briefs.length} documentos de briefs (docs ${commit.slice(0, 8)}).\n`,
);
