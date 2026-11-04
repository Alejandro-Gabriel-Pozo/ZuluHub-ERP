/**
 * Las ENTRADAS del libro de deuda y su configuración (contratos-arquitectonicos.md §10, G5): qué forma tiene cada
 * entrada de `registro.json` y qué trae `configuracion.json`. Es puro: lee archivos con la función que le dan.
 *
 * Los tipos son los marcadores de `marcadores.cjs` y los hallazgos que ninguna máquina detecta (`auditoria`,
 * `backlog`, `intermitente`, `riesgo-aceptado`, `brecha`). Una entrada de marcador lleva UN solo archivo (una
 * entrada por tipo y archivo); la de `archivo-grande` lleva además el `tamano` registrado: el trinquete.
 */
const { esRutaExacta } = require("../contratos/globs.cjs");
const { TIPOS_DE_MARCADOR } = require("./marcadores.cjs");
const { enJson } = require("../contratos/ubicacion.cjs");
const { TOPE_DE_LINEAS } = require("./tamano.cjs");

const ARCHIVO_DEL_REGISTRO = "arquitectura/deuda/registro.json";
const ARCHIVO_DE_LA_CONFIGURACION = "arquitectura/deuda/configuracion.json";
const CONTRATO = "deuda";
const TIPOS_DE_HALLAZGO = Object.freeze([
  "auditoria",
  "backlog",
  "intermitente",
  "riesgo-aceptado",
  "brecha",
]);
const TIPOS = Object.freeze([...TIPOS_DE_MARCADOR, ...TIPOS_DE_HALLAZGO]);

const CAMPOS_DE_EXCEPCION = Object.freeze(["motivo", "aprobadoPor", "vence"]);
const CAMPOS_PERMITIDOS = Object.freeze([
  "id",
  "archivos",
  "descripcion",
  "tipo",
  "responsable",
  "creada",
  "verificacion",
  "tamano",
  ...CAMPOS_DE_EXCEPCION,
]);
const CLAVES_DE_LA_CONFIGURACION = Object.freeze([
  "topeDeExcepciones",
  "bloqueaDeudaEnArchivoTocado",
  "topeDeLineasPorArchivo",
  "excluidosDelTope",
]);
/** Con una configuración inválida el control falla igual: se sigue con estos valores para no sumar ruido. */
const CONFIGURACION_POR_DEFECTO = Object.freeze({
  topeDeExcepciones: 10,
  bloqueaDeudaEnArchivoTocado: false,
  topeDeLineasPorArchivo: TOPE_DE_LINEAS,
  excluidosDelTope: Object.freeze([]),
});

