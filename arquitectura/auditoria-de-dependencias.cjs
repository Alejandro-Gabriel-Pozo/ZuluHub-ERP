/**
 * Auditoría de dependencias del job «Seguridad»: falla ante cualquier aviso ALTO o CRÍTICO de `npm audit` que no esté en la lista de excepciones
 * (`arquitectura/auditoria-excepciones.json`), con vencimiento. Reemplaza a `npm audit --audit-level=high`, que no admite excepciones.
 *
 * Previene: (1) que un aviso alto SIN corrección publicada (17/11/2026: picomatch <= 4.0.7, GHSA-fc5q-39xc-vjpf, ReDoS en extglobs; 4.0.7 es la última) deje rojo
 * a todo PR y a `main` por una herramienta de desarrollo; (2) que la salida fácil sea aflojar el chequeo entero. Todo nace cerrado: lo no declarado falla.
 *  - Se resuelven los avisos de RAÍZ (`via`): un paquete que solo arrastra un aviso (vite, vitest, fdir, knip…) no es una excepción en sí; queda cubierto solo si
 *    TODOS los avisos de raíz que lo alcanzan están exceptuados. Un paquete alto cuyo aviso de raíz no se puede resolver falla.
 *  - Cada excepción lleva id GHSA, paquete, motivo, fuente y vencimiento (`AAAA-MM-DD`, inclusive): vencida falla y no se renueva sola; un CRÍTICO nunca se exceptúa.
 *  - Una excepción que ya no corresponde a ningún aviso falla pidiendo sacarla (la lista no acumula). Una excepción mal formada, `npm audit` que no corre o una salida
 *    que no se entiende también fallan.
 * Chequeo que falla si se quita una regla: `test/arquitectura/auditoria-de-dependencias.test.ts` (una violación inyectada por regla).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ARCHIVO_DE_EXCEPCIONES = "arquitectura/auditoria-excepciones.json";
/** Las severidades que cuentan (lo que antes cortaba `--audit-level=high`). */
const CUENTAN = new Set(["high", "critical"]);
const CAMPOS = ["id", "paquete", "motivo", "fuente", "vence"];
const FORMA_DE_ID = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const FORMA_DE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMA_DE_PAQUETE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const LARGO_DE_MOTIVO = { min: 40, max: 1500 };

const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** ¿Es `texto` una fecha `AAAA-MM-DD` que existe en el calendario? */
function esFechaReal(texto) {
  const partes = FORMA_DE_FECHA.exec(texto);
  if (partes === null) return false;
  const fecha = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  return fecha.toISOString().slice(0, 10) === texto;
}

/** Los problemas de la lista de excepciones (vacío = válida). Solo se permite lo declarado: ni campos de más ni de menos. */
function problemasDeLasExcepciones(valor) {
  if (!Array.isArray(valor)) return ["la lista de excepciones tiene que ser un arreglo."];
  const problemas = [];
  const vistos = new Set();
  valor.forEach((excepcion, posicion) => {
    const donde = `excepción ${posicion + 1}`;
    if (!esObjeto(excepcion)) {
      problemas.push(`${donde}: tiene que ser un objeto.`);
      return;
    }
    for (const campo of Object.keys(excepcion)) {
      if (!CAMPOS.includes(campo)) problemas.push(`${donde}: «${campo}» no es un campo permitido.`);
    }
    for (const campo of CAMPOS) {
      if (typeof excepcion[campo] !== "string")
        problemas.push(`${donde}: falta «${campo}» (texto).`);
    }
    if (typeof excepcion.id === "string") {
      if (!FORMA_DE_ID.test(excepcion.id))
        problemas.push(`${donde}: «id» no es un identificador GHSA.`);
      else if (vistos.has(excepcion.id))
        problemas.push(`${donde}: el id ${excepcion.id} está repetido.`);
      vistos.add(excepcion.id);
    }
    if (typeof excepcion.paquete === "string" && !FORMA_DE_PAQUETE.test(excepcion.paquete)) {
      problemas.push(`${donde}: «paquete» no es un nombre de paquete.`);
    }
    if (typeof excepcion.motivo === "string") {
      const largo = excepcion.motivo.trim().length;
      if (largo < LARGO_DE_MOTIVO.min || largo > LARGO_DE_MOTIVO.max) {
        problemas.push(
          `${donde}: «motivo» tiene que explicar por qué (${LARGO_DE_MOTIVO.min} a ${LARGO_DE_MOTIVO.max} caracteres).`,
        );
      }
    }
    if (typeof excepcion.fuente === "string" && excepcion.fuente.trim().length < 5) {
      problemas.push(`${donde}: «fuente» tiene que decir quién lo decidió y cuándo.`);
    }
    if (typeof excepcion.vence === "string" && !esFechaReal(excepcion.vence)) {
      problemas.push(`${donde}: «vence» no es una fecha AAAA-MM-DD real.`);
    }
  });
  return problemas;
}

