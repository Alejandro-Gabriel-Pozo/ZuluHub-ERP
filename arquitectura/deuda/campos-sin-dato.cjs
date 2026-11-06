/**
 * El PRESUPUESTO de la deuda de campos sin dato (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`; CLAUDE.md «Sin
 * dato registrado no hay campo»). `arquitectura/deuda/campos-sin-dato.json` dice, por archivo, cuántos campos `dato="pendiente"` y
 * cuántos controles crudos (`<input>`, `<textarea>`, `<select>`) y cuántos tags dinámicos (que no se pueden analizar) tiene todavía. Lo comprueba `test/arquitectura/campos-con-dato.test.ts`
 * (el presupuesto coincide EXACTO con el código); este script comprueba lo otro: que el presupuesto SOLO BAJE contra la rama base.
 *
 * Previene: la deuda registrada por archivo no frena que dentro de un archivo ya listado (Emitir, origen del fallo del CUIT) se
 * sume un campo crudo o un `pendiente` más, ni que se agregue un archivo a la lista junto con un control crudo nuevo: el guardián de
 * deuda solo mira «tipo y archivo» y una excepción vigente cubre el crecimiento. Con este script subir una cuenta, agregar un
 * archivo o aflojar la forma del archivo falla.
 *
 * USO (en el CI, junto a `deuda.cjs`): `node arquitectura/deuda/campos-sin-dato.cjs [--base=<carpeta de la base>]`. Sin `--base` solo
 * valida la forma. Sale 0 si está bien, 1 si hay fallas, 2 si el uso es incorrecto. Si la base todavía no trae el archivo (la primera
 * vez que se incorpora) avisa y sigue; si la base lo trae y no se puede leer, falla (nunca «pasa» porque no se pudo mirar).
 * Solo usa Node: el job del guardián no instala dependencias.
 */
const fs = require("node:fs");
const path = require("node:path");

const ARCHIVO = "arquitectura/deuda/campos-sin-dato.json";
const CLAVES = ["pendientes", "crudos", "dinamicos"];

const esEntero = (valor) => Number.isInteger(valor) && valor >= 0;
const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Problemas de forma del presupuesto: `{ "ruta": { "pendientes": n, "crudos": n, "dinamicos": n } }`, sin archivos en cero ni claves de más. */
function problemasDeForma(presupuesto) {
  if (!esObjeto(presupuesto))
    return [`${ARCHIVO} tiene que ser un objeto { ruta: { pendientes, crudos, dinamicos } }.`];
  const problemas = [];
  for (const [ruta, cuenta] of Object.entries(presupuesto)) {
    if (!esObjeto(cuenta)) {
      problemas.push(`«${ruta}»: tiene que ser { pendientes, crudos, dinamicos }.`);
      continue;
    }
    const claves = Object.keys(cuenta);
    if (claves.length !== CLAVES.length || !CLAVES.every((c) => claves.includes(c))) {
      problemas.push(`«${ruta}»: lleva exactamente ${CLAVES.join(", ")}.`);
    } else if (!CLAVES.every((c) => esEntero(cuenta[c]))) {
      problemas.push(`«${ruta}»: ${CLAVES.join(", ")} son enteros desde 0.`);
    } else if (CLAVES.every((c) => cuenta[c] === 0)) {
      problemas.push(`«${ruta}»: no tiene deuda; sacalo del presupuesto.`);
    }
  }
  return problemas;
}

/** Lo que sube o entra respecto de la base (el presupuesto solo puede bajar). Los dos ya pasaron `problemasDeForma`. */
function problemasContraLaBase(base, pr) {
  const problemas = [];
  for (const [ruta, cuenta] of Object.entries(pr)) {
    const antes = Object.hasOwn(base, ruta) ? base[ruta] : undefined;
    if (antes === undefined) {
      problemas.push(
        `«${ruta}» entra a la deuda de campos sin dato: la base no lo tenía y el presupuesto solo baja.`,
      );
      continue;
    }
    for (const clave of CLAVES) {
      if (cuenta[clave] > antes[clave]) {
        problemas.push(
          `«${ruta}»: ${clave} sube de ${antes[clave]} a ${cuenta[clave]}; el presupuesto solo baja.`,
        );
      }
    }
  }
  return problemas;
}

function leer(carpeta) {
  const ruta = path.join(carpeta, ARCHIVO);
  if (!fs.existsSync(ruta)) return { ausente: true };
  try {
    return { valor: JSON.parse(fs.readFileSync(ruta)) };
  } catch (error) {
    return { error: `${ruta}: no se puede leer (${error.message}).` };
  }
}

/** Corre el control; devuelve `{ codigo, lineas }`. */
function ejecutar(argumentos, raiz) {
  const base = argumentos.filter((a) => a.startsWith("--base="));
  if (argumentos.length !== base.length || base.length > 1) {
    return {
      codigo: 2,
      lineas: ["Uso: node arquitectura/deuda/campos-sin-dato.cjs [--base=<carpeta de la base>]"],
    };
  }
  const delCambio = leer(raiz);
  if (delCambio.ausente) return { codigo: 1, lineas: [`FALLA ${ARCHIVO} no existe.`] };
  if (delCambio.error !== undefined) return { codigo: 1, lineas: [`FALLA ${delCambio.error}`] };
  const fallas = problemasDeForma(delCambio.valor);
  const lineas = [];
  if (base.length === 1) {
    const carpeta = base[0].slice("--base=".length);
    const deLaBase = leer(carpeta);
    if (deLaBase.ausente) {
      lineas.push(
        `AVISO la rama base no trae ${ARCHIVO}: no hay presupuesto anterior contra el que comparar.`,
      );
    } else if (deLaBase.error !== undefined) {
      fallas.push(deLaBase.error);
    } else {
      const formaBase = problemasDeForma(deLaBase.valor);
      if (formaBase.length > 0) fallas.push(...formaBase.map((p) => `Base: ${p}`));
      else if (fallas.length === 0)
        fallas.push(...problemasContraLaBase(deLaBase.valor, delCambio.valor));
    }
  }
  lineas.unshift(...fallas.map((f) => `FALLA ${f}`));
  lineas.push(`Deuda de campos sin dato: ${fallas.length} fallas.`);
  return { codigo: fallas.length > 0 ? 1 : 0, lineas };
}

if (require.main === module) {
  const { codigo, lineas } = ejecutar(process.argv.slice(2), process.cwd());
  for (const linea of lineas) process.stdout.write(`${linea}\n`);
  process.exitCode = codigo;
}

module.exports = { ARCHIVO, ejecutar, problemasContraLaBase, problemasDeForma };
