import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El job `Gate` es el chequeo requerido de `main` y decide su veredicto a partir de dos listas de
 * `arquitectura/evaluar-gate.cjs`. Esta prueba cierra el hueco entre esas listas y `ci.yml`:
 *
 *  - un job nuevo en `ci.yml` que nadie clasificó (el Gate lo ignoraría y un job rojo no bloquearía);
 *  - un job que sale de `needs` del Gate, o que desaparece o cambia de nombre;
 *  - un job con `continue-on-error`, o con un `if:` que lo saltea;
 *  - un job sin `timeout-minutes` (cuelga el CI hasta el tope de 6 horas de GitHub);
 *  - un Gate que ya no corre con `if: always()` (un job caído lo saltearía) o que ya no evalúa nada.
 *
 * LÍMITE: no hay un lector de YAML entre las dependencias directas (`yaml` está instalado solo como
 * dependencia transitiva y no se debe importar sin declararlo). `leerJobs` es un análisis de TEXTO que
 * entiende el estilo que Prettier impone a `ci.yml`: jobs a 2 espacios, propiedades de job a 4, `needs`
 * en lista de flujo `[a, b]` o de bloque, `if` y `timeout-minutes` escalares en una línea. Lo que no
 * entiende lo rechaza con un error (no lo ignora). No ve YAML con anclas o alias, ni `fromJSON` que
 * construya jobs, ni comandos que traguen el error (`|| true` dentro de un `run`): de eso se ocupa la
 * revisión humana de `ci.yml` (responsable en `.github/CODEOWNERS`) y `zizmor` (job `flujos`).
 */

const require = createRequire(import.meta.url);
const gate = require("../../arquitectura/evaluar-gate.cjs") as {
  evaluarGate: (
    needs: Record<string, { result: string; outputs?: Record<string, string> }>,
  ) => string[];
  OBLIGATORIOS: readonly string[];
  SOLO_EN_PULL_REQUEST: readonly string[];
};

const CI = readFileSync(join(import.meta.dirname, "../../.github/workflows/ci.yml"), "utf8");

/** Cómo se clasifica cada job de `ci.yml` para el Gate. */
interface Clasificacion {
  obligatorios: readonly string[];
  soloEnPullRequest: readonly string[];
  /** Jobs de mutación (matriz) que `evaluarGate` evalúa con una regla propia, no con las listas. */
  tratadosAparte: readonly string[];
  /** El propio job del Gate. */
  gate: string;
}

const CLASIFICACION: Clasificacion = {
  obligatorios: gate.OBLIGATORIOS,
  soloEnPullRequest: gate.SOLO_EN_PULL_REQUEST,
  // `mutacion` es la matriz por grupos: puede quedar `skipped` solo si el plan dijo `hay == false`
  // (regla de `mutacionAceptable` en evaluar-gate.cjs; se verifica abajo con `evaluarGate`).
  tratadosAparte: ["mutacion"],
  gate: "gate",
};

const todosLosClasificados = (c: Clasificacion): string[] => [
  ...c.obligatorios,
  ...c.soloEnPullRequest,
  ...c.tratadosAparte,
  c.gate,
];

/**
 * Los únicos `if:` de job que hoy existen, cada uno con su motivo. Un job que no figura acá no puede
 * tener `if`: un `if` en un job obligatorio es una forma de saltearlo sin que nadie lo note.
 */
const SI_DE_JOB_ESPERADO: Readonly<Record<string, { si: string; motivo: string }>> = {
  dependencias: {
    si: "github.event_name == 'pull_request'",
    motivo:
      "revisa lo que un pull request agrega; en push a main queda skipped (SOLO_EN_PULL_REQUEST)",
  },
  estabilidad: {
    si: "github.event_name == 'pull_request'",
    motivo: "repite la integración antes de integrar; en main ya se probó (SOLO_EN_PULL_REQUEST)",
  },
  mutacion: {
    si: "needs.mutacion-plan.outputs.hay == 'true'",
    motivo:
      "sin grupos que correr no hay matriz; el Gate lo acepta skipped solo si el plan terminó bien",
  },
  gate: {
    si: "always()",
    motivo:
      "tiene que correr aunque otro job caiga, si no un job rojo lo saltearía y quedaría «skipped»",
  },
};

