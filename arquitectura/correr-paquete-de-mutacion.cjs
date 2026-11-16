/**
 * Corre los grupos de mutación de UN paquete (ver `empaquetar-mutacion.cjs`), uno tras otro, y NOMBRA cada grupo en lo que se ve.
 *
 *     GRUPOS_DEL_PAQUETE='[{"grupo","archivos","pruebas"}, ...]' node arquitectura/correr-paquete-de-mutacion.cjs
 *
 * Previene: que agrupar grupos oculte cuál falló. Cada grupo corre con su propio `--mutate`, su propio filtro de pruebas y el umbral de 100 % de
 * Stryker (`thresholds.break`), igual que cuando era un job por grupo; si uno falla, los demás igual corren (se ven todas las fallas de una vez) y el job
 * sale con error al final. El log tiene una sección plegable por grupo, el resumen del job una fila por grupo y cada falla es un `::error` con el nombre del
 * grupo. Cualquier dato que no sea de la forma esperada hace fallar el job (denegar por defecto): nunca se saltea un grupo ni se corrige solo.
 * Chequeo que falla si se quita: `test/arquitectura/empaquetar-mutacion.test.ts`.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

/** Lo que Stryker nunca muta (el mismo de `grupos-de-mutacion.cjs`): las pruebas. */
const EXCLUSION_DE_PRUEBAS = "!src/**/*.test.ts";
const LARGO_MAXIMO_DEL_NOMBRE = 200;
/** Rutas y patrones de archivos a mutar, separados por coma (con `!`, `*`, `{}` y un rango de líneas `:1-9`). */
const ARCHIVOS_PERMITIDOS = /^[A-Za-z0-9_./*{}:,!-]+$/;
/** Rutas de pruebas separadas por espacio (puede estar vacío: corre toda la suite unitaria). */
const PRUEBAS_PERMITIDAS = /^[A-Za-z0-9_./ -]*$/;

/** Escapes de los comandos de GitHub Actions: en el texto del mensaje, y en una propiedad (`title=`) donde `:` y `,` también separan. */
const escaparMensaje = (t) =>
  t.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escaparPropiedad = (t) => escaparMensaje(t).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** Los motivos por los que un grupo recibido no sirve (lista vacía si está bien). */
function problemasDelGrupo(grupo) {
  if (grupo === null || typeof grupo !== "object" || Array.isArray(grupo))
    return ["no es un objeto"];
  const problemas = [];
  const { grupo: nombre, archivos, pruebas } = grupo;
  if (
    typeof nombre !== "string" ||
    nombre.trim() === "" ||
    nombre.length > LARGO_MAXIMO_DEL_NOMBRE
  ) {
    problemas.push("el nombre no es un texto de 1 a 200 caracteres");
  }
  if (typeof archivos !== "string" || !ARCHIVOS_PERMITIDOS.test(archivos)) {
    problemas.push("`archivos` no es una lista de patrones permitidos");
  }
  if (typeof pruebas !== "string" || !PRUEBAS_PERMITIDAS.test(pruebas)) {
    problemas.push("`pruebas` no es una lista de rutas permitidas");
  }
  return problemas;
}

/**
 * @param {{
 *   grupos: unknown,
 *   ejecutar: (grupo: { grupo: string, archivos: string, pruebas: string }) => number,
 *   escribir: (texto: string) => void,
 *   ahora?: () => number,
 * }} entrada `ejecutar` devuelve el código de salida de Stryker para ese grupo (0 = el grupo cumple el umbral).
 * @returns {{ resultados: { grupo: string, codigo: number, segundos: number }[], fallaron: string[], resumen: string }}
 */
function correrPaquete({ grupos, ejecutar, escribir, ahora = Date.now }) {
  if (!Array.isArray(grupos) || grupos.length === 0) {
    throw new Error("GRUPOS_DEL_PAQUETE tiene que ser una lista con al menos un grupo.");
  }
  const invalidos = grupos.flatMap((g, i) =>
    problemasDelGrupo(g).map((p) => `grupo ${i + 1}: ${p}`),
  );
  if (invalidos.length > 0)
    throw new Error(`GRUPOS_DEL_PAQUETE inválido:\n${invalidos.join("\n")}`);

  const resultados = [];
  for (const grupo of grupos) {
    escribir(`::group::Mutación · ${grupo.grupo}\n`);
    const inicio = ahora();
    let codigo;
    try {
      codigo = ejecutar(grupo);
    } catch (error) {
      escribir(`${error instanceof Error ? error.message : String(error)}\n`);
      codigo = 1;
    }
    escribir("::endgroup::\n");
    const segundos = Math.round((ahora() - inicio) / 1000);
    resultados.push({ grupo: grupo.grupo, codigo, segundos });
    if (codigo !== 0) {
      const titulo = escaparPropiedad(`Mutación · ${grupo.grupo}`);
      const texto = escaparMensaje(
        `El grupo «${grupo.grupo}» no cumplió el umbral de mutación (Stryker salió con código ${codigo}).`,
      );
      escribir(`::error title=${titulo}::${texto}\n`);
    }
  }
  const fallaron = resultados.filter((r) => r.codigo !== 0).map((r) => r.grupo);
  const resumen = [
    `### Mutación: ${resultados.length} grupo(s) en este job`,
    "",
    "| Grupo | Resultado | Segundos |",
    "|---|---|---|",
    ...resultados.map(
      (r) =>
        `| ${r.grupo} | ${r.codigo === 0 ? "cumple" : `FALLA (código ${r.codigo})`} | ${r.segundos} |`,
    ),
    "",
  ].join("\n");
  return { resultados, fallaron, resumen };
}

/** El comando de Stryker de un grupo: argumentos (no texto de un shell) y el filtro de pruebas que corre cada mutante (vacío = toda la suite unitaria). */
function comandoDeStryker(grupo, entorno) {
  return {
    argumentos: ["stryker", "run", "--mutate", `${grupo.archivos},${EXCLUSION_DE_PRUEBAS}`],
    entorno: { ...entorno, PEDERNAL_FILTRO_PRUEBAS: grupo.pruebas },
  };
}

/** Corre Stryker de verdad para un grupo: sin shell (los datos van como argumentos, no como texto de un comando). */
function ejecutarStryker(grupo) {
  const { argumentos, entorno } = comandoDeStryker(grupo, process.env);
  const resultado = spawnSync("npx", argumentos, { stdio: "inherit", env: entorno });
  return resultado.status ?? 1;
}

function principal() {
  let grupos;
  try {
    grupos = JSON.parse(process.env["GRUPOS_DEL_PAQUETE"] ?? "");
  } catch {
    process.stderr.write("GRUPOS_DEL_PAQUETE falta o no es JSON.\n");
    process.exit(2);
  }
  const { fallaron, resumen } = correrPaquete({
    grupos,
    ejecutar: ejecutarStryker,
    escribir: (texto) => process.stdout.write(texto),
  });
  const archivoDeResumen = process.env["GITHUB_STEP_SUMMARY"];
  if (archivoDeResumen !== undefined && archivoDeResumen !== "") {
    fs.appendFileSync(archivoDeResumen, resumen);
  }
  if (fallaron.length > 0) {
    process.stderr.write(`Fallaron ${fallaron.length} grupo(s): ${fallaron.join("; ")}\n`);
    process.exit(1);
  }
}

module.exports = { correrPaquete, problemasDelGrupo, escaparPropiedad, comandoDeStryker };

if (require.main === module) principal();
