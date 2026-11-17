/**
 * El job `reloj` del CI: corre la SUITE CRÍTICA (las pruebas de integración de caja, cierre del día, planes, ventas y fiscal) con el reloj de las pruebas fijado en tres
 * momentos y la zona de la sesión de la base de pruebas que corresponde, para ver lo que el reloj real esconde la mayor parte del día.
 *
 *     node arquitectura/reloj-critico.cjs plan      (en el job `mutacion-plan`: dice si un pull request toca esas áreas)
 *     node arquitectura/reloj-critico.cjs correr    (en el job `reloj`: las tres pasadas)
 *     node arquitectura/reloj-critico.cjs listar    (las pruebas de la suite crítica, una por línea)
 *
 * Previene: tres noches de CI en rojo (13-16/11/2026) por mezclar el día de Argentina con el de la base: pruebas y fixtures que pedían la hora al reloj real y a `now()` de la
 * base a la vez, y entre las 21:00 y las 24:00 de Argentina (00:00 UTC) no daban el mismo día. Las tres pasadas: (1) las próximas 23:30 de Argentina, (2) las próximas 00:30 de Argentina
 * (la base en zona Argentina) y (3) el próximo cambio de día UTC con la base en zona UTC, que es la que ve Neon (si algo del código depende sin querer de la zona de la sesión, acá se ve).
 * «Próximas» = SIEMPRE por delante del reloj real: la base escribe en su hora real y un reloj inyectado atrasado hace que lo recién escrito «no rija todavía»
 * (medido: 88 fallas en 8 archivos con `MODULO_EN_SOLO_LECTURA`, porque la asignación del plan nace con el `now()` del SQL del producto); ese límite queda por escrito acá y no se cubre con relojes atrasados.
 * Fail-closed: sin pruebas críticas no hay pasada verde (falla), una pasada que falla no frena a las otras (se ven todas) y el job sale con error nombrando cuáles.
 * Chequeo que falla si se quita: `test/arquitectura/reloj-critico.test.ts`.
 */
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { escaparPropiedad } = require("./correr-paquete-de-mutacion.cjs");

const UN_MINUTO = 60_000;
const UN_DIA = 24 * 60 * UN_MINUTO;
/** Argentina no tiene horario de verano: UTC-3 todo el año (la misma regla de `src/primitivas/tiempo`). */
const DESFASE_DE_ARGENTINA_MS = 3 * 60 * UN_MINUTO;
/** Cuánto por delante del reloj real tiene que quedar, como mínimo, el instante fijado. */
const MARGEN_MS = 5 * UN_MINUTO;
const ZONA_DE_ARGENTINA = "America/Argentina/Buenos_Aires";

const IMPORTA_UN_MODULO = (modulos) => (ruta) =>
  modulos.some((modulo) => ruta.startsWith(`src/modulos/${modulo}/`));
const ES_UNA_PRUEBA_DE_INTEGRACION = /^test\/integracion\/[^/]+\.test\.ts$/;
const ES_UN_APOYO_DE_INTEGRACION = /^test\/integracion\/[^/]+\.ts$/;
/** Lo que cambia el resultado de la suite aunque no sea un archivo de un módulo ni una prueba crítica: la configuración de pruebas, las migraciones, este workflow. */
const CAMBIOS_QUE_LA_AFECTAN = [
  /^migraciones\//,
  /^\.github\/workflows\/ci\.yml$/,
  /^vitest\.config\.ts$/,
  /^package(?:-lock)?\.json$/,
  /^arquitectura\/reloj-critico\.(?:cjs|json)$/,
];

/** La configuración (`reloj-critico.json`): la lista cerrada de módulos críticos. Lanza si no es una lista no vacía de nombres simples. */
function leerConfiguracion(texto) {
  const valor = JSON.parse(texto);
  const modulos = valor?.modulos;
  if (
    !Array.isArray(modulos) ||
    modulos.length === 0 ||
    !modulos.every((m) => typeof m === "string" && /^[a-z][a-z-]*$/.test(m))
  ) {
    throw new Error(
      "reloj-critico.json: `modulos` tiene que ser una lista no vacía de nombres de módulo.",
    );
  }
  return { modulos };
}

/** Las pruebas críticas: las de integración con un import DIRECTO de un archivo de uno de los módulos. Ordenadas, sin repetir. */
function pruebasCriticas(dependencias, { modulos }) {
  const esDeUnModulo = IMPORTA_UN_MODULO(modulos);
  return Object.keys(dependencias)
    .filter(
      (archivo) =>
        ES_UNA_PRUEBA_DE_INTEGRACION.test(archivo) &&
        dependencias[archivo].some((importado) => esDeUnModulo(importado)),
    )
    .sort();
}

