/**
 * Registro de contratos arquitectónicos (contratos-arquitectonicos.md §2.1).
 *
 * Un contrato dice QUÉ protege, DÓNDE está su única fuente de verdad, QUÉ cuenta como infracción,
 * CÓMO se detecta su uso y su definición, y hasta DÓNDE llega esa detección (`limites`). Este módulo
 * define el esquema y lo valida: un contrato con un campo faltante, vacío o mal formado hace FALLAR
 * la carga del registro entero, con el id del contrato en el mensaje. Nunca se ignora un contrato
 * roto: un registro a medias da una falsa sensación de cobertura.
 *
 * Un detector es `{ tipo: "uso" | "definicion", clases: [...], reconoce(contenido, ruta) → [{linea, texto}] }`
 * (más un `nombre` opcional para los mensajes y el informe). `reconoce` es una función pura y
 * determinista: mismo contenido, mismas coincidencias. `linea` cuenta desde 1.
 *  - `uso`: el archivo consume el contrato (lo declara la unidad en su `contratos.json`).
 *  - `definicion`: el archivo DEFINE el valor del contrato; solo puede pasar en `fuenteDeVerdad.archivo`.
 */
const { CLASES } = require("./clasificacion.cjs");

/** El archivo donde vive el registro real: es el archivo de toda falla del registro (la línea es la del id). */
const ARCHIVO_DEL_REGISTRO = "arquitectura/contratos/contratos.cjs";
const TIPOS_DE_DETECTOR = ["uso", "definicion"];
const CAMPOS_DEL_CONTRATO = [
  "id",
  "protege",
  "alcance",
  "fuenteDeVerdad",
  "incumplimiento",
  "deteccion",
  "limites",
  "version",
  "politicaDeCambio",
  "bloqueaDeclaracionFalsa",
];
const CAMPOS_DE_TEXTO = ["protege", "alcance", "incumplimiento", "limites", "politicaDeCambio"];
const PATRON_DE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PATRON_DE_VERSION = /^\d+\.\d+\.\d+$/;

class ErrorDeRegistro extends Error {
  /**
   * @param {{ problema: string, contrato: string | null }[]} detalles Cada problema con el id del
   *   contrato al que pertenece (`null` si el contrato no tiene un id válido o el registro no es una
   *   lista), para que el guardián pueda decir en qué línea de `contratos.cjs` está.
   */
  constructor(detalles) {
    const problemas = detalles.map((detalle) => detalle.problema);
    super(`El registro de contratos es inválido:\n- ${problemas.join("\n- ")}`);
    this.name = "ErrorDeRegistro";
    this.problemas = problemas;
    this.detalles = detalles;
  }
}

const esTextoNoVacio = (valor) => typeof valor === "string" && valor.trim() !== "";
const esObjetoPlano = (valor) =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

function validarFuente(fuente) {
  if (fuente === undefined) return ["falta «fuenteDeVerdad»"];
  if (!esObjetoPlano(fuente))
    return ["«fuenteDeVerdad» tiene que ser un objeto {archivo, exportacion|variable}"];
  const problemas = [];
  for (const clave of Object.keys(fuente)) {
    if (!["archivo", "exportacion", "variable"].includes(clave)) {
      problemas.push(
        `«fuenteDeVerdad.${clave}» no es un campo del esquema (archivo, exportacion o variable)`,
      );
    }
  }
  if (!esTextoNoVacio(fuente.archivo)) {
    problemas.push("«fuenteDeVerdad.archivo» falta o está vacío");
  } else if (
    /[*?{}\\]/.test(fuente.archivo) ||
    fuente.archivo.startsWith("/") ||
    fuente.archivo.includes("..")
  ) {
    problemas.push(
      "«fuenteDeVerdad.archivo» tiene que ser una ruta exacta relativa a la raíz, sin comodines",
    );
  }
  const tieneExportacion = fuente.exportacion !== undefined;
  const tieneVariable = fuente.variable !== undefined;
  if (tieneExportacion === tieneVariable) {
    problemas.push(
      "«fuenteDeVerdad» tiene que traer exactamente uno de «exportacion» o «variable»",
    );
  } else if (!esTextoNoVacio(tieneExportacion ? fuente.exportacion : fuente.variable)) {
    problemas.push(`«fuenteDeVerdad.${tieneExportacion ? "exportacion" : "variable"}» está vacío`);
  }
  return problemas;
}