/** Los `if:` de paso (dentro de `steps`) que hoy existen, por job. Un paso con `if` puede saltearse. */
const SI_DE_PASOS_ESPERADOS: Readonly<Record<string, readonly string[]>> = {
  // El guardián extrae la rama base y corre la vigilancia de la versión anterior SOLO en pull requests:
  // en push a main y en la corrida nocturna no hay base contra la que comparar.
  guardian: [
    "github.event_name == 'pull_request'", // checkout de la rama base
    "github.event_name == 'pull_request'", // no-debilitar.cjs de la base contra el árbol del PR
  ],
  componentes: [
    "steps.navegador.outputs.cache-hit != 'true'", // instalar el navegador si no estaba en el caché
    "steps.navegador.outputs.cache-hit == 'true'", // instalar solo las dependencias del sistema si estaba
  ],
};

/**
 * Jobs sin `timeout-minutes` que se conocen y se aceptan por ahora, con el motivo. Hoy ninguno (el hallazgo
 * del `gate` sin tope se cerró con `timeout-minutes: 5`). Si se agrega uno, cuando el job reciba su tope esta
 * prueba falla hasta que se saque la excepción, para que la lista no quede vieja.
 */
const SIN_TOPE_CONOCIDO: Readonly<Record<string, string>> = {};

interface JobDeCI {
  id: string;
  nombre: string | undefined;
  needs: string[];
  si: string | undefined;
  timeout: string | undefined;
  continueOnError: boolean;
  siDePasos: string[];
  texto: string;
}

