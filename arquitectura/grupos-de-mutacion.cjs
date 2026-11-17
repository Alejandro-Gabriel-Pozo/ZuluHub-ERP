/**
 * Los GRUPOS DE MUTACIÓN: un archivo por grupo en `arquitectura/mutacion/<nombre-del-grupo>.json`, y la lista `mutate` de Stryker DERIVADA de ellos.
 *
 * Previene: el choque que se repetía entre sesiones en paralelo (45 commits en una semana sobre `stryker.config.json` y `grupos-de-mutacion.json`, 13/11/2026):
 * cada módulo nuevo agregaba líneas al final de dos listas largas que además tenían que coincidir entre sí. Con un archivo por grupo, un módulo nuevo es un archivo
 * nuevo y no toca a nadie; y `mutate` ya no se escribe a mano: es la unión de los patrones de los grupos (una sola fuente, no dos listas que una prueba obligaba a
 * coincidir). Chequeo: `test/arquitectura/grupos-de-mutacion.test.ts` (cada regla de abajo con su violación inyectada).
 *
 * Un archivo de grupo es `{ grupo, archivos, minutos, pruebas }`:
 *  - `grupo`: el nombre; el archivo se llama como su identificador (`identificadorDe`), así un grupo no puede repetirse (dos archivos no pueden llamarse igual) y dos ramas que
 *    agregan el mismo grupo chocan en el mismo archivo;
 *  - `archivos`: patrones separados por coma. Cada uno, la ruta o patrón de archivos a mutar, con `!` delante para excluir (dentro del grupo) y, a lo sumo, un rango de
 *    líneas `:desde-hasta` al final (un archivo grande repartido entre grupos);
 *  - `minutos`: cuánto tarda el grupo (ordena la corrida en paralelo);
 *  - `pruebas`: las pruebas que lo cubren. Sin ella el grupo corre con todas (deuda que cuenta el guardián).
 *
 * Todo nace cerrado (falla ante la duda): un archivo que no es `<identificador>.json`, una subcarpeta, JSON roto, un campo de más o de menos o un patrón fuera del conjunto
 * permitido es una falla que nombra el archivo; nunca se ignora ni se corrige solo.
 */
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");

const CARPETA_DE_LOS_GRUPOS = "arquitectura/mutacion";
/** Lo que Stryker nunca muta: las pruebas. Va al final de `mutate`. */
const EXCLUSION_DE_PRUEBAS = "!src/**/*.test.ts";