/** El id GHSA de un aviso de raíz de `npm audit` (último tramo de su URL), o `null` si no se puede leer. */
const idDelAviso = (aviso) => {
  const id = typeof aviso.url === "string" ? aviso.url.split("/").pop() : undefined;
  return typeof id === "string" && FORMA_DE_ID.test(id) ? id : null;
};

/** Los avisos de raíz (objetos de `via`) que alcanzan a `paquete`, siguiendo las cadenas de dependencia (`via` de texto). */
function avisosDeRaiz(paquete, vulnerabilidades, visitados = new Set()) {
  if (visitados.has(paquete)) return [];
  visitados.add(paquete);
  const entrada = vulnerabilidades[paquete];
  if (!esObjeto(entrada) || !Array.isArray(entrada.via)) return [];
  return entrada.via.flatMap((via) =>
    typeof via === "string"
      ? avisosDeRaiz(via, vulnerabilidades, visitados)
      : esObjeto(via)
        ? [via]
        : [],
  );
}

/**
 * Decide si la auditoría pasa.
 *
 * @param {{ auditoria: unknown, excepciones: unknown, hoy: string }} entrada `hoy` es `AAAA-MM-DD`
 * @returns {{ fallas: string[], exceptuados: string[] }}
 */
function evaluar({ auditoria, excepciones, hoy }) {
  const fallas = problemasDeLasExcepciones(excepciones);
  if (fallas.length > 0) return { fallas, exceptuados: [] };
  if (!esObjeto(auditoria) || !esObjeto(auditoria.vulnerabilities)) {
    return {
      fallas: [
        "la salida de `npm audit --json` no se entiende (falta «vulnerabilities»): no se puede decir que está limpia.",
      ],
      exceptuados: [],
    };
  }
  const vulnerabilidades = auditoria.vulnerabilities;
  const resumen =
    esObjeto(auditoria.metadata) && esObjeto(auditoria.metadata.vulnerabilities)
      ? auditoria.metadata.vulnerabilities
      : {};
  const altos = Object.entries(vulnerabilidades).filter(
    ([, v]) => esObjeto(v) && CUENTAN.has(v.severity),
  );
  if (altos.length === 0 && ((resumen.high ?? 0) > 0 || (resumen.critical ?? 0) > 0)) {
    fallas.push(
      "el resumen de `npm audit` cuenta avisos altos o críticos pero no hay ninguno en el detalle: salida inconsistente.",
    );
  }

  const raices = new Map();
  for (const [paquete, vulnerabilidad] of altos) {
    const propios = avisosDeRaiz(paquete, vulnerabilidades).filter((aviso) =>
      CUENTAN.has(aviso.severity),
    );
    if (propios.length === 0) {
      fallas.push(
        `${paquete}: severidad ${vulnerabilidad.severity} sin un aviso de raíz alto o crítico que la explique.`,
      );
      continue;
    }
    for (const aviso of propios) {
      const id = idDelAviso(aviso);
      if (id === null) {
        fallas.push(
          `${paquete}: un aviso de raíz no trae un identificador GHSA legible (${String(aviso.url)}).`,
        );
        continue;
      }
      const previo = raices.get(id) ?? { aviso, paquetes: new Set() };
      previo.paquetes.add(paquete);
      raices.set(id, previo);
    }
  }

  const exceptuados = [];
  for (const [id, { aviso, paquetes }] of raices) {
    const afecta = `${aviso.name} (${aviso.severity}): ${aviso.title ?? "sin título"}; arrastra a ${[...paquetes].sort().join(", ")}`;
    const excepcion = excepciones.find((e) => e.id === id);
    if (aviso.severity === "critical")
      fallas.push(`${id} es CRÍTICO y un crítico nunca se exceptúa: ${afecta}.`);
    else if (excepcion === undefined) fallas.push(`${id} sin excepción: ${afecta}.`);
    else if (excepcion.paquete !== aviso.name)
      fallas.push(
        `${id}: la excepción dice «${excepcion.paquete}» pero el aviso es de «${aviso.name}».`,
      );
    else if (hoy > excepcion.vence)
      fallas.push(
        `${id}: la excepción VENCIÓ el ${excepcion.vence}; hay que corregir la dependencia o volver a decidirla (no se renueva sola).`,
      );
    else exceptuados.push(`${id} (${aviso.name}) hasta ${excepcion.vence}`);
  }
  for (const excepcion of excepciones) {
    if (!raices.has(excepcion.id))
      fallas.push(
        `${excepcion.id}: la excepción ya no corresponde a ningún aviso alto: sacala de ${ARCHIVO_DE_EXCEPCIONES}.`,
      );
  }
  return { fallas, exceptuados };
}

