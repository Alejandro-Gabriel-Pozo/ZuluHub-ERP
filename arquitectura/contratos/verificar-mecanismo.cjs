/**
 * Verificadores PUROS del mecanismo que hace obligatorio al guardián (contratos-arquitectonicos.md
 * §4, invariantes I9 e I10 y meta-invariante M4).
 *
 * Cada función recibe TEXTO (el `package.json`, el `ci.yml`, el `vitest.config.ts`, los archivos de
 * prueba del guardián, el informe) y devuelve una lista de problemas con la forma de una falla del
 * guardián: `{ codigo, archivo, linea, motivo, correccion }`. Lista vacía = el mecanismo está intacto.
 * No leen el disco ni la red ni el reloj: la matriz de invariantes les pasa el texto real del repo o
 * una copia alterada en memoria, y exige que las copias alteradas FALLEN.
 *
 * Límite: son comprobaciones de texto. Miran lo que está escrito en el repositorio, no la
 * configuración de GitHub (la protección de `main` vive fuera del repo; la vigila G4).
 */
const { CODIGOS_DE_FALLA } = require("./codigos.cjs");

/** Códigos con los que estos verificadores fallan (distintos de los del guardián). Lista cerrada. */
const CODIGOS_DE_MECANISMO = Object.freeze([
  "package-json-ilegible",
  "script-arquitectura-sin-guardian",
  "script-guardian-debilitado",
  "script-gate-sin-arquitectura",
  "script-test-sin-proyecto-node",
  "ci-sin-job-gate",
  "ci-gate-sin-always",
  "ci-guardian-no-corre",
  "ci-pruebas-no-corren",
  "ci-job-fuera-del-gate",
  "ci-job-sin-tope",
  "ci-continue-on-error",
  "ci-job-desactivado",
  "ci-job-condicionado",
  "ci-disparador-incompleto",
  "ci-comando-tolerante",
  "vitest-excluye-pruebas",
  "vitest-sin-pruebas-del-guardian",
  "vitest-sin-proyecto-node",
  "prueba-saltada",
  "pruebas-del-guardian-borradas",
  "informe-sin-evidencia",
  "canario-pasa-un-repo-roto",
  "canario-sin-diagnostico",
  "matriz-invariante-mal-formado",
  "matriz-invariante-ausente",
  "matriz-mutacion-mal-formada",
  "matriz-codigo-desconocido",
  "matriz-codigo-sin-invariante",
  "matriz-codigo-sin-mutacion",
  "matriz-invariante-sin-tipos",
  "matriz-noaplica-sin-motivo",
  "matriz-id-repetido",
  "matriz-mutacion-sin-aplicador",
  "matriz-aplicador-huerfano",
]);

const ARCHIVO_DE_PACKAGE_JSON = "package.json";
const ARCHIVO_DE_CI = ".github/workflows/ci.yml";
const ARCHIVO_DE_VITEST = "vitest.config.ts";
const ARCHIVO_DEL_INFORME = "arquitectura/contratos/informe.json";
const CARPETA_DE_PRUEBAS = "test/arquitectura";

/** Las pruebas del guardián que tienen que existir. Borrar una hace fallar el mecanismo. */
const PRUEBAS_DEL_GUARDIAN = Object.freeze([
  "guardian-clasificacion.test.ts",
  "guardian-declaraciones.test.ts",
  "guardian-diagnostico.test.ts",
  "guardian-excepciones.test.ts",
  "guardian-matriz.test.ts",
  "guardian-nucleo.test.ts",
  "guardian-registro.test.ts",
]);

/**
 * Los ÚNICOS saltos que admiten las pruebas del guardián: las pruebas que miran «el repositorio real»
 * se saltean cuando no hay `.git` (el sandbox de Stryker es una copia sin `.git`). Cada entrada es la
 * línea exacta (sin espacios en los extremos) y, si depende de una constante, la línea que la define:
 * si la constante cambia (p. ej. `SIN_GIT = true`) el salto deja de estar permitido.
 */