const sinComentario = (valor: string): string => valor.replace(/\s+#.*$/, "").trim();
const sinComillas = (valor: string): string =>
  /^(["'])[^"']*\1$/.test(valor) ? valor.slice(1, -1) : valor;
const escalar = (valor: string): string => sinComillas(sinComentario(valor));

/** Lee los jobs de un `ci.yml`. Lanza un error si el texto no tiene la forma que entiende. */
function leerJobs(texto: string): Map<string, JobDeCI> {
  const lineas = texto
    .replaceAll("\r", "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"));
  const inicio = lineas.findIndex((l) => /^jobs:\s*$/.test(l));
  if (inicio < 0) throw new Error("no hay una sección `jobs:`");

  const bloques = new Map<string, string[]>();
  let actual: string[] | undefined;
  for (const linea of lineas.slice(inicio + 1)) {
    if (linea.trim() === "") {
      actual?.push(linea);
      continue;
    }
    if (/^\S/.test(linea)) break; // otra sección de primer nivel: terminan los jobs
    const cabecera = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(linea);
    if (cabecera?.[1] !== undefined) {
      if (bloques.has(cabecera[1])) throw new Error(`el job «${cabecera[1]}» está duplicado`);
      actual = [];
      bloques.set(cabecera[1], actual);
    } else if (/^ {1,3}\S/.test(linea)) {
      throw new Error(`línea inesperada en el nivel de los jobs: «${linea.trim()}»`);
    } else if (actual === undefined) {
      throw new Error(`contenido antes del primer job: «${linea.trim()}»`);
    } else {
      actual.push(linea);
    }
  }
  if (bloques.size === 0) throw new Error("la sección `jobs:` no tiene ningún job");

  const jobs = new Map<string, JobDeCI>();
  for (const [id, cuerpo] of bloques) jobs.set(id, leerJob(id, cuerpo));
  return jobs;
}

function leerJob(id: string, cuerpo: readonly string[]): JobDeCI {
  const propiedad = (nombre: string): string | undefined => {
    const hallada = cuerpo
      .map((l) => new RegExp(`^ {4}${nombre}:[ \\t]*(.*)$`).exec(l)?.[1])
      .find((v) => v !== undefined);
    return hallada === undefined ? undefined : escalar(hallada);
  };
  return {
    id,
    nombre: propiedad("name"),
    needs: leerNeeds(cuerpo),
    si: propiedad("if"),
    timeout: propiedad("timeout-minutes"),
    // Cualquier mención, en el job o en un paso o en la estrategia: todas dejan pasar un fallo.
    continueOnError: cuerpo.some((l) => l.includes("continue-on-error")),
    siDePasos: cuerpo
      .map((l) => /^ {5,}(?:-\s+)?if:\s*(.*)$/.exec(l)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(escalar),
    texto: cuerpo.join("\n"),
  };
}

function leerNeeds(cuerpo: readonly string[]): string[] {
  const donde = cuerpo.findIndex((l) => /^ {4}needs:/.test(l));
  if (donde < 0) return [];
  let desde = donde;
  let valor = sinComentario((cuerpo[donde] ?? "").replace(/^ {4}needs:/, ""));
  // Prettier deja la lista de flujo en la línea siguiente cuando no entra: `needs:` y abajo `[`.
  if (valor === "" && sinComentario(cuerpo[donde + 1] ?? "").startsWith("[")) {
    desde = donde + 1;
    valor = sinComentario(cuerpo[desde] ?? "");
  }
  if (valor.startsWith("[")) {
    // Lista de flujo, posiblemente en varias líneas: hasta el «]».
    let texto = valor;
    for (let i = desde + 1; !texto.includes("]") && i < cuerpo.length; i++) {
      texto += ` ${sinComentario(cuerpo[i] ?? "")}`;
    }
    if (!texto.includes("]")) throw new Error("la lista `needs` no cierra");
    return texto
      .slice(1, texto.indexOf("]"))
      .split(",")
      .map((n) => sinComillas(n.trim()))
      .filter((n) => n !== "");
  }
  if (valor !== "") return [sinComillas(valor)];
  const items: string[] = [];
  for (const linea of cuerpo.slice(donde + 1)) {
    const item = /^ {5,}-\s+(.+)$/.exec(linea)?.[1];
    if (item === undefined) break;
    items.push(escalar(item));
  }
  return items;
}

/** Todo lo que está mal en `ci.yml` respecto del Gate: una línea por problema, con el job y el motivo. */
function verificarCI(texto: string, clasificacion: Clasificacion = CLASIFICACION): string[] {
  let jobs: Map<string, JobDeCI>;
  try {
    jobs = leerJobs(texto);
  } catch (error) {
    return [`ci.yml: no se pudo leer (${error instanceof Error ? error.message : String(error)})`];
  }
  const problemas: string[] = [];
  const clasificados = new Set(todosLosClasificados(clasificacion));

  // (a) El conjunto de jobs es exactamente el clasificado.
  for (const id of jobs.keys()) {
    if (!clasificados.has(id)) {
      problemas.push(
        `«${id}»: job de ci.yml sin clasificar; agregalo a OBLIGATORIOS o SOLO_EN_PULL_REQUEST en arquitectura/evaluar-gate.cjs (o a los tratados aparte de esta prueba): el Gate lo ignora`,
      );
    }
  }
  for (const id of clasificados) {
    if (!jobs.has(id))
      problemas.push(`«${id}»: está clasificado para el Gate pero no existe en ci.yml`);
  }

  // (b) El Gate espera a todos los demás.
  const elGate = jobs.get(clasificacion.gate);
  if (elGate !== undefined) {
    for (const id of clasificados) {
      if (id !== clasificacion.gate && !elGate.needs.includes(id)) {
        problemas.push(
          `«${id}»: falta en \`needs\` del job ${clasificacion.gate}; el Gate no lo espera`,
        );
      }
    }
    // (d) El Gate es el chequeo requerido, corre siempre y evalúa de verdad.
    if (elGate.nombre !== "Gate") {
      problemas.push(
        `«${elGate.id}»: su \`name\` es «${elGate.nombre ?? "(ninguno)"}» y debe ser «Gate»: es el nombre del chequeo requerido de main`,
      );
    }
    if (!elGate.texto.includes("run: node arquitectura/evaluar-gate.cjs")) {
      problemas.push(`«${elGate.id}»: ya no ejecuta \`node arquitectura/evaluar-gate.cjs\``);
    }
    if (!elGate.texto.includes("NEEDS: ${{ toJSON(needs) }}")) {
      problemas.push(
        `«${elGate.id}»: ya no le pasa \`NEEDS: \${{ toJSON(needs) }}\` a evaluar-gate`,
      );
    }
  }

  // (c) y (e) Por cada job clasificado que existe: sin fallos tragados, sin saltos, con tope.
  for (const id of clasificados) {
    const job = jobs.get(id);
    if (job === undefined) continue;
    if (job.continueOnError) {
      problemas.push(`«${id}»: tiene \`continue-on-error\`; un fallo suyo no frenaría el Gate`);
    }
    const permitido = SI_DE_JOB_ESPERADO[id];
    if (permitido === undefined && job.si !== undefined) {
      problemas.push(
        `«${id}»: tiene \`if: ${job.si}\` y no debería (un job así se puede saltear); si es legítimo, justificalo en SI_DE_JOB_ESPERADO`,
      );
    }
    if (permitido !== undefined && job.si !== permitido.si) {
      problemas.push(
        `«${id}»: su \`if\` es ${job.si === undefined ? "(ninguno)" : `«${job.si}»`} y debe ser «${permitido.si}» (${permitido.motivo})`,
      );
    }
    const pasosPermitidos = [...(SI_DE_PASOS_ESPERADOS[id] ?? [])].sort();
    if (JSON.stringify([...job.siDePasos].sort()) !== JSON.stringify(pasosPermitidos)) {
      problemas.push(
        `«${id}»: los \`if\` de sus pasos son [${job.siDePasos.join(" | ")}] y deben ser [${pasosPermitidos.join(" | ")}]; un paso con \`if\` se puede saltear`,
      );
    }
    const tope = job.timeout !== undefined && /^[1-9]\d*$/.test(job.timeout);
    const excepcion = SIN_TOPE_CONOCIDO[id];
    if (!tope && excepcion === undefined) {
      problemas.push(
        `«${id}»: \`timeout-minutes\` ${job.timeout === undefined ? "falta" : `vale «${job.timeout}»`}; tiene que ser un entero mayor que 0`,
      );
    }
    if (tope && excepcion !== undefined) {
      problemas.push(
        `«${id}»: ya tiene \`timeout-minutes\`; sacalo de SIN_TOPE_CONOCIDO en esta prueba (${excepcion})`,
      );
    }
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------
// Alteraciones en memoria del `ci.yml` real (independientes del lector: operan sobre el texto).
// ---------------------------------------------------------------------------------------------

/** Reemplaza `de` por `a`, y falla si `de` no aparece exactamente una vez (la alteración no puede ser un no-op). */
function reemplazarUnico(texto: string, de: string | RegExp, a: string): string {
  const veces =
    typeof de === "string"
      ? texto.split(de).length - 1
      : (texto.match(new RegExp(de.source, `${de.flags}g`)) ?? []).length;
  if (veces !== 1)
    throw new Error(`el caso esperaba hallar «${String(de)}» una vez y hay ${veces}`);
  return texto.replace(de, () => a);
}

/** Aplica `cambio` solo al bloque del job `id` (desde su cabecera hasta la del job que sigue). */
function enJob(texto: string, id: string, cambio: (bloque: string) => string): string {
  const cabecera = `\n  ${id}:\n`;
  const inicio = texto.indexOf(cabecera);
  if (inicio < 0) throw new Error(`el caso no encuentra el job «${id}»`);
  const desde = inicio + cabecera.length;
  const siguiente = texto.slice(desde).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  const fin = siguiente < 0 ? texto.length : desde + siguiente + 1;
  return texto.slice(0, inicio + 1) + cambio(texto.slice(inicio + 1, fin)) + texto.slice(fin);
}

/** Inserta una línea de propiedad de job justo debajo de su cabecera. */
const conPropiedad = (texto: string, id: string, linea: string): string =>
  enJob(texto, id, (b) => b.replace(/^.*\n/, (cabecera) => `${cabecera}    ${linea}\n`));

const sinJob = (texto: string, id: string): string => enJob(texto, id, () => "");

const sinEnNeeds = (texto: string, id: string): string =>
  enJob(texto, "gate", (b) => reemplazarUnico(b, `        ${id},\n`, ""));

const sinTimeout = (texto: string, id: string): string =>
  enJob(texto, id, (b) => reemplazarUnico(b, /^ {4}timeout-minutes: .*\n/m, ""));

const JOB_NUEVO =
  "\n  intruso:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: exit 1\n\n  gate:\n";

interface Caso {
  nombre: string;
  alterar: (texto: string) => string;
  /** Fragmento que tiene que aparecer en algún problema: el job y el motivo, no solo «algo falló». */
  esperado: readonly string[];
  clasificacion?: Clasificacion;
}

const TODOS = todosLosClasificados(CLASIFICACION);
const SIN_GATE = TODOS.filter((id) => id !== CLASIFICACION.gate);
const CON_TOPE = TODOS.filter((id) => !(id in SIN_TOPE_CONOCIDO));

const CASOS: Caso[] = [
  {
    nombre: "agregar un job nuevo sin clasificar",
    alterar: (t) => reemplazarUnico(t, "\n  gate:\n", JOB_NUEVO),
    esperado: ["«intruso»", "sin clasificar"],
  },
  {
    nombre: "agregar un job nuevo sin clasificar, aunque el Gate lo espere en needs",
    alterar: (t) =>
      enJob(reemplazarUnico(t, "\n  gate:\n", JOB_NUEVO), "gate", (b) =>
        reemplazarUnico(b, "        estatico,\n", "        estatico,\n        intruso,\n"),
      ),
    esperado: ["«intruso»", "sin clasificar"],
  },
  {
    nombre: "clasificar en las listas un job que no existe en ci.yml",
    alterar: (t) => t,
    clasificacion: { ...CLASIFICACION, obligatorios: [...CLASIFICACION.obligatorios, "fantasma"] },
    esperado: ["«fantasma»", "no existe en ci.yml"],
  },
  {
    nombre: "sacar de las listas un job que sigue existiendo en ci.yml",
    alterar: (t) => t,
    clasificacion: { ...CLASIFICACION, obligatorios: CLASIFICACION.obligatorios.slice(1) },
    esperado: [`«${CLASIFICACION.obligatorios[0] ?? ""}»`, "sin clasificar"],
  },
  ...SIN_GATE.map((id): Caso => ({
    nombre: `quitar «${id}» de needs del gate`,
    alterar: (t) => sinEnNeeds(t, id),
    esperado: [`«${id}»`, "falta en `needs`"],
  })),
  ...TODOS.map((id): Caso => ({
    nombre: `agregar continue-on-error: true al job «${id}»`,
    alterar: (t) => conPropiedad(t, id, "continue-on-error: true"),
    esperado: [`«${id}»`, "continue-on-error"],
  })),
  {
    nombre: "continue-on-error en un paso del job «pruebas»",
    alterar: (t) =>
      enJob(t, "pruebas", (b) =>
        reemplazarUnico(
          b,
          "      - run: npm test",
          "      - run: npm test\n        continue-on-error: true",
        ),
      ),
    esperado: ["«pruebas»", "continue-on-error"],
  },
  {
    nombre: "continue-on-error atado a la matriz del job «mutacion»",
    alterar: (t) => conPropiedad(t, "mutacion", "continue-on-error: ${{ matrix.grupo != 'x' }}"),
    esperado: ["«mutacion»", "continue-on-error"],
  },
  ...CLASIFICACION.obligatorios.map((id): Caso => ({
    nombre: `agregar if: false al job obligatorio «${id}»`,
    alterar: (t) => conPropiedad(t, id, "if: false"),
    esperado: [`«${id}»`, "if: false"],
  })),
  {
    nombre: "agregar un if que saltea al job «mutacion-plan» con la forma del de dependencias",
    alterar: (t) => conPropiedad(t, "mutacion-plan", "if: github.event_name == 'pull_request'"),
    esperado: ["«mutacion-plan»", "no debería"],
  },
  {
    nombre: "dejar «dependencias» siempre saltado (if: false)",
    alterar: (t) =>
      enJob(t, "dependencias", (b) =>
        reemplazarUnico(b, "if: github.event_name == 'pull_request'", "if: false"),
      ),
    esperado: ["«dependencias»", "debe ser"],
  },
  {
    nombre: "dejar «estabilidad» sin su if de pull request",
    alterar: (t) =>
      enJob(t, "estabilidad", (b) =>
        reemplazarUnico(b, "    if: github.event_name == 'pull_request'\n", ""),
      ),
    esperado: ["«estabilidad»", "debe ser"],
  },
  {
    nombre: "ampliar el if de «mutacion» para que además se saltee",
    alterar: (t) =>
      reemplazarUnico(
        t,
        "if: needs.mutacion-plan.outputs.hay == 'true'",
        "if: needs.mutacion-plan.outputs.hay == 'true' && false",
      ),
    esperado: ["«mutacion»", "debe ser"],
  },
  {
    nombre: "el job «guardian» pierde el if de su paso de vigilancia (correría siempre y sin base)",
    alterar: (t) =>
      enJob(t, "guardian", (b) =>
        reemplazarUnico(
          b,
          "      - name: Vigilancia de la versión anterior (no se debilita lo que la base exigía)\n        if: github.event_name == 'pull_request'\n",
          "      - name: Vigilancia de la versión anterior (no se debilita lo que la base exigía)\n",
        ),
      ),
    esperado: ["«guardian»", "los `if` de sus pasos"],
  },
  {
    nombre: "el job «guardian» saltea el guardián del cambio con un if de paso",
    alterar: (t) =>
      enJob(t, "guardian", (b) =>
        reemplazarUnico(
          b,
          "      - name: Guardián del cambio (la versión nueva)\n",
          "      - name: Guardián del cambio (la versión nueva)\n        if: false\n",
        ),
      ),
    esperado: ["«guardian»", "los `if` de sus pasos"],
  },
  {
    nombre: "continue-on-error en el paso que corre el guardián",
    alterar: (t) =>
      enJob(t, "guardian", (b) =>
        reemplazarUnico(
          b,
          "        run: node arquitectura/contratos/guardian.cjs\n",
          "        run: node arquitectura/contratos/guardian.cjs\n        continue-on-error: true\n",
        ),
      ),
    esperado: ["«guardian»", "continue-on-error"],
  },
  {
    nombre: "cambiar el if: always() del gate por success()",
    alterar: (t) => enJob(t, "gate", (b) => reemplazarUnico(b, "if: always()", "if: success()")),
    esperado: ["«gate»", "always()"],
  },
  {
    nombre: "quitar el if: always() del gate",
    alterar: (t) => enJob(t, "gate", (b) => reemplazarUnico(b, "    if: always()\n", "")),
    esperado: ["«gate»", "always()"],
  },
  {
    nombre: "paso con if: false en el job «pruebas»",
    alterar: (t) =>
      enJob(t, "pruebas", (b) =>
        reemplazarUnico(b, "      - run: npm test", "      - if: false\n        run: npm test"),
      ),
    esperado: ["«pruebas»", "if"],
  },
  {
    nombre: "agregar un if de paso nuevo al job «componentes»",
    alterar: (t) =>
      enJob(t, "componentes", (b) =>
        reemplazarUnico(
          b,
          "      - run: npm run test:componentes",
          "      - if: false\n        run: npm run test:componentes",
        ),
      ),
    esperado: ["«componentes»", "if"],
  },
  ...CON_TOPE.map((id): Caso => ({
    nombre: `quitar timeout-minutes del job «${id}»`,
    alterar: (t) => sinTimeout(t, id),
    esperado: [`«${id}»`, "timeout-minutes"],
  })),
  {
    nombre: "timeout-minutes: 0 en «estatico»",
    alterar: (t) =>
      enJob(t, "estatico", (b) => reemplazarUnico(b, "timeout-minutes: 15", "timeout-minutes: 0")),
    esperado: ["«estatico»", "timeout-minutes"],
  },
  ...CLASIFICACION.obligatorios.map((id): Caso => ({
    nombre: `renombrar el job obligatorio «${id}»`,
    alterar: (t) => reemplazarUnico(t, `\n  ${id}:\n`, `\n  ${id}-v2:\n`),
    esperado: [`«${id}»`, "no existe en ci.yml"],
  })),
  ...TODOS.map((id): Caso => ({
    nombre: `borrar el job «${id}»`,
    alterar: (t) => sinJob(t, id),
    esperado: [`«${id}»`, "no existe en ci.yml"],
  })),
  {
    nombre: "cambiar el nombre visible del gate (deja de ser el chequeo requerido)",
    alterar: (t) => enJob(t, "gate", (b) => reemplazarUnico(b, "name: Gate", "name: Gate final")),
    esperado: ["«gate»", "«Gate»"],
  },
  {
    nombre: "el gate deja de ejecutar evaluar-gate.cjs",
    alterar: (t) =>
      reemplazarUnico(t, "run: node arquitectura/evaluar-gate.cjs", "run: echo todo bien"),
    esperado: ["«gate»", "evaluar-gate"],
  },
  {
    nombre: "el gate deja de pasarle needs a evaluar-gate.cjs",
    alterar: (t) => reemplazarUnico(t, "NEEDS: ${{ toJSON(needs) }}", "NEEDS: '{}'"),
    esperado: ["«gate»", "NEEDS"],
  },
  {
    nombre: "ci.yml sin sección jobs",
    alterar: (t) => t.replace(/^jobs:\s*$/m, "trabajos:"),
    esperado: ["no se pudo leer"],
  },
  {
    nombre: "dos jobs con el mismo nombre",
    alterar: (t) =>
      reemplazarUnico(t, "\n  gate:\n", "\n  pruebas:\n    runs-on: ubuntu-latest\n\n  gate:\n"),
    esperado: ["no se pudo leer", "duplicado"],
  },
];

describe("ci.yml y el Gate", () => {
  it("el ci.yml real coincide con las listas de evaluar-gate.cjs", () => {
    expect(verificarCI(CI)).toEqual([]);
  });

  it("el lector entiende el ci.yml real: sus jobs y el needs del gate", () => {
    const jobs = leerJobs(CI);
    expect([...jobs.keys()].sort()).toEqual([...TODOS].sort());
    expect([...(jobs.get("gate")?.needs ?? [])].sort()).toEqual([...SIN_GATE].sort());
    expect(jobs.get("estabilidad")?.si).toBe("github.event_name == 'pull_request'");
    expect(jobs.get("componentes")?.siDePasos).toHaveLength(2);
    expect(jobs.get("mutacion")?.timeout).toBe("90");
    expect(jobs.get("guardian")?.nombre).toBe("Guardián de contratos");
    expect(jobs.get("guardian")?.timeout).toBe("10");
    expect(jobs.get("guardian")?.siDePasos).toEqual([
      "github.event_name == 'pull_request'",
      "github.event_name == 'pull_request'",
    ]);
  });

  it("el guardián es obligatorio para el Gate y corre el del cambio y la vigilancia de la base", () => {
    expect(gate.OBLIGATORIOS).toContain("guardian");
    const cuerpo = leerJobs(CI).get("guardian")?.texto ?? "";
    expect(cuerpo).toContain("run: node arquitectura/contratos/guardian.cjs");
    expect(cuerpo).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(cuerpo).toContain("path: base");
    expect(cuerpo).toContain("node base/arquitectura/contratos/no-debilitar.cjs --arbol .");
    // Sin secretos ni credenciales persistidas en ningún checkout del job.
    expect(cuerpo).not.toContain("secrets.");
    expect((cuerpo.match(/persist-credentials: false/g) ?? []).length).toBe(2);
  });

  it("la rama base se extrae DESPUÉS de correr el guardián (su `base/` anidado sería una ruta sin clase)", () => {
    const cuerpo = leerJobs(CI).get("guardian")?.texto ?? "";
    const corre = cuerpo.indexOf("run: node arquitectura/contratos/guardian.cjs");
    const extrae = cuerpo.indexOf("path: base");
    expect(corre).toBeGreaterThan(-1);
    expect(extrae).toBeGreaterThan(corre);
  });

  it("el workflow no usa pull_request_target ni secretos (la base y el PR corren sin credenciales)", () => {
    expect(CI).not.toContain("pull_request_target");
    expect(CI).not.toMatch(/secrets\./);
  });

  it("evaluarGate pide de verdad cada job de las listas y el de mutación", () => {
    const verde: Record<string, { result: string; outputs?: Record<string, string> }> =
      Object.fromEntries(SIN_GATE.map((id) => [id, { result: "success" }]));
    verde["mutacion-plan"] = { result: "success", outputs: { hay: "true" } };
    expect(gate.evaluarGate(verde)).toEqual([]);
    for (const id of SIN_GATE) {
      const caido = { ...verde, [id]: { ...verde[id], result: "failure" } };
      expect(
        gate.evaluarGate(caido).some((p) => p.startsWith(`${id}:`)),
        `si «${id}» cae, evaluarGate lo tiene que reportar`,
      ).toBe(true);
    }
  });
});

describe("ci.yml y el Gate: alteraciones en memoria que la prueba tiene que detectar", () => {
  it.each(CASOS)("$nombre", ({ alterar, esperado, clasificacion }) => {
    const alterado = alterar(CI);
    if (clasificacion === undefined) expect(alterado).not.toBe(CI);
    const problemas = verificarCI(alterado, clasificacion);
    expect(problemas.length).toBeGreaterThan(0);
    expect(
      problemas.some((p) => esperado.every((fragmento) => p.includes(fragmento))),
      `ningún problema dice ${JSON.stringify(esperado)}:\n${problemas.join("\n")}`,
    ).toBe(true);
  });
});
