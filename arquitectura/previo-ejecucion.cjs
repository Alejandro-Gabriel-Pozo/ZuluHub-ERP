/**
 * Ejecución de `npm run previo` (`arquitectura/previo.cjs`): las tandas de pasos (en paralelo si hay memoria), el corte en la primera falla, la limpieza de la caché vieja de vite
 * y el lanzamiento de los comandos. Se separó del script porque pasó el tope de 400 líneas por archivo; las funciones puras reciben lo que toca el sistema para poder probarlas.
 */
const { spawn } = require("node:child_process");
const { Buffer } = require("node:buffer");
const { rmSync } = require("node:fs");
const { join } = require("node:path");

const RAIZ = join(__dirname, "..");
const salida = (texto) => process.stdout.write(`${texto}\n`);

/** Memoria total por debajo de la cual los pasos pesados corren de a uno (sumados pican ~9,4 GB; con menos de 14 GB no hay margen). */
const MEMORIA_MINIMA_PARA_PARALELO = 14 * 1024 ** 3;

/**
 * Agrupa los pasos en tandas: los pasos seguidos con el mismo `paralelo` corren juntos si hay memoria (`memoriaTotal` en bytes) y, si no, de a uno, en el mismo orden. Función pura.
 */
function tandasDeLaCorrida(pasos, memoriaTotal) {
  const tandas = [];
  for (const paso of pasos) {
    const ultima = tandas[tandas.length - 1];
    const sePuedeJuntar =
      paso.paralelo !== undefined &&
      ultima !== undefined &&
      ultima[0].paralelo === paso.paralelo &&
      memoriaTotal >= MEMORIA_MINIMA_PARA_PARALELO;
    if (sePuedeJuntar) ultima.push(paso);
    else tandas.push([paso]);
  }
  return tandas;
}

/**
 * Corre las tandas en orden. Dentro de una tanda en paralelo, la primera falla corta a las otras. `correrPaso(paso, { envivo })` devuelve `{ promesa, cancelar }` y la promesa
 * `{ ok, segundos, cacheLimpiada }`; `escribir` recibe los textos de avance. Devuelve `{ ok, fallo, resumen }`. Se inyecta lo que toca el sistema para probarlo.
 */
async function correrTandas(tandas, correrPaso, escribir) {
  const resumen = [];
  const linea = (paso, r) =>
    `${r.cancelado ? "CORTADO" : r.ok ? "ok     " : "FALLA  "} ${paso.id} (${r.segundos} s${r.cacheLimpiada && r.ok ? ", caché vieja limpiada" : ""})`;
  for (const tanda of tandas) {
    const enParalelo = tanda.length > 1;
    escribir(
      enParalelo
        ? `\n== previo: ${tanda.map((p) => p.id).join(" y ")} en paralelo`
        : `\n== previo: ${tanda[0].id} (${tanda[0].comando.join(" ")})`,
    );
    const lanzados = tanda.map((paso) => ({ paso, h: correrPaso(paso, { envivo: !enParalelo }) }));
    let fallo = null;
    await Promise.all(
      lanzados.map(async ({ paso, h }) => {
        const r = await h.promesa;
        resumen.push(linea(paso, r));
        if (!r.ok && !r.cancelado && fallo === null) {
          fallo = paso;
          for (const otro of lanzados) if (otro.paso !== paso) otro.h.cancelar();
        }
      }),
    );
    if (fallo !== null) return { ok: false, fallo, resumen };
  }
  return { ok: true, fallo: null, resumen };
}

/**
 * Cachés de transformación de vite que, vencidas, hacen fallar `test/arquitectura/grafo.test.ts` con «Unknown variable dynamic import»: su `import()` con
 * variable se resuelve al transformar, y un transformado cacheado antes de que entrara un archivo nuevo (por un merge de la integración) no lo incluye. El CI,
 * sin caché, no lo ve. Solo se borran ante ese síntoma (borrarlas siempre encarecería cada corrida con transformación en frío) y se repite UNA vez.
 */
const CACHES_DE_VITE = [
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "node_modules/.vitest-cache",
];
const SINTOMA_DE_CACHE_VIEJA = /Unknown variable dynamic import/;

