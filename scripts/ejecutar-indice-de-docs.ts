import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { ARCHIVO_DEL_INDICE, construirIndiceDeDocs, type RamaDeDocs } from "./indice-de-docs.ts";

/**
 * Regenera `arquitectura/grafo/indice-de-docs.json` desde una copia local del repositorio de documentos:
 * `npm run grafo:indice -- <carpeta de docs> [--rama=<nombre>@<commit>=<carpeta de un árbol de esa rama>…]`; después `npm run format` (el JSON se commitea con el formato del repositorio).
 * El commit de docs sale de la propia copia (`git rev-parse HEAD`): el índice dice de qué versión de los documentos es foto.
 */
const [carpeta, ...opciones] = process.argv.slice(2);
if (carpeta === undefined || carpeta === "") {
  process.stderr.write("Uso: npm run grafo:indice -- <carpeta del repositorio de documentos>\n");
  process.exit(2);
}
const commit = execFileSync("git", ["-C", carpeta, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const ramas: RamaDeDocs[] = opciones.map((o) => {
  const m = /^--rama=([\w./-]+)@([0-9a-f]{7,40})=(.+)$/.exec(o);
  if (m === null) {
    process.stderr.write(`Opción desconocida: ${o}. Forma: --rama=<nombre>@<commit>=<carpeta>\n`);
    process.exit(2);
  }
  return { nombre: m[1] ?? "", commit: m[2] ?? "", carpeta: m[3] ?? "" };
});
const indice = construirIndiceDeDocs(carpeta, commit, ramas);
writeFileSync(
  new URL(`../${ARCHIVO_DEL_INDICE}`, import.meta.url),
  `${JSON.stringify(indice, null, 2)}\n`,
);
process.stdout.write(
  `Índice escrito: ${indice.maquetas.length} maquetas y ${indice.briefs.length} documentos de briefs (docs ${commit.slice(0, 8)}).\n`,
);