const esTexto = (valor) => typeof valor === "string" && valor.trim() !== "";
/** Un tamaño registrado: un entero de líneas, desde 1. */
const esTamano = (valor) => Number.isInteger(valor) && valor >= 1;
const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);
/** Lee y parsea un JSON del árbol: `{ valor }`, `{ ausente: true }` o `{ error }`. */
function leerJson(leer, archivo) {
  const contenido = leer(archivo);
  if (contenido === null) return { ausente: true };
  try {
    return { valor: JSON.parse(contenido.toString()) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Las exclusiones del tope de líneas: una lista de `{ ruta, motivo }` (ruta exacta y motivo escrito). Lo que no
 * tiene esa forma se informa con `invalida` y no se cuenta.
 */
function leerExcluidos(valor, invalida) {
  if (!Array.isArray(valor)) {
    invalida(
      "`excluidosDelTope` tiene que ser una lista de { ruta, motivo } (vacía si no hay exclusiones).",
      enJson("excluidosDelTope"),
    );
    return CONFIGURACION_POR_DEFECTO.excluidosDelTope;
  }
  const validos = [];
  valor.forEach((elemento, indice) => {
    const donde = (campo) =>
      campo === undefined
        ? enJson("excluidosDelTope", indice)
        : enJson("excluidosDelTope", indice, campo);
    if (!esObjeto(elemento)) {
      invalida(`La exclusión ${indice + 1} no es un objeto { ruta, motivo }.`, donde());
      return;
    }
    for (const clave of Object.keys(elemento)) {
      if (clave !== "ruta" && clave !== "motivo") {
        invalida(
          `La exclusión ${indice + 1} trae «${clave}», que no es un campo permitido.`,
          donde(clave),
        );
      }
    }
    const rutaValida = esTexto(elemento.ruta) && esRutaExacta(elemento.ruta);
    if (!rutaValida) {
      invalida(
        `La exclusión ${indice + 1} tiene que nombrar un archivo con su ruta exacta (sin comodines ni carpetas).`,
        donde("ruta"),
      );
    }
    if (!esTexto(elemento.motivo)) {
      invalida(`La exclusión ${indice + 1} no dice su motivo.`, donde("motivo"));
    }
    if (rutaValida && validos.some((otro) => otro.ruta === elemento.ruta)) {
      invalida(`La exclusión ${indice + 1} repite «${elemento.ruta}».`, donde("ruta"));
    } else if (rutaValida && esTexto(elemento.motivo)) {
      validos.push({ ruta: elemento.ruta, motivo: elemento.motivo });
    }
  });
  return validos;
}

/** La configuración del árbol y sus fallas (con la de por defecto si no es válida). */
function leerConfiguracion(leer) {
  const leida = leerJson(leer, ARCHIVO_DE_LA_CONFIGURACION);
  const fallas = [];
  const invalida = (motivo, donde) =>
    fallas.push({
      codigo: "deuda-configuracion-invalida",
      archivo: ARCHIVO_DE_LA_CONFIGURACION,
      contrato: CONTRATO,
      motivo,
      correccion:
        "Dejá un objeto con `topeDeExcepciones` (entero ≥ 0), `bloqueaDeudaEnArchivoTocado` (true o false), `topeDeLineasPorArchivo` (entero ≥ 1) y `excluidosDelTope` (lista de { ruta, motivo }).",
      donde,
    });
  if (leida.ausente === true) {
    invalida(
      "No existe configuracion.json: sin él no hay tope de excepciones, regla de bloqueo ni tope de líneas.",
      enJson(),
    );
    return { configuracion: CONFIGURACION_POR_DEFECTO, fallas };
  }
  if (leida.error !== undefined) {
    invalida(`configuracion.json no es JSON válido (${leida.error}).`, enJson());
    return { configuracion: CONFIGURACION_POR_DEFECTO, fallas };
  }
  const { valor } = leida;
  if (!esObjeto(valor)) {
    invalida("configuracion.json tiene que ser un objeto.", enJson());
    return { configuracion: CONFIGURACION_POR_DEFECTO, fallas };
  }
  for (const clave of Object.keys(valor)) {
    if (!CLAVES_DE_LA_CONFIGURACION.includes(clave)) {
      invalida(`«${clave}» no es una opción de configuracion.json.`, enJson(clave));
    }
  }
  const {
    topeDeExcepciones: tope,
    bloqueaDeudaEnArchivoTocado: bloquea,
    topeDeLineasPorArchivo: lineas,
  } = valor;
  const topeValido = Number.isInteger(tope) && tope >= 0;
  const bloqueaValido = typeof bloquea === "boolean";
  const lineasValido = Number.isInteger(lineas) && lineas >= 1;
  if (!topeValido) {
    invalida(
      "`topeDeExcepciones` tiene que ser un entero mayor o igual que 0.",
      enJson("topeDeExcepciones"),
    );
  }
  if (!bloqueaValido) {
    invalida(
      "`bloqueaDeudaEnArchivoTocado` tiene que ser true o false.",
      enJson("bloqueaDeudaEnArchivoTocado"),
    );
  }
  if (!lineasValido) {
    invalida(
      "`topeDeLineasPorArchivo` tiene que ser un entero mayor o igual que 1.",
      enJson("topeDeLineasPorArchivo"),
    );
  }
  const excluidos = leerExcluidos(valor.excluidosDelTope, invalida);
  return {
    configuracion: {
      topeDeLineasPorArchivo: lineasValido
        ? lineas
        : CONFIGURACION_POR_DEFECTO.topeDeLineasPorArchivo,
      excluidosDelTope: excluidos,
      topeDeExcepciones: topeValido ? tope : CONFIGURACION_POR_DEFECTO.topeDeExcepciones,
      bloqueaDeudaEnArchivoTocado: bloqueaValido
        ? bloquea
        : CONFIGURACION_POR_DEFECTO.bloqueaDeudaEnArchivoTocado,
    },
    fallas,
  };
}

/** Los problemas de forma de una entrada: `{ campo?, motivo, correccion }`, y si registra algo (tipo y archivos válidos). */
function formaDeLaEntrada(entrada, idsVistos) {
  const problemas = [];
  const nuevo = (campo, motivo, correccion) => problemas.push({ campo, motivo, correccion });
  for (const clave of Object.keys(entrada)) {
    if (!CAMPOS_PERMITIDOS.includes(clave)) {
      nuevo(
        clave,
        `«${clave}» no es un campo permitido.`,
        `Dejá solo: ${CAMPOS_PERMITIDOS.join(", ")}.`,
      );
    }
  }
  if (!esTexto(entrada.descripcion)) {
    nuevo(
      "descripcion",
      "falta la descripción (qué es la deuda).",
      "Escribí qué es y por qué se acepta.",
    );
  }
  let registra = true;
  if (!TIPOS.includes(entrada.tipo)) {
    registra = false;
    nuevo(
      "tipo",
      `el tipo «${String(entrada.tipo)}» no existe.`,
      `Elegí uno de: ${TIPOS.join(", ")}.`,
    );
  }
  const { archivos } = entrada;
  if (
    !Array.isArray(archivos) ||
    archivos.length === 0 ||
    !archivos.every((a) => esTexto(a) && esRutaExacta(a))
  ) {
    registra = false;
    nuevo(
      "archivos",
      "«archivos» tiene que ser una lista de rutas exactas (archivos, sin carpetas ni comodines).",
      "Listá los archivos con su ruta completa desde la raíz.",
    );
  } else if (new Set(archivos).size !== archivos.length) {
    registra = false;
    nuevo("archivos", "«archivos» repite un archivo.", "Listá cada archivo una sola vez.");
  } else if (TIPOS_DE_MARCADOR.includes(entrada.tipo) && archivos.length !== 1) {
    registra = false;
    nuevo(
      "archivos",
      `un marcador «${entrada.tipo}» se registra por archivo: la entrada lleva exactamente uno.`,
      "Una entrada por tipo y archivo.",
    );
  }
  const { verificacion } = entrada;
  if (verificacion !== undefined) {
    const forma =
      esObjeto(verificacion) &&
      Object.keys(verificacion).join() === "contiene" &&
      esTexto(verificacion.contiene);
    if (!TIPOS_DE_HALLAZGO.includes(entrada.tipo)) {
      nuevo(
        "verificacion",
        "solo un hallazgo lleva «verificacion»: un marcador lo verifica el detector.",
        "Sacala.",
      );
    } else if (!forma) {
      nuevo("verificacion", '«verificacion» es `{ "contiene": "texto" }`.', "Corregí su forma.");
    }
  }
  const { tamano } = entrada;
  if (entrada.tipo === "archivo-grande") {
    if (!esTamano(tamano)) {
      nuevo(
        "tamano",
        "un «archivo-grande» registra su tamaño: «tamano» es un entero (líneas) mayor o igual que 1.",
        "Poné las líneas que mide hoy el archivo.",
      );
    }
  } else if (tamano !== undefined) {
    nuevo("tamano", "solo un «archivo-grande» lleva «tamano».", "Sacalo.");
  }
  if (esTexto(entrada.id)) {
    if (idsVistos.has(entrada.id))
      nuevo("id", `el id «${entrada.id}» está repetido.`, "Cada entrada lleva un id propio.");
    idsVistos.add(entrada.id);
  }
  return { problemas, registra };
}

module.exports = {
  ARCHIVO_DE_LA_CONFIGURACION,
  ARCHIVO_DEL_REGISTRO,
  CAMPOS_DE_EXCEPCION,
  CONTRATO,
  TIPOS,
  TIPOS_DE_HALLAZGO,
  esObjeto,
  esTamano,
  esTexto,
  formaDeLaEntrada,
  leerConfiguracion,
  leerJson,
};