const CAMPOS_OBLIGATORIOS = Object.freeze(["grupo", "archivos", "minutos"]);
const CAMPOS_PERMITIDOS = Object.freeze([...CAMPOS_OBLIGATORIOS, "pruebas"]);
/** Un patrón: `!` opcional, rutas con letras, números y `_ . / * { } -`, y a lo sumo un rango de líneas. */
const PATRON = /^!?[A-Za-z0-9_./*{}-]+(?::[0-9]+-[0-9]+)?$/;
const NOMBRE_DE_ARCHIVO = /^([^/]+)\.json$/;
const LARGO_MAXIMO_DEL_IDENTIFICADOR = 100;

const esObjeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);
const esTexto = (valor) => typeof valor === "string" && valor.trim() !== "";

/** El identificador de un grupo: su nombre en minúsculas y sin acentos, con guiones. El nombre del archivo tiene que ser este. */
function identificadorDe(grupo) {
  return grupo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Los problemas de UN archivo de grupo ya leído: lista de motivos (vacía si está bien). */
function problemasDelGrupo(valor, idDelNombre) {
  if (!esObjeto(valor)) return ["tiene que ser un objeto { grupo, archivos, minutos, pruebas }."];
  const problemas = [];
  for (const campo of Object.keys(valor)) {
    if (!CAMPOS_PERMITIDOS.includes(campo)) problemas.push(`«${campo}» no es un campo permitido.`);
  }
  for (const campo of CAMPOS_OBLIGATORIOS) {
    if (!(campo in valor)) problemas.push(`falta «${campo}».`);
  }
  if ("grupo" in valor) {
    if (!esTexto(valor.grupo)) problemas.push("«grupo» tiene que ser un texto.");
    else if (identificadorDe(valor.grupo) !== idDelNombre) {
      problemas.push(
        `el nombre del archivo tiene que ser el identificador del grupo («${identificadorDe(valor.grupo)}.json» para «${valor.grupo}»).`,
      );
    }
  }
  if ("archivos" in valor) {
    if (!esTexto(valor.archivos)) problemas.push("«archivos» tiene que ser un texto.");
    else {
      for (const patron of valor.archivos.split(",")) {
        if (!PATRON.test(patron)) {
          problemas.push(`el patrón «${patron}» de «archivos» no tiene la forma permitida.`);
        }
      }
    }
  }
  if ("minutos" in valor && !(typeof valor.minutos === "number" && valor.minutos > 0)) {
    problemas.push("«minutos» tiene que ser un número mayor que cero.");
  }
  if ("pruebas" in valor && typeof valor.pruebas !== "string") {
    problemas.push("«pruebas» tiene que ser un texto.");
  }
  return problemas;
}

/**
 * Lee los grupos de un árbol `{ rutas, leer }`. Devuelve `{ grupos, errores }`: los grupos bien formados, ordenados por identificador (byte a byte), y las fallas
 * `{ archivo, motivo }` de todo lo que no cumple (se juntan todas, no se corta en la primera).
 */
function leerLosGrupos(arbol) {
  const prefijo = `${CARPETA_DE_LOS_GRUPOS}/`;
  const errores = [];
  const grupos = [];
  for (const ruta of arbol.rutas.filter((r) => r.startsWith(prefijo))) {
    const nombre = ruta.slice(prefijo.length);
    const coincide = NOMBRE_DE_ARCHIVO.exec(nombre);
    if (coincide === null || coincide[1].length > LARGO_MAXIMO_DEL_IDENTIFICADOR) {
      errores.push({
        archivo: ruta,
        motivo: `no es un archivo de grupo: en ${CARPETA_DE_LOS_GRUPOS}/ solo van «<identificador>.json» (hasta ${LARGO_MAXIMO_DEL_IDENTIFICADOR} caracteres), sin subcarpetas ni otros archivos.`,
      });
      continue;
    }
    const contenido = arbol.leer(ruta);
    if (contenido === null) {
      errores.push({ archivo: ruta, motivo: "no se puede leer (el archivo no existe)." });
      continue;
    }
    let valor;
    try {
      valor = JSON.parse(String(contenido));
    } catch (error) {
      errores.push({ archivo: ruta, motivo: `no se puede leer (${error.message}).` });
      continue;
    }
    const problemas = problemasDelGrupo(valor, coincide[1]);
    for (const motivo of problemas) errores.push({ archivo: ruta, motivo });
    if (problemas.length > 0) continue;
    grupos.push({ id: coincide[1], ...valor });
  }
  grupos.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  return { grupos, errores };
}

/**
 * La lista `mutate` de Stryker: los patrones de todos los grupos (sin las exclusiones `!` de cada grupo ni los rangos de líneas), sin repetir, en el orden de
 * los grupos, y al final la exclusión de las pruebas. Una exclusión de un grupo vale solo dentro de ese grupo: no se junta con la de otro.
 */
function derivarMutate(grupos) {
  const vistos = new Set();
  const mutate = [];
  for (const { archivos } of grupos) {
    for (const patron of archivos.split(",")) {
      if (patron.startsWith("!")) continue;
      const sinRango = patron.replace(/:[0-9]+-[0-9]+$/, "");
      if (vistos.has(sinRango)) continue;
      vistos.add(sinRango);
      mutate.push(sinRango);
    }
  }
  return [...mutate, EXCLUSION_DE_PRUEBAS];
}

/** El árbol `{ rutas, leer }` de lo que hay en el disco bajo la carpeta de los grupos (todo lo que cuelga, con subcarpetas). */
function arbolDelDisco(raiz) {
  const base = path.join(raiz, CARPETA_DE_LOS_GRUPOS);
  const rutas = fs.existsSync(base)
    ? fs
        .readdirSync(base, { recursive: true, withFileTypes: true })
        .filter((entrada) => entrada.isFile())
        .map((entrada) => {
          const relativa = path.relative(base, path.join(entrada.parentPath, entrada.name));
          return `${CARPETA_DE_LOS_GRUPOS}/${relativa.split(path.sep).join("/")}`;
        })
    : [];
  return {
    rutas,
    leer: (ruta) => {
      try {
        return fs.readFileSync(path.join(raiz, ruta));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Lee los grupos del disco y arma `{ grupos, mutate }`, o lanza un Error con TODAS las fallas (la corrida de mutación o el plan no arrancan con grupos rotos:
 * falla cerrado). Sin ningún grupo también lanza: una lista vacía haría que la mutación «pase» sin mirar nada.
 */
function cargarLosGrupos(raiz) {
  const { grupos, errores } = leerLosGrupos(arbolDelDisco(raiz));
  if (errores.length === 0 && grupos.length === 0) {
    errores.push({
      archivo: CARPETA_DE_LOS_GRUPOS,
      motivo: "no hay ningún grupo de mutación: la mutación no miraría nada.",
    });
  }
  if (errores.length > 0) {
    throw new Error(
      `Grupos de mutación inválidos:\n${errores.map((e) => `  ${e.archivo}: ${e.motivo}`).join("\n")}`,
    );
  }
  return { grupos, mutate: derivarMutate(grupos) };
}

module.exports = {
  CARPETA_DE_LOS_GRUPOS,
  EXCLUSION_DE_PRUEBAS,
  arbolDelDisco,
  cargarLosGrupos,
  derivarMutate,
  identificadorDe,
  leerLosGrupos,
};