/** ¿El cambio toca la suite crítica? Un archivo de un módulo crítico, una prueba crítica, un apoyo de integración (no es una prueba), una migración o la configuración. */
function tocaLaSuiteCritica(cambios, criticas, { modulos }) {
  const esDeUnModulo = IMPORTA_UN_MODULO(modulos);
  const delConjunto = new Set(criticas);
  return cambios.some(
    (cambio) =>
      esDeUnModulo(cambio) ||
      delConjunto.has(cambio) ||
      (ES_UN_APOYO_DE_INTEGRACION.test(cambio) && !ES_UNA_PRUEBA_DE_INTEGRACION.test(cambio)) ||
      CAMBIOS_QUE_LA_AFECTAN.some((patron) => patron.test(cambio)),
  );
}

const dos = (n) => String(n).padStart(2, "0");
const fechaEnUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Las tres pasadas, con el instante fijado POR DELANTE de `ahora` (al menos `MARGEN_MS`):
 * las próximas 23:30 y las próximas 00:30 de Argentina (base en hora de Argentina) y el próximo 00:00 UTC (base en UTC).
 * Los nombres no llevan `:` ni `,` (van en comandos de GitHub Actions).
 */
function variantes(ahora) {
  const minimo = ahora + MARGEN_MS;
  const proximaDeArgentina = (hora, minuto) => {
    // Medianoche de Argentina del día de `minimo` (en hora de Argentina), como instante UTC.
    const medianoche =
      Math.floor((minimo - DESFASE_DE_ARGENTINA_MS) / UN_DIA) * UN_DIA + DESFASE_DE_ARGENTINA_MS;
    let instante = medianoche + (hora * 60 + minuto) * UN_MINUTO;
    if (instante <= minimo) instante += UN_DIA;
    const local = new Date(instante - DESFASE_DE_ARGENTINA_MS);
    return `${fechaEnUtc(local.getTime())}T${dos(hora)}:${dos(minuto)}:00-03:00`;
  };
  const proximoCambioUtc = () => {
    // La próxima medianoche UTC estrictamente después de `minimo` (el piso del día siempre es <= minimo).
    const instante = Math.floor(minimo / UN_DIA) * UN_DIA + UN_DIA;
    return `${fechaEnUtc(instante)}T00:00:00Z`;
  };
  return [
    { nombre: "23h30 de Argentina", fijo: proximaDeArgentina(23, 30), zona: ZONA_DE_ARGENTINA },
    { nombre: "00h30 de Argentina", fijo: proximaDeArgentina(0, 30), zona: ZONA_DE_ARGENTINA },
    { nombre: "cambio de dia UTC con la base en UTC", fijo: proximoCambioUtc(), zona: "UTC" },
  ];
}

/**
 * Las pasadas, una tras otra.
 * @param {{ criticas: readonly string[], pasadas: readonly { nombre: string, fijo: string, zona: string }[], ejecutar: (p: { nombre: string, fijo: string, zona: string }, criticas: readonly string[]) => number, escribir: (t: string) => void, ahora?: () => number }} entrada
 */
function correr({ criticas, pasadas, ejecutar, escribir, ahora = Date.now }) {
  if (criticas.length === 0) {
    throw new Error(
      "la suite crítica del reloj no tiene ninguna prueba: un job verde sin pruebas no prueba nada.",
    );
  }
  const resultados = [];
  for (const pasada of pasadas) {
    escribir(`::group::Reloj · ${pasada.nombre} (reloj ${pasada.fijo}, base en ${pasada.zona})\n`);
    const inicio = ahora();
    let codigo;
    try {
      codigo = ejecutar(pasada, criticas);
    } catch (error) {
      escribir(`${error instanceof Error ? error.message : String(error)}\n`);
      codigo = 1;
    }
    escribir("::endgroup::\n");
    resultados.push({
      nombre: pasada.nombre,
      codigo,
      segundos: Math.round((ahora() - inicio) / 1000),
    });
    if (codigo !== 0) {
      escribir(
        `::error title=${escaparPropiedad(`Reloj · ${pasada.nombre}`)}::La suite critica fallo con el reloj en ${pasada.fijo} y la base en ${pasada.zona} (codigo ${codigo}).\n`,
      );
    }
  }
  const fallaron = resultados.filter((r) => r.codigo !== 0).map((r) => r.nombre);
  const resumen = [
    `### Reloj: ${criticas.length} archivo(s) de la suite crítica en ${resultados.length} pasada(s)`,
    "",
    "| Pasada | Resultado | Segundos |",
    "|---|---|---|",
    ...resultados.map(
      (r) =>
        `| ${r.nombre} | ${r.codigo === 0 ? "cumple" : `FALLA (código ${r.codigo})`} | ${r.segundos} |`,
    ),
    "",
  ].join("\n");
  return { resultados, fallaron, resumen };
}

