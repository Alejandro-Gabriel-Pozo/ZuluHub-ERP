/**
 * Los PRESUPUESTOS de deuda por archivo (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`; CLAUDE.md «Sin dato registrado
 * no hay campo», «Todo nace cerrado» y «Una regla, un lugar»). Cada presupuesto es un JSON `{ "ruta": { clave: cuenta } }` que dice, por
 * archivo, cuánta deuda de ese tipo tiene todavía:
 *  - `campos-sin-dato.json`: campos `dato="pendiente"`, controles crudos y tags dinámicos (lo comprueba `test/arquitectura/campos-con-dato.test.ts`);
 *  - `validacion-de-datos.json`: validaciones por lista de prohibidos y topes de largo repetidos (lo comprueban
 *    `test/arquitectura/lista-de-permitidos.test.ts` y `test/arquitectura/fuente-unica.test.ts`).
 * Esas pruebas comprueban que el presupuesto coincide EXACTO con el código; este script comprueba lo otro: que SOLO BAJA contra la rama
 * base. (El nombre del archivo es histórico: nació para los campos y el paso del CI y su vigilancia en `no-debilitar.cjs` ya lo nombran.)
 *
 * Previene: la deuda registrada por archivo no frena que dentro de un archivo ya listado (Emitir, origen del fallo del CUIT) se
 * sume un campo crudo o un `pendiente` más, ni que se agregue un archivo a la lista junto con un control crudo nuevo: el guardián de
 * deuda solo mira «tipo y archivo» y una excepción vigente cubre el crecimiento. Con este script subir una cuenta, agregar un
 * archivo o aflojar la forma del archivo falla.
 *
 * USO (en el CI, junto a `deuda.cjs`): `node arquitectura/deuda/campos-sin-dato.cjs [--base=<carpeta de la base>]`. Sin `--base` solo
 * valida la forma. Sale 0 si está bien, 1 si hay fallas, 2 si el uso es incorrecto. Si la base todavía no trae un presupuesto (la primera
 * vez que se incorpora) avisa y sigue; si la base lo trae y no se puede leer, falla (nunca «pasa» porque no se pudo mirar).
 * Solo usa Node: el job del guardián no instala dependencias.
 */
const fs = require("node:fs");
const path = require("node:path");

/** Los presupuestos: el archivo, las claves de su cuenta y de qué es la deuda (para los mensajes). */
const PRESUPUESTOS = Object.freeze([
  Object.freeze({
    archivo: "arquitectura/deuda/campos-sin-dato.json",
    claves: Object.freeze(["pendientes", "crudos", "dinamicos"]),
    deQue: "campos sin dato",
  }),
  Object.freeze({
    archivo: "arquitectura/deuda/validacion-de-datos.json",
    claves: Object.freeze(["prohibidos", "duplicados"]),
    deQue: "validación de datos",
  }),
]);

const esEntero = (valor) => Number.isInteger(valor) && valor >= 0;
const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Problemas de forma de un presupuesto: `{ "ruta": { clave: n, ... } }`, sin archivos en cero ni claves de más. */
function problemasDeForma(valor, presupuesto) {
  const { archivo, claves: esperadas } = presupuesto;
  const lista = esperadas.join(", ");
  if (!esObjeto(valor)) return [`${archivo} tiene que ser un objeto { ruta: { ${lista} } }.`];
  const problemas = [];
  for (const [ruta, cuenta] of Object.entries(valor)) {
    if (!esObjeto(cuenta)) {
      problemas.push(`«${ruta}»: tiene que ser { ${lista} }.`);
      continue;
    }
    const claves = Object.keys(cuenta);
    if (claves.length !== esperadas.length || !esperadas.every((c) => claves.includes(c))) {
      problemas.push(`«${ruta}»: lleva exactamente ${lista}.`);
    } else if (!esperadas.every((c) => esEntero(cuenta[c]))) {
      problemas.push(`«${ruta}»: ${lista} son enteros desde 0.`);
    } else if (esperadas.every((c) => cuenta[c] === 0)) {
      problemas.push(`«${ruta}»: no tiene deuda; sacalo del presupuesto.`);
    }
  }
  return problemas;
}