function validarDetector(detector, posicion) {
  const rotulo = `deteccion[${posicion}]`;
  if (!esObjetoPlano(detector)) return [`«${rotulo}» tiene que ser un objeto`];
  const problemas = [];
  for (const clave of Object.keys(detector)) {
    if (!["tipo", "clases", "reconoce", "nombre"].includes(clave)) {
      problemas.push(
        `«${rotulo}.${clave}» no es un campo del detector (tipo, clases, reconoce, nombre)`,
      );
    }
  }
  if (!TIPOS_DE_DETECTOR.includes(detector.tipo)) {
    problemas.push(`«${rotulo}.tipo» tiene que ser «uso» o «definicion»`);
  }
  if (!Array.isArray(detector.clases) || detector.clases.length === 0) {
    problemas.push(`«${rotulo}.clases» falta o está vacío`);
  } else {
    for (const clase of detector.clases) {
      if (!CLASES.includes(clase)) {
        problemas.push(`«${rotulo}.clases» menciona la clase «${String(clase)}», que no existe`);
      }
    }
    if (new Set(detector.clases).size !== detector.clases.length) {
      problemas.push(`«${rotulo}.clases» repite una clase`);
    }
  }
  if (typeof detector.reconoce !== "function") {
    problemas.push(
      `«${rotulo}.reconoce» tiene que ser una función (contenido, ruta) → [{linea, texto}]`,
    );
  }
  if (detector.nombre !== undefined && !esTextoNoVacio(detector.nombre)) {
    problemas.push(`«${rotulo}.nombre» está vacío`);
  }
  return problemas;
}

/**
 * Devuelve la lista de problemas de UN contrato (vacía si es válido).
 * @param {unknown} contrato
 * @returns {string[]}
 */
function problemasDelContrato(contrato) {
  if (!esObjetoPlano(contrato)) return ["no es un objeto"];
  const problemas = [];
  for (const clave of Object.keys(contrato)) {
    if (!CAMPOS_DEL_CONTRATO.includes(clave)) {
      problemas.push(`«${clave}» no es un campo del esquema`);
    }
  }
  if (!esTextoNoVacio(contrato.id)) {
    problemas.push("«id» falta o está vacío");
  } else if (!PATRON_DE_ID.test(contrato.id)) {
    problemas.push(
      "«id» tiene que ser minúsculas, números y guiones (p. ej. «color-de-separadores»)",
    );
  }
  for (const campo of CAMPOS_DE_TEXTO) {
    if (contrato[campo] === undefined) problemas.push(`falta «${campo}»`);
    else if (!esTextoNoVacio(contrato[campo]))
      problemas.push(`«${campo}» está vacío o no es texto`);
  }
  if (contrato.version === undefined) problemas.push("falta «version»");
  else if (!esTextoNoVacio(contrato.version) || !PATRON_DE_VERSION.test(contrato.version)) {
    problemas.push("«version» tiene que ser texto con forma MAYOR.MENOR.PARCHE (p. ej. «1.0.0»)");
  }
  problemas.push(...validarFuente(contrato.fuenteDeVerdad));
  if (contrato.deteccion === undefined) {
    problemas.push("falta «deteccion»");
  } else if (!Array.isArray(contrato.deteccion) || contrato.deteccion.length === 0) {
    problemas.push("«deteccion» tiene que ser una lista con al menos un detector");
  } else {
    contrato.deteccion.forEach((detector, posicion) =>
      problemas.push(...validarDetector(detector, posicion)),
    );
    if (!contrato.deteccion.some((d) => esObjetoPlano(d) && d.tipo === "uso")) {
      problemas.push(
        "«deteccion» necesita al menos un detector de tipo «uso»: sin él no se puede comprobar qué unidades lo usan",
      );
    }
  }
  if (contrato.bloqueaDeclaracionFalsa === undefined) {
    problemas.push("falta «bloqueaDeclaracionFalsa»");
  } else if (typeof contrato.bloqueaDeclaracionFalsa !== "boolean") {
    problemas.push("«bloqueaDeclaracionFalsa» tiene que ser verdadero o falso");
  }
  return problemas;
}

/**
 * Valida y carga el registro. Lanza `ErrorDeRegistro` (con TODOS los problemas) si algo falla.
 *
 * @param {unknown} lista
 * @returns {{ contratos: object[], porId: Map<string, object> }}
 */
function cargarRegistro(lista) {
  if (!Array.isArray(lista)) {
    throw new ErrorDeRegistro([
      { problema: "el registro tiene que ser una lista de contratos", contrato: null },
    ]);
  }
  const detalles = [];
  const vistos = new Set();
  lista.forEach((contrato, posicion) => {
    const id = esObjetoPlano(contrato) && esTextoNoVacio(contrato.id) ? contrato.id : null;
    const rotulo = id === null ? `Contrato #${posicion + 1} (sin id válido)` : `Contrato «${id}»`;
    for (const problema of problemasDelContrato(contrato)) {
      detalles.push({ problema: `${rotulo}: ${problema}`, contrato: id });
    }
    if (id !== null) {
      if (vistos.has(id))
        detalles.push({ problema: `${rotulo}: el id está repetido`, contrato: id });
      vistos.add(id);
    }
  });
  if (detalles.length > 0) throw new ErrorDeRegistro(detalles);
  return { contratos: lista, porId: new Map(lista.map((contrato) => [contrato.id, contrato])) };
}

module.exports = { ARCHIVO_DEL_REGISTRO, cargarRegistro, ErrorDeRegistro };