/** ¿Esta falla de vitest es el síntoma de la caché vieja de `grafo.test.ts`? Función pura. */
function esCacheVieja(comando, salidaCompleta) {
  return (
    comando.includes("vitest") &&
    SINTOMA_DE_CACHE_VIEJA.test(salidaCompleta) &&
    /grafo\.test\.ts/.test(salidaCompleta)
  );
}

/**
 * Corre un paso; si falla por la caché vieja, la limpia y lo repite UNA vez (sin saltear nada: si vuelve a fallar, la falla vale).
 * `ejecutar(comando)` devuelve `{ ok, segundos, salida }` y `limpiar()` borra las cachés; se inyectan para probarlo.
 */
async function correrConReintentoPorCacheVieja(comando, ejecutar, limpiar) {
  const primera = await ejecutar(comando);
  if (primera.ok || !esCacheVieja(comando, primera.salida)) {
    return { ok: primera.ok, segundos: primera.segundos, cacheLimpiada: false };
  }
  limpiar();
  const segunda = await ejecutar(comando);
  return {
    ok: segunda.ok,
    segundos: primera.segundos + segunda.segundos,
    cacheLimpiada: true,
  };
}

function limpiarCachesDeVite() {
  for (const ruta of CACHES_DE_VITE) rmSync(join(RAIZ, ruta), { recursive: true, force: true });
}

/**
 * Corre un comando guardando su salida para reconocer fallas conocidas; con `envivo` la muestra a medida que sale (si no, la entrega al terminar en `salida`).
 * Devuelve `{ promesa, cancelar }`: el hijo lleva su propio grupo de procesos para poder cortar también lo que lanza `npm`.
 */
function ejecutarConSalida(comando, envivo) {
  const t0 = Date.now();
  const trozos = [];
  const hijo = spawn(comando[0], comando.slice(1), {
    cwd: RAIZ,
    stdio: ["inherit", "pipe", "pipe"],
    detached: true,
  });
  let cancelado = false;
  const promesa = new Promise((resolver) => {
    hijo.stdout.on("data", (d) => {
      if (envivo) process.stdout.write(d);
      trozos.push(d);
    });
    hijo.stderr.on("data", (d) => {
      if (envivo) process.stderr.write(d);
      trozos.push(d);
    });
    hijo.on("error", () => resolver({ ok: false, segundos: 0, salida: "", cancelado }));
    hijo.on("close", (codigo) =>
      resolver({
        ok: codigo === 0,
        segundos: Math.round((Date.now() - t0) / 1000),
        salida: Buffer.concat(trozos).toString("utf8"),
        cancelado,
      }),
    );
  });
  const cancelar = () => {
    cancelado = true;
    try {
      process.kill(-hijo.pid, "SIGTERM");
    } catch {
      // ya terminó
    }
  };
  return { promesa, cancelar };
}

/** Un paso real: con reintento por la caché vieja, cancelable y, en paralelo, con su salida al terminar. */
function correrPasoReal(paso, { envivo }) {
  let cancelado = false;
  let actual = null;
  let ultimaSalida = "";
  const ejecutar = (comando) => {
    if (cancelado) return Promise.resolve({ ok: false, segundos: 0, salida: "" });
    actual = ejecutarConSalida(comando, envivo);
    return actual.promesa.then((r) => {
      ultimaSalida = r.salida;
      return r;
    });
  };
  const promesa = correrConReintentoPorCacheVieja(paso.comando, ejecutar, limpiarCachesDeVite).then(
    (r) => {
      if (!envivo) {
        salida(`\n== previo: salida de ${paso.id}`);
        process.stdout.write(ultimaSalida);
      }
      if (r.cacheLimpiada) {
        salida(
          `previo: «${paso.id}» falló por la caché vieja de vite; se limpió y se repitió una vez: ${r.ok ? "ahora pasa, caché vieja limpiada" : "vuelve a fallar, la falla vale"}.`,
        );
      }
      return { ...r, cancelado };
    },
  );
  return {
    promesa,
    cancelar: () => {
      cancelado = true;
      if (actual !== null) actual.cancelar();
    },
  };
}

module.exports = {
  MEMORIA_MINIMA_PARA_PARALELO,
  tandasDeLaCorrida,
  correrTandas,
  esCacheVieja,
  correrConReintentoPorCacheVieja,
  correrPasoReal,
};