const SALTOS_PERMITIDOS = Object.freeze([
  Object.freeze({
    archivo: "guardian-nucleo.test.ts",
    linea: "const describeConGit = describe.skipIf(SIN_GIT);",
    requiere: "const SIN_GIT = !HAY_GIT;",
  }),
  Object.freeze({
    archivo: "guardian-nucleo.test.ts",
    linea: "const itConGit = it.skipIf(SIN_GIT);",
    requiere: "const SIN_GIT = !HAY_GIT;",
  }),
  Object.freeze({
    archivo: "guardian-clasificacion.test.ts",
    linea: "const describeConGit = describe.skipIf(!HAY_GIT);",
    requiere: null,
  }),
]);

/** Saltar, dejar pendiente, correr solo algunas o condicionar una prueba (vitest y alias de jest). */
const PATRON_DE_SALTO =
  /\b(?:describe|it|test|suite)(?:\.[A-Za-z]+)*\.(?:skip|todo|only|skipIf|runIf|fails)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|\b(?:ctx|context|task)\.skip\s*\(/;

/** Un problema con la forma de una falla del guardián. */
const problema = (codigo, archivo, linea, motivo, correccion) => ({
  codigo,
  archivo,
  linea,
  motivo,
  correccion,
});

/** La última línea (desde 1) que declara la clave JSON; 1 si no está. La última gana en `JSON.parse`. */
function lineaDeClaveJson(texto, clave) {
  const lineas = texto.split(/\r\n|\n/);
  for (let i = lineas.length - 1; i >= 0; i -= 1) {
    if (lineas[i].trimStart().startsWith(`"${clave}"`)) return i + 1;
  }
  return 1;
}

/** La primera línea (desde 1) que contiene el texto; 1 si no está. */
function primeraLineaCon(texto, buscado) {
  const indice = texto.split(/\r\n|\n/).findIndex((linea) => linea.includes(buscado));
  return indice === -1 ? 1 : indice + 1;
}

/**
 * `package.json`: el guardián tiene que correr en `npm run arquitectura` (y por lo tanto en
 * `npm run gate`) y bloquear si falla; y `npm test` tiene que correr el proyecto de Node de Vitest,
 * donde viven las pruebas del guardián y la matriz.
 *
 * @param {string} textoPackageJson
 */
function verificarScriptsDeArquitectura(textoPackageJson) {
  let datos;
  try {
    datos = JSON.parse(textoPackageJson);
  } catch {
    return [
      problema(
        "package-json-ilegible",
        ARCHIVO_DE_PACKAGE_JSON,
        1,
        "El package.json no es JSON válido: no se puede comprobar que el guardián corra.",
        "Dejá el package.json como JSON válido.",
      ),
    ];
  }
  const scripts = datos?.scripts ?? {};
  const problemas = [];
  const linea = (clave) => lineaDeClaveJson(textoPackageJson, clave);
  const comandos = (texto) =>
    typeof texto === "string" ? texto.split("&&").map((c) => c.trim()) : [];
  const tolerante = (texto) => /\|\||;|\|/.test(texto);

  const arquitectura = scripts["arquitectura"];
  if (!comandos(arquitectura).includes("npm run guardian") || tolerante(arquitectura ?? "")) {
    problemas.push(
      problema(
        "script-arquitectura-sin-guardian",
        ARCHIVO_DE_PACKAGE_JSON,
        linea("arquitectura"),
        "El script «arquitectura» no encadena «&& npm run guardian» (o lo encadena con «||», «;» o «|»): el guardián no bloquearía.",
        "Dejá el script como «depcruise … && npm run guardian».",
      ),
    );
  }
  const guardian = scripts["guardian"];
  if (guardian !== "node arquitectura/contratos/guardian.cjs") {
    problemas.push(
      problema(
        "script-guardian-debilitado",
        ARCHIVO_DE_PACKAGE_JSON,
        linea("guardian"),
        "El script «guardian» no es exactamente «node arquitectura/contratos/guardian.cjs»: puede no correr el guardián o no propagar su salida.",
        "Dejá el script en «node arquitectura/contratos/guardian.cjs», sin «|| true» ni otro comando.",
      ),
    );
  }
  const gate = scripts["gate"];
  if (!comandos(gate).includes("npm run arquitectura") || !comandos(gate).includes("npm test")) {
    problemas.push(
      problema(
        "script-gate-sin-arquitectura",
        ARCHIVO_DE_PACKAGE_JSON,
        linea("gate"),
        "El script «gate» no encadena «npm run arquitectura» y «npm test»: el control local no incluiría al guardián ni a sus pruebas.",
        "Volvé a encadenar «npm run arquitectura» y «npm test» en el gate.",
      ),
    );
  }
  const prueba = scripts["test"];
  if (typeof prueba !== "string" || !/vitest run\b.*--project node\b/.test(prueba)) {
    problemas.push(
      problema(
        "script-test-sin-proyecto-node",
        ARCHIVO_DE_PACKAGE_JSON,
        linea("test"),
        "El script «test» no corre «vitest run --project node»: las pruebas del guardián y la matriz viven en ese proyecto.",
        "Dejá «vitest run --project node».",
      ),
    );
  }
  return problemas;
}

/** Divide el `ci.yml` en trabajos (`jobs:` y sus claves de segundo nivel). */
function trabajosDe(lineas) {
  const inicio = lineas.findIndex((linea) => /^jobs:\s*(?:#.*)?$/.test(linea));
  const trabajos = new Map();
  if (inicio === -1) return { inicio, trabajos };
  const claves = [];
  let fin = lineas.length;
  for (let i = inicio + 1; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (/^\S/.test(linea) && !linea.startsWith("#")) {
      fin = i;
      break;
    }
    const clave = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(linea);
    if (clave !== null) claves.push({ nombre: clave[1], desde: i });
  }
  claves.forEach(({ nombre, desde }, posicion) => {
    const hasta = posicion + 1 < claves.length ? claves[posicion + 1].desde : fin;
    trabajos.set(nombre, { nombre, desde, lineas: lineas.slice(desde, hasta) });
  });
  return { inicio, trabajos };
}

const sinComentario = (linea) => linea.replace(/\s+#.*$/, "");
const esComentario = (linea) => linea.trimStart().startsWith("#");

const CORRE_EL_GUARDIAN = /npm run (?:arquitectura|guardian|gate)\b|guardian\.cjs/;
const CORRE_LAS_PRUEBAS = /npm test\b|npm run gate\b|vitest run --project node\b/;
const COMANDO_TOLERANTE =
  /(?:npm run (?:arquitectura|guardian|gate)\b|npm test\b|guardian\.cjs).*(?:\|\|\s*(?:true|exit\s+0|:)\b|;\s*true\b)/;
const CONDICION_FALSA = /^(?:\$\{\{\s*)?(?:false|0|''|"")(?:\s*\}\})?$/;

/** Los nombres de trabajo que lista `needs:` del Gate (lista en línea, en varias líneas o con guiones). */
function necesidadesDe(trabajo) {
  const indice = trabajo.lineas.findIndex((linea) => /^ {4}needs:/.test(linea));
  if (indice === -1) return { indice: -1, nombres: new Set() };
  const partes = [sinComentario(trabajo.lineas[indice]).replace(/^ {4}needs:/, "")];
  for (let i = indice + 1; i < trabajo.lineas.length; i += 1) {
    const linea = trabajo.lineas[i];
    const sangria = /^ */.exec(linea)[0].length;
    if (linea.trim() === "" || sangria > 4 || (sangria === 4 && linea.trim().startsWith("-"))) {
      partes.push(sinComentario(linea));
    } else {
      break;
    }
  }
  const nombres = new Set(partes.join(" ").match(/[A-Za-z0-9_-]+/g) ?? []);
  return { indice, nombres };
}

/** Los disparadores (`on:`): hay `pull_request` y no lo filtran rutas ni ramas (tiene que correr en toda ruta). */
function verificarDisparadores(lineas) {
  const inicio = lineas.findIndex((linea) => /^on:\s*(?:#.*)?$/.test(linea));
  const falta = (linea, motivo) =>
    problema(
      "ci-disparador-incompleto",
      ARCHIVO_DE_CI,
      linea,
      motivo,
      "El workflow tiene que correr en todo pull request, sin filtros de rutas ni de ramas.",
    );
  if (inicio === -1) {
    return [falta(1, "El workflow no declara sus disparadores (`on:`): el Gate no correría.")];
  }
  let fin = lineas.length;
  for (let i = inicio + 1; i < lineas.length; i += 1) {
    if (/^\S/.test(lineas[i]) && !lineas[i].startsWith("#")) {
      fin = i;
      break;
    }
  }
  const bloque = lineas.slice(inicio, fin);
  const posicion = bloque.findIndex((linea) => /^ {2}pull_request\s*:/.test(linea));
  if (posicion === -1) {
    return [
      falta(
        inicio + 1,
        "El workflow no corre en `pull_request`: un cambio podría integrarse sin pasar por el Gate.",
      ),
    ];
  }
  const problemas = [];
  for (let i = posicion + 1; i < bloque.length; i += 1) {
    if (/^ {2}\S/.test(bloque[i])) break;
    if (/^ {4}(?:paths|paths-ignore|branches|branches-ignore)\s*:/.test(bloque[i])) {
      problemas.push(
        falta(
          inicio + i + 1,
          `El disparador \`pull_request\` filtra con «${bloque[i].trim()}»: hay cambios que no pasarían por el Gate.`,
        ),
      );
    }
  }
  return problemas;
}

/**
 * `ci.yml`: el guardián y las pruebas corren en trabajos que el Gate exige, sin tolerancia a fallas.
 * Un trabajo «obligatorio» es el que corre el guardián (`npm run arquitectura|guardian|gate`,
 * `guardian.cjs`) o las pruebas de Node (`npm test`). Cada uno tiene que estar en `needs` del Gate,
 * tener tope de tiempo y no llevar `continue-on-error`, condiciones siempre falsas ni comandos que
 * terminen en `|| true`. El Gate tiene que correr siempre (`if: always()`): un Gate saltado cuenta
 * como aprobado para GitHub.
 *
 * @param {string} textoCi
 */
function verificarWorkflowDeCi(textoCi) {
  const lineas = textoCi.split(/\r\n|\n/);
  const { inicio, trabajos } = trabajosDe(lineas);
  const problemas = [];
  const lineaDeJobs = inicio === -1 ? 1 : inicio + 1;
  const gate = trabajos.get("gate");
  if (gate === undefined) {
    return [
      problema(
        "ci-sin-job-gate",
        ARCHIVO_DE_CI,
        lineaDeJobs,
        "El workflow no tiene un trabajo «gate»: nada exige que el guardián y las pruebas hayan pasado.",
        "Restituí el trabajo «gate» con `needs` de todos los trabajos obligatorios.",
      ),
    ];
  }
  const { indice: indiceDeNeeds, nombres: necesidades } = necesidadesDe(gate);
  const lineaDeNeeds = indiceDeNeeds === -1 ? gate.desde + 1 : gate.desde + indiceDeNeeds + 1;
  if (!gate.lineas.some((linea) => /^ {4}if:.*always\(\)/.test(linea))) {
    problemas.push(
      problema(
        "ci-gate-sin-always",
        ARCHIVO_DE_CI,
        gate.desde + 1,
        "El trabajo «gate» no tiene `if: always()`: si un trabajo falla, el Gate se saltea y GitHub lo cuenta como aprobado.",
        "Volvé a poner `if: always()` en el trabajo «gate».",
      ),
    );
  }
  problemas.push(...verificarDisparadores(lineas));
  const obligatorios = [];
  let hayGuardian = false;
  let hayPruebas = false;
  for (const trabajo of trabajos.values()) {
    if (trabajo.nombre === "gate") continue;
    const cuerpo = trabajo.lineas.filter((linea) => !esComentario(linea)).join("\n");
    const guardian = CORRE_EL_GUARDIAN.test(cuerpo);
    const pruebas = CORRE_LAS_PRUEBAS.test(cuerpo);
    hayGuardian ||= guardian;
    hayPruebas ||= pruebas;
    if (guardian || pruebas) obligatorios.push(trabajo);
  }
  if (!hayGuardian) {
    problemas.push(
      problema(
        "ci-guardian-no-corre",
        ARCHIVO_DE_CI,
        lineaDeJobs,
        "Ningún trabajo del workflow corre el guardián (`npm run arquitectura`, `npm run guardian` o `guardian.cjs`).",
        "Volvé a correr el guardián en un trabajo que el Gate exija.",
      ),
    );
  }
  if (!hayPruebas) {
    problemas.push(
      problema(
        "ci-pruebas-no-corren",
        ARCHIVO_DE_CI,
        lineaDeJobs,
        "Ningún trabajo del workflow corre `npm test`: la matriz y las pruebas del guardián no se ejecutan.",
        "Volvé a correr `npm test` en un trabajo que el Gate exija.",
      ),
    );
  }
  for (const trabajo of [...obligatorios, gate]) {
    const esGate = trabajo.nombre === "gate";
    if (!esGate && !necesidades.has(trabajo.nombre)) {
      problemas.push(
        problema(
          "ci-job-fuera-del-gate",
          ARCHIVO_DE_CI,
          lineaDeNeeds,
          `El trabajo «${trabajo.nombre}» corre el guardián o las pruebas y no está en \`needs\` del Gate: puede fallar sin bloquear.`,
          `Agregá «${trabajo.nombre}» a \`needs\` del trabajo «gate».`,
        ),
      );
    }
    if (!esGate && !trabajo.lineas.some((linea) => /^ {4}timeout-minutes:/.test(linea))) {
      problemas.push(
        problema(
          "ci-job-sin-tope",
          ARCHIVO_DE_CI,
          trabajo.desde + 1,
          `El trabajo «${trabajo.nombre}» no tiene \`timeout-minutes\`: un cuelgue lo dejaría corriendo sin límite.`,
          "Agregá `timeout-minutes` al trabajo.",
        ),
      );
    }
    trabajo.lineas.forEach((linea, posicion) => {
      if (esComentario(linea)) return;
      const absoluta = trabajo.desde + posicion + 1;
      const tolera = /^\s*continue-on-error:\s*(.*)$/.exec(sinComentario(linea));
      if (tolera !== null && tolera[1].trim() !== "false") {
        problemas.push(
          problema(
            "ci-continue-on-error",
            ARCHIVO_DE_CI,
            absoluta,
            `El trabajo «${trabajo.nombre}» usa \`continue-on-error\`: una falla no bloquearía.`,
            "Sacá `continue-on-error`.",
          ),
        );
      }
      const condicion = /^\s*(?:- )?if:\s*(.*)$/.exec(sinComentario(linea));
      if (condicion !== null && CONDICION_FALSA.test(condicion[1].trim())) {
        problemas.push(
          problema(
            "ci-job-desactivado",
            ARCHIVO_DE_CI,
            absoluta,
            `El trabajo «${trabajo.nombre}» tiene una condición siempre falsa (\`if: ${condicion[1].trim()}\`): nunca corre.`,
            "Sacá la condición o ponela en una expresión que dependa del evento.",
          ),
        );
      } else if (condicion !== null && !esGate && /^ {4}if:/.test(linea)) {
        problemas.push(
          problema(
            "ci-job-condicionado",
            ARCHIVO_DE_CI,
            absoluta,
            `El trabajo «${trabajo.nombre}» corre el guardián o las pruebas solo bajo una condición (\`if: ${condicion[1].trim()}\`): tiene que correr en todo evento relevante.`,
            "Sacá la condición del trabajo (si algo no aplica, que lo decida el paso, no el trabajo entero).",
          ),
        );
      }
      if (COMANDO_TOLERANTE.test(sinComentario(linea))) {
        problemas.push(
          problema(
            "ci-comando-tolerante",
            ARCHIVO_DE_CI,
            absoluta,
            `El trabajo «${trabajo.nombre}» corre el guardián o las pruebas con \`|| true\` (o similar): el comando nunca falla.`,
            "Sacá el `|| true`: el comando tiene que propagar su salida.",
          ),
        );
      }
    });
  }
  return problemas;
}

/**
 * `vitest.config.ts`: las pruebas del guardián (`test/arquitectura/guardian-*.test.ts`) tienen que
 * entrar en el proyecto de Node y no puede haber filtros que las saquen.
 *
 * @param {string} textoVitest
 */
function verificarVitestConfig(textoVitest) {
  const lineas = textoVitest.split(/\r\n|\n/);
  const problemas = [];
  lineas.forEach((linea, posicion) => {
    const sinComentarios = linea.replace(/\/\/.*$/, "");
    if (/^\s*(?:exclude|testNamePattern|dir|root)\s*:/.test(sinComentarios)) {
      problemas.push(
        problema(
          "vitest-excluye-pruebas",
          ARCHIVO_DE_VITEST,
          posicion + 1,
          `La configuración de Vitest usa «${sinComentarios.trim()}»: puede sacar de la corrida a las pruebas del guardián o a la matriz.`,
          "Sacá el filtro: las pruebas de test/arquitectura/guardian-* corren siempre.",
        ),
      );
    }
    if (/^\s*passWithNoTests\s*:\s*true/.test(sinComentarios)) {
      problemas.push(
        problema(
          "vitest-excluye-pruebas",
          ARCHIVO_DE_VITEST,
          posicion + 1,
          "`passWithNoTests: true` deja pasar una corrida sin pruebas: «pasó» no significaría que se probó algo.",
          "Sacá `passWithNoTests`.",
        ),
      );
    }
  });
  if (!/name:\s*"node"/.test(textoVitest)) {
    problemas.push(
      problema(
        "vitest-sin-proyecto-node",
        ARCHIVO_DE_VITEST,
        primeraLineaCon(textoVitest, "projects:"),
        'Vitest ya no tiene un proyecto llamado "node": `npm test` (`--project node`) no correría las pruebas del guardián.',
        'Dejá el proyecto de Node con `name: "node"`.',
      ),
    );
  }
  if (!/include:\s*\[[^\]]*"test\/\*\*\/\*\.test\.ts"[^\]]*\]/.test(textoVitest)) {
    problemas.push(
      problema(
        "vitest-sin-pruebas-del-guardian",
        ARCHIVO_DE_VITEST,
        primeraLineaCon(textoVitest, "include:"),
        'El proyecto de Node de Vitest ya no incluye "test/**/*.test.ts": las pruebas del guardián y la matriz no correrían.',
        'Volvé a incluir "test/**/*.test.ts" en el proyecto «node».',
      ),
    );
  }
  return problemas;
}

/**
 * Pruebas del guardián: ninguna saltada, pendiente, exclusiva ni condicionada (salvo los saltos por
 * falta de `.git` listados en `SALTOS_PERMITIDOS`) y ninguna borrada.
 *
 * @param {Record<string, string>} archivos nombre de archivo (sin carpeta) → texto, de
 *   `test/arquitectura/guardian-*.test.ts`
 */
function escanearPruebasDelGuardian(archivos) {
  const problemas = [];
  for (const nombre of PRUEBAS_DEL_GUARDIAN) {
    if (archivos[nombre] === undefined) {
      problemas.push(
        problema(
          "pruebas-del-guardian-borradas",
          `${CARPETA_DE_PRUEBAS}/${nombre}`,
          1,
          `Falta ${CARPETA_DE_PRUEBAS}/${nombre}: una prueba del guardián se borró o se renombró.`,
          "Restituí el archivo de prueba: el guardián se protege con ellas.",
        ),
      );
    }
  }
  for (const nombre of Object.keys(archivos).sort()) {
    const lineas = archivos[nombre].split(/\r\n|\n/);
    lineas.forEach((linea, posicion) => {
      if (!PATRON_DE_SALTO.test(linea)) return;
      const permitido = SALTOS_PERMITIDOS.find(
        (salto) => salto.archivo === nombre && salto.linea === linea.trim(),
      );
      if (
        permitido !== undefined &&
        (permitido.requiere === null || lineas.some((otra) => otra.trim() === permitido.requiere))
      ) {
        return;
      }
      problemas.push(
        problema(
          "prueba-saltada",
          `${CARPETA_DE_PRUEBAS}/${nombre}`,
          posicion + 1,
          `La línea «${linea.trim()}» salta, deja pendiente, filtra o condiciona pruebas del guardián y no está entre los saltos permitidos.`,
          "Sacá el salto: las pruebas del guardián y la matriz corren siempre (el único salto admitido es por falta de .git).",
        ),
      );
    });
  }
  return problemas;
}

/**
 * Informe de evidencia (§2.5): un «pasó» tiene que traer qué se analizó. Si el informe dice que pasa
 * pero no analizó rutas, no clasificó todas o no lista las reglas ejecutadas, no vale como evidencia.
 *
 * @param {{ resultado: string, analisisCompleto: boolean, totales: Record<string, number>,
 *   reglasEjecutadas: { chequeos: { codigo: string }[], clasificacion: unknown[] } }} informe
 */
function verificarInformeDeEvidencia(informe) {
  const motivos = [];
  if (informe.resultado === "pasa") {
    if (informe.analisisCompleto !== true) motivos.push("el análisis no se completó");
    if (!(informe.totales?.rutas > 0)) motivos.push("no analizó ninguna ruta");
    if (informe.totales?.rutasClasificadas !== informe.totales?.rutas) {
      motivos.push("no clasificó todas las rutas");
    }
    if (informe.totales?.fallas !== 0) motivos.push("dice que pasa pero cuenta fallas");
  }
  const ejecutados = new Set((informe.reglasEjecutadas?.chequeos ?? []).map((c) => c.codigo));
  const faltan = CODIGOS_DE_FALLA.filter((codigo) => !ejecutados.has(codigo));
  if (faltan.length > 0) {
    motivos.push(
      `las reglas ejecutadas no listan ${faltan.length} chequeos (p. ej. «${faltan[0]}»)`,
    );
  }
  if ((informe.reglasEjecutadas?.clasificacion ?? []).length === 0) {
    motivos.push("no lista las reglas de clasificación que corrió");
  }
  return motivos.map((motivo) =>
    problema(
      "informe-sin-evidencia",
      ARCHIVO_DEL_INFORME,
      1,
      `El informe del guardián no sirve como evidencia: ${motivo}.`,
      "Un «pasó» tiene que venir con qué se analizó: rutas, clases y reglas ejecutadas.",
    ),
  );
}

/**
 * Evalúa lo que hizo un guardián (el real o un reemplazo) al correr sobre el repo roto conocido
 * (el CANARIO). El guardián tiene que salir con estado distinto de 0 y, por cada falla conocida,
 * imprimir `FALLA <archivo>:<línea> · …` en la salida de error.
 *
 * @param {{ estado: number | null, salidaDeError: string }} corrida
 * @param {{ archivo: string, linea: number }[]} esperadas
 * @param {string} archivoDelGuardian
 */
function evaluarCanario(corrida, esperadas, archivoDelGuardian) {
  if (corrida.estado === 0) {
    return [
      problema(
        "canario-pasa-un-repo-roto",
        archivoDelGuardian,
        1,
        "El guardián salió con 0 sobre un repositorio roto conocido (el canario): no está analizando.",
        "Restituí el guardián real: tiene que salir distinto de 0 cuando el repositorio está roto.",
      ),
    ];
  }
  const ausentes = esperadas.filter(
    ({ archivo, linea }) => !corrida.salidaDeError.includes(`FALLA ${archivo}:${linea} · `),
  );
  if (ausentes.length === 0) return [];
  const lista = ausentes.map(({ archivo, linea }) => `${archivo}:${linea}`).join(", ");
  return [
    problema(
      "canario-sin-diagnostico",
      archivoDelGuardian,
      1,
      corrida.estado === null
        ? `El guardián no terminó sobre el repo roto conocido: no hay diagnóstico de ${lista}.`
        : `El guardián salió con ${corrida.estado} pero no diagnosticó ${lista} (archivo:línea): rechazar sin decir por qué no sirve.`,
      "El guardián tiene que imprimir `archivo:línea · contrato · motivo · corrección` por cada falla.",
    ),
  ];
}

module.exports = {
  CODIGOS_DE_MECANISMO,
  PRUEBAS_DEL_GUARDIAN,
  SALTOS_PERMITIDOS,
  verificarScriptsDeArquitectura,
  verificarWorkflowDeCi,
  verificarVitestConfig,
  escanearPruebasDelGuardian,
  verificarInformeDeEvidencia,
  evaluarCanario,
};