/** Corre `npm audit --json`. Sale con código distinto de cero si hay avisos y el JSON igual está completo: se lee la salida y no el código. */
function auditoriaDeNpm(raiz) {
  let salida;
  try {
    salida = execFileSync("npm", ["audit", "--json"], {
      cwd: raiz,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (typeof error.stdout !== "string" || error.stdout.trim() === "")
      throw new Error(
        `\`npm audit\` no se pudo ejecutar: ${String(error.message).split("\n")[0]}`,
        { cause: error },
      );
    salida = error.stdout;
  }
  let valor;
  try {
    valor = JSON.parse(salida);
  } catch (error) {
    throw new Error("la salida de `npm audit --json` no es JSON.", { cause: error });
  }
  if (esObjeto(valor) && valor.error !== undefined)
    throw new Error(`\`npm audit\` informó un error: ${JSON.stringify(valor.error).slice(0, 200)}`);
  return valor;
}

function principal() {
  const raiz = process.cwd();
  const hoy = new Date().toISOString().slice(0, 10);
  let resultado;
  try {
    const excepciones = JSON.parse(
      fs.readFileSync(path.join(raiz, ARCHIVO_DE_EXCEPCIONES), "utf8"),
    );
    resultado = evaluar({ auditoria: auditoriaDeNpm(raiz), excepciones, hoy });
  } catch (error) {
    resultado = { fallas: [String(error.message)], exceptuados: [] };
  }
  for (const excepcion of resultado.exceptuados) process.stdout.write(`Exceptuado: ${excepcion}\n`);
  if (resultado.fallas.length > 0) {
    for (const falla of resultado.fallas) process.stderr.write(`FALLA ${falla}\n`);
    process.stderr.write(`Auditoría de dependencias: ${resultado.fallas.length} falla(s).\n`);
    process.exit(1);
  }
  process.stdout.write(
    "Auditoría de dependencias: sin avisos altos ni críticos sin excepción vigente.\n",
  );
}

module.exports = { evaluar, problemasDeLasExcepciones, avisosDeRaiz };

if (require.main === module) principal();