/** Las dependencias por archivo a partir de la salida JSON de dependency-cruiser: `{ archivo: [archivos que importa] }`. */
function dependenciasDeLaSalida(salida) {
  const dependencias = {};
  for (const modulo of JSON.parse(salida).modules) {
    dependencias[modulo.source] = modulo.dependencies.map((d) => d.resolved).filter(Boolean);
  }
  return dependencias;
}

/** La salida de depcruise aunque haya salido con código distinto de cero (hay violaciones: el JSON igual está completo). Sin salida, lanza el error. */
function salidaDeDepcruise(ejecutar) {
  try {
    return ejecutar();
  } catch (error) {
    if (typeof error.stdout !== "string" || error.stdout === "") throw error;
    return error.stdout;
  }
}

function dependenciasDelRepositorio(raiz) {
  const salida = salidaDeDepcruise(() =>
    execFileSync(
      path.join(raiz, "node_modules/.bin/depcruise"),
      ["src", "apps", "test", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
      {
        cwd: raiz,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ),
  );
  return dependenciasDeLaSalida(salida);
}

/** Qué dice el plan: en un pull request, si el cambio toca la suite crítica; en cualquier otro evento (la nocturna, a pedido, push a `main`), que corre siempre. */
function decidirElPlan({ evento, cambios, criticas, configuracion }) {
  if (evento !== "pull_request") {
    return { corre: true, motivo: `evento ${evento === "" ? "local" : evento}: corre siempre` };
  }
  const corre = tocaLaSuiteCritica(cambios, criticas, configuracion);
  return {
    corre,
    motivo: corre ? "el cambio toca la suite crítica" : "el cambio no toca la suite crítica",
  };
}

/** El comando de una pasada: argumentos (no texto de un shell) y el entorno con el reloj y la zona de esa pasada. */
function comandoDeLaPasada(pasada, archivos, entorno) {
  return {
    argumentos: ["vitest", "run", "--project", "node", ...archivos],
    entorno: {
      ...entorno,
      PEDERNAL_RELOJ_FIJO: pasada.fijo,
      PEDERNAL_ZONA_DE_LA_BASE: pasada.zona,
    },
  };
}

/** Los archivos que cambió el pull request respecto de su base (el primer padre del commit de merge que deja Actions). */
const archivosCambiados = (raiz) =>
  execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], {
    cwd: raiz,
    encoding: "utf8",
  })
    .split("\n")
    .filter((linea) => linea !== "");

/** Los cambios que importan para el plan: en un pull request, los del commit de merge; en cualquier otro evento no se miran. `leer` se inyecta en las pruebas. */
const cambiosSegunEvento = (evento, raiz, leer = archivosCambiados) =>
  evento === "pull_request" ? leer(raiz) : [];

function principal() {
  const raiz = process.cwd();
  const modo = process.argv[2];
  const configuracion = leerConfiguracion(
    fs.readFileSync(path.join(raiz, "arquitectura/reloj-critico.json"), "utf8"),
  );
  const criticas = pruebasCriticas(dependenciasDelRepositorio(raiz), configuracion);
  if (modo === "listar") {
    process.stdout.write(`${criticas.join("\n")}\n`);
  } else if (modo === "plan") {
    const evento = process.env["GITHUB_EVENT_NAME"] ?? "";
    const cambios = cambiosSegunEvento(evento, raiz);
    const { corre, motivo } = decidirElPlan({ evento, cambios, criticas, configuracion });
    process.stdout.write(`Reloj: ${motivo} (${criticas.length} archivo(s) críticos).\n`);
    const salida = process.env["GITHUB_OUTPUT"];
    if (salida !== undefined && salida !== "") fs.appendFileSync(salida, `reloj=${corre}\n`);
  } else if (modo === "correr") {
    const { fallaron, resumen } = correr({
      criticas,
      pasadas: variantes(Date.now()),
      ejecutar: (pasada, archivos) => {
        const { argumentos, entorno } = comandoDeLaPasada(pasada, archivos, process.env);
        return spawnSync("npx", argumentos, { stdio: "inherit", env: entorno }).status ?? 1;
      },
      escribir: (texto) => process.stdout.write(texto),
    });
    const archivoDeResumen = process.env["GITHUB_STEP_SUMMARY"];
    if (archivoDeResumen !== undefined && archivoDeResumen !== "")
      fs.appendFileSync(archivoDeResumen, resumen);
    if (fallaron.length > 0) {
      process.stderr.write(`Fallaron ${fallaron.length} pasada(s): ${fallaron.join("; ")}\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write("Uso: node arquitectura/reloj-critico.cjs plan|correr|listar\n");
    process.exit(2);
  }
}

module.exports = {
  leerConfiguracion,
  pruebasCriticas,
  tocaLaSuiteCritica,
  variantes,
  correr,
  dependenciasDeLaSalida,
  salidaDeDepcruise,
  decidirElPlan,
  comandoDeLaPasada,
  archivosCambiados,
  cambiosSegunEvento,
  MARGEN_MS,
};

if (require.main === module) principal();