/** Lo que sube o entra respecto de la base (el presupuesto solo puede bajar). Los dos ya pasaron `problemasDeForma`. */
function problemasContraLaBase(base, pr, presupuesto) {
  const problemas = [];
  for (const [ruta, cuenta] of Object.entries(pr)) {
    const antes = Object.hasOwn(base, ruta) ? base[ruta] : undefined;
    if (antes === undefined) {
      problemas.push(
        `«${ruta}» entra a la deuda de ${presupuesto.deQue}: la base no lo tenía y el presupuesto solo baja.`,
      );
      continue;
    }
    for (const clave of presupuesto.claves) {
      if (cuenta[clave] > antes[clave]) {
        problemas.push(
          `«${ruta}»: ${clave} sube de ${antes[clave]} a ${cuenta[clave]}; el presupuesto solo baja.`,
        );
      }
    }
  }
  return problemas;
}

function leer(carpeta, archivo) {
  const ruta = path.join(carpeta, archivo);
  if (!fs.existsSync(ruta)) return { ausente: true };
  try {
    return { valor: JSON.parse(fs.readFileSync(ruta)) };
  } catch (error) {
    return { error: `${ruta}: no se puede leer (${error.message}).` };
  }
}

/** Un presupuesto del cambio contra el de la base (si hay base): `{ fallas, avisos }`. */
function controlarUno(presupuesto, raiz, carpetaDeLaBase) {
  const delCambio = leer(raiz, presupuesto.archivo);
  if (delCambio.ausente) return { fallas: [`${presupuesto.archivo} no existe.`], avisos: [] };
  if (delCambio.error !== undefined) return { fallas: [delCambio.error], avisos: [] };
  const fallas = problemasDeForma(delCambio.valor, presupuesto);
  const avisos = [];
  if (carpetaDeLaBase !== undefined) {
    const deLaBase = leer(carpetaDeLaBase, presupuesto.archivo);
    if (deLaBase.ausente) {
      avisos.push(
        `la rama base no trae ${presupuesto.archivo}: no hay presupuesto anterior contra el que comparar.`,
      );
    } else if (deLaBase.error !== undefined) {
      fallas.push(deLaBase.error);
    } else {
      const formaBase = problemasDeForma(deLaBase.valor, presupuesto);
      if (formaBase.length > 0) fallas.push(...formaBase.map((p) => `Base: ${p}`));
      else if (fallas.length === 0)
        fallas.push(...problemasContraLaBase(deLaBase.valor, delCambio.valor, presupuesto));
    }
  }
  return { fallas, avisos };
}

/** Corre el control de todos los presupuestos; devuelve `{ codigo, lineas }`. */
function ejecutar(argumentos, raiz) {
  const base = argumentos.filter((a) => a.startsWith("--base="));
  if (argumentos.length !== base.length || base.length > 1) {
    return {
      codigo: 2,
      lineas: ["Uso: node arquitectura/deuda/campos-sin-dato.cjs [--base=<carpeta de la base>]"],
    };
  }
  const carpetaDeLaBase = base.length === 1 ? base[0].slice("--base=".length) : undefined;
  const fallas = [];
  const avisos = [];
  for (const presupuesto of PRESUPUESTOS) {
    const uno = controlarUno(presupuesto, raiz, carpetaDeLaBase);
    fallas.push(...uno.fallas);
    avisos.push(...uno.avisos);
  }
  return {
    codigo: fallas.length > 0 ? 1 : 0,
    lineas: [
      ...fallas.map((f) => `FALLA ${f}`),
      ...avisos.map((a) => `AVISO ${a}`),
      `Presupuestos de deuda por archivo: ${fallas.length} fallas.`,
    ],
  };
}

if (require.main === module) {
  const { codigo, lineas } = ejecutar(process.argv.slice(2), process.cwd());
  for (const linea of lineas) process.stdout.write(`${linea}\n`);
  process.exitCode = codigo;
}

module.exports = { PRESUPUESTOS, ejecutar, problemasContraLaBase, problemasDeForma };
