/**
 * Unidades y declaración de contratos (contratos-arquitectonicos.md §2.3).
 *
 * Una UNIDAD es la porción del repositorio que responde por lo que usa:
 *  - `src/modulos/<m>`  cada módulo de negocio;
 *  - `src/<grupo>`      cada carpeta de primer nivel bajo `src/` que no es `modulos`
 *                       (capacidades, primitivas, puertos, adaptadores, composicion, plataforma…);
 *  - `apps/<a>`         cada aplicación;
 *  - `scripts`, `migraciones`, `workers`  los grupos fijos (si tienen archivos versionados).
 * Se descubren solas desde las rutas versionadas: una unidad nueva aparece sin tocar este archivo y,
 * si no tiene `contratos.json`, el guardián falla.
 *
 * Cada unidad tiene `<unidad>/contratos.json` con `{ "usa": [ids], "noUsa": "motivo" }`:
 *  - al menos uno de los dos; `usa: []` (o sin `usa`) exige un `noUsa` con motivo;
 *  - `usa` con ids exige que existan en el registro;
 *  - `usa` con ids y `noUsa` a la vez es contradictorio y se rechaza.
 */

const GRUPOS_FIJOS = ["scripts", "migraciones", "workers"];
const CAMPOS_PERMITIDOS = ["usa", "noUsa"];
const EJEMPLO =
  '{ "usa": [], "noUsa": "Motivo por el que la unidad no depende de ningún contrato." }';

/**
 * La unidad a la que pertenece una ruta, o `null` si no pertenece a ninguna (config de la raíz,
 * `test/`, `arquitectura/`, `.github/`, documentos sueltos…).
 */
function unidadDe(ruta) {
  const partes = ruta.split("/");
  if (partes[0] === "src") {
    if (partes[1] === "modulos") return partes.length >= 4 ? `src/modulos/${partes[2]}` : null;
    return partes.length >= 3 ? `src/${partes[1]}` : null;
  }
  if (partes[0] === "apps") return partes.length >= 3 ? `apps/${partes[1]}` : null;
  if (GRUPOS_FIJOS.includes(partes[0])) return partes.length >= 2 ? partes[0] : null;
  return null;
}

/** Descubre las unidades a partir de las rutas versionadas: `Map<unidad, rutas[]>` ordenado. */
function descubrirUnidades(rutas) {
  const unidades = new Map();
  for (const ruta of [...rutas].sort()) {
    const unidad = unidadDe(ruta);
    if (unidad === null) continue;
    if (!unidades.has(unidad)) unidades.set(unidad, []);
    unidades.get(unidad).push(ruta);
  }
  return new Map([...unidades.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const archivoDeDeclaracion = (unidad) => `${unidad}/contratos.json`;

const esTextoNoVacio = (valor) => typeof valor === "string" && valor.trim() !== "";

const invalida = (unidad, motivo) => ({
  codigo: "declaracion-invalida",
  archivo: archivoDeDeclaracion(unidad),
  contrato: null,
  motivo: `La declaración de «${unidad}» es inválida: ${motivo}.`,
  correccion: `Dejala con la forma ${EJEMPLO}`,
});

/**
 * Lee y valida el `contratos.json` de cada unidad.
 *
 * @param {Map<string, string[]>} unidades
 * @param {{ rutas: Set<string>, leer: (ruta: string) => Buffer | string | null, idsDeContratos: Set<string> | null }} contexto
 *   (`idsDeContratos: null` salta la comprobación de existencia: se usa cuando el registro no cargó)
 * @returns {{ declaraciones: Map<string, { usa: string[], noUsa: string | null }>, fallas: object[] }}
 */
function leerDeclaraciones(unidades, contexto) {
  const { rutas, leer, idsDeContratos } = contexto;
  const declaraciones = new Map();
  const fallas = [];
  for (const unidad of unidades.keys()) {
    const archivo = archivoDeDeclaracion(unidad);
    const contenido = rutas.has(archivo) ? leer(archivo) : null;
    if (contenido === null) {
      fallas.push({
        codigo: "unidad-sin-declaracion",
        archivo,
        contrato: null,
        motivo: `La unidad «${unidad}» no tiene declaración de contratos.`,
        correccion: `Creá ${archivo} con ${EJEMPLO} (o listá en "usa" los contratos que usa).`,
      });
      continue;
    }
    let datos;
    try {
      datos = JSON.parse(contenido.toString());
    } catch {
      fallas.push(invalida(unidad, "no es JSON válido"));
      continue;
    }
    if (typeof datos !== "object" || datos === null || Array.isArray(datos)) {
      fallas.push(invalida(unidad, "tiene que ser un objeto"));
      continue;
    }
    const problemas = [];
    for (const clave of Object.keys(datos)) {
      if (!CAMPOS_PERMITIDOS.includes(clave))
        problemas.push(`«${clave}» no es un campo permitido (usa, noUsa)`);
    }
    if (datos.usa === undefined && datos.noUsa === undefined) {
      problemas.push("falta «usa» o «noUsa»: hay que declarar al menos uno");
    }
    let usa = [];
    if (datos.usa !== undefined) {
      if (!Array.isArray(datos.usa) || !datos.usa.every(esTextoNoVacio)) {
        problemas.push("«usa» tiene que ser una lista de ids de contrato");
      } else if (new Set(datos.usa).size !== datos.usa.length) {
        problemas.push("«usa» repite un contrato");
      } else {
        usa = datos.usa;
      }
    }
    if (datos.noUsa !== undefined && !esTextoNoVacio(datos.noUsa)) {
      problemas.push("«noUsa» tiene que ser un motivo escrito, no vacío");
    }
    if (Array.isArray(datos.usa) && datos.usa.length === 0 && datos.noUsa === undefined) {
      problemas.push(
        "«usa» está vacío y falta «noUsa»: una unidad sin contratos tiene que explicar por qué",
      );
    }
    if (usa.length > 0 && datos.noUsa !== undefined) {
      problemas.push("declara contratos en «usa» y también «noUsa»: son excluyentes");
    }
    if (problemas.length > 0) {
      for (const problema of problemas) fallas.push(invalida(unidad, problema));
      continue;
    }
    for (const id of usa) {
      if (idsDeContratos !== null && !idsDeContratos.has(id)) {
        fallas.push({
          codigo: "declara-contrato-inexistente",
          archivo,
          contrato: id,
          motivo: `La unidad «${unidad}» declara usar «${id}», que no está en el registro de contratos.`,
          correccion: "Quitá el id de «usa» o corregí su nombre.",
        });
      }
    }
    declaraciones.set(unidad, { usa, noUsa: datos.noUsa ?? null });
  }
  return { declaraciones, fallas };
}

module.exports = { unidadDe, descubrirUnidades, leerDeclaraciones };
