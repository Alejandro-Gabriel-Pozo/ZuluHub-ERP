/**
 * Detector de marcadores de deuda técnica (contratos-arquitectonicos.md §10, G5).
 *
 * Dado el texto de un archivo, dice QUÉ marcadores de deuda tiene y en QUÉ LÍNEA. Es puro: recibe la ruta y
 * el texto, no toca el disco ni el reloj.
 *
 * QUÉ ARCHIVOS ANALIZA (y por qué). Por la extensión de la ruta; el resto no se mira:
 *  - `js`    .ts .tsx .mts .cts .js .jsx .mjs .cjs: comentarios y código (pruebas saltadas);
 *  - `jsonc` .json (puede traer comentarios: `knip.json`, `tsconfig.json`): comentarios y datos de los
 *            archivos de configuración de la deuda (ver `ESPECIALES`);
 *  - `css` .css, `sql` .sql, `hash` .yml .yaml .toml: comentarios (y `continue-on-error` en los .yml).
 * Quedan SIN analizar a propósito: `.md` y `.txt` (documentación: ahí «TODO» es prosa y ninguna herramienta
 * lee un marcador), los archivos de bloqueo, los binarios y los `.xml`/`.svg` (datos). Un marcador movido a uno
 * de esos archivos deja de verse: es un límite declarado, no una garantía.
 *
 * CÓMO NO SE CONFUNDE CON TEXTO. Un analizador léxico mínimo separa los comentarios del código y de los
 * literales: un marcador dentro de un string, de una plantilla o de una expresión regular NO cuenta (así
 * el texto del propio detector y las pruebas con repositorios de juguete no se marcan a sí mismos), y una
 * prueba saltada se busca solo en el código, nunca en un comentario o en un texto. Un comentario es marcador
 * solo si SU TEXTO EMPIEZA con la marca (como las lee cada herramienta): `eslint-disable…`, `@ts-ignore`,
 * `@ts-expect-error`, `@ts-nocheck`, `FIXME`/`HACK`/`XXX` en mayúscula, y `TODO` (o cualquiera de las cuatro en
 * cualquier capitalización) seguido de `:`, de `(` o solo en la línea. En español «TODO» es una palabra común:
 * «TODO junto…» o «cubre TODO: conexión…» (en medio de una frase) no son marcadores.
 *
 * LÍMITES (se dicen, no se esconden): el analizador no es un parser (una expresión regular o un apóstrofe en
 * texto de JSX pueden confundirlo hasta el fin de la línea); una marca escrita en medio de un comentario, o
 * en un archivo que no se analiza, no se ve; y el detector no distingue una supresión deliberada y
 * justificada (p. ej. una prueba de tipos con `@ts-expect-error`) de una deuda: ambas son marcadores.
 */
const { analizarJson } = require("../contratos/ubicacion.cjs");
const { ESPECIALES } = require("./archivos-de-datos.cjs");
const { OPCIONES_POR_DEFECTO, tamanoExcedido } = require("./tamano.cjs");

/** Tipo de marcador → qué es. El orden es el del informe. */
const DESCRIPCION_DE_MARCADORES = Object.freeze({
  "eslint-disable": "comentario que apaga una regla de ESLint",
  "ts-ignore": "comentario `@ts-ignore` (silencia un error de tipos sin verificar que exista)",
  "ts-expect-error": "comentario `@ts-expect-error` (silencia un error de tipos)",
  "ts-nocheck": "comentario `@ts-nocheck` (apaga la verificación de tipos del archivo)",
  todo: "comentario TODO, FIXME, HACK o XXX",
  "prueba-saltada":
    "prueba saltada, pendiente, exclusiva o condicional (skip, todo, only, skipIf…)",
  "knip-ignora":
    "entrada de `ignore*` en knip.json (código muerto o dependencia que se deja pasar)",
  "excepcion-del-guardian": "entrada de excepciones.json o exclusiones.json del guardián",
  "mutacion-sin-filtro": "grupo de mutación sin `pruebas` (cada mutante corre toda la suite)",
  "continue-on-error": "paso o job de CI que deja pasar un fallo (`continue-on-error`)",
  "archivo-grande":
    "archivo de código que pasa del tope de líneas (se registra con su tamaño y no puede crecer)",
});
const TIPOS_DE_MARCADOR = Object.freeze(Object.keys(DESCRIPCION_DE_MARCADORES));

/**
 * Cómo se analiza cada familia de archivos: delimitador de comentario de línea (o `null`), si hay comentarios
 * de bloque, qué comillas abren un texto, y si hay plantillas con `${…}` y expresiones regulares.
 */
const FAMILIAS = Object.freeze({
  js: { linea: "//", bloque: true, comillas: "'\"", plantillas: true, regex: true },
  jsonc: { linea: "//", bloque: true, comillas: '"', plantillas: false, regex: false },
  css: { linea: null, bloque: true, comillas: "'\"", plantillas: false, regex: false },
  sql: { linea: "--", bloque: true, comillas: "'\"", plantillas: false, regex: false },
  hash: { linea: "#", bloque: false, comillas: "'\"", plantillas: false, regex: false },
});
const FAMILIA_POR_EXTENSION = Object.freeze({
  ".ts": "js",
  ".tsx": "js",
  ".mts": "js",
  ".cts": "js",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "jsonc",
  ".css": "css",
  ".sql": "sql",
  ".yml": "hash",
  ".yaml": "hash",
  ".toml": "hash",
});

/** La familia de una ruta por su extensión (en minúsculas), o `null` si no se analiza. */
function familiaDe(ruta) {
  // Sin punto, el corte es el último carácter; con una `/` después del punto, trae la `/`: ninguna es una extensión.
  return FAMILIA_POR_EXTENSION[ruta.slice(ruta.lastIndexOf(".")).toLowerCase()] ?? null;
}

const ES_DE_IDENTIFICADOR = /[A-Za-z0-9_$]/;
/** Un `/` después de alguno de estos caracteres abre una expresión regular; después de otro, es una división. */
const ANTES_DE_UNA_REGEX = new Set([..."(,=:[!&|?{};+-*%^~"]);
const PALABRAS_ANTES_DE_UNA_REGEX = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "delete",
  "void",
  "throw",
  "new",
  "else",
  "do",
  "yield",
  "await",
]);

/** Dónde termina (sin incluir) el texto entre comillas que empieza en `desde`; un texto sin cerrar corta en el salto de línea. */
function finDelTexto(texto, desde) {
  const comilla = texto[desde];
  let i = desde + 1;
  while (texto[i] !== undefined) {
    const c = texto[i];
    if (c === "\\") i += 2;
    else if (c === comilla) return i + 1;
    else if (c === "\n") return i;
    else i += 1;
  }
  return texto.length;
}

/** Dónde termina (sin incluir) la expresión regular que empieza en `desde`, o `null` si no cierra en la línea. */
function finDeLaRegex(texto, desde) {
  let enClase = false;
  let i = desde + 1;
  while (texto[i] !== undefined && texto[i] !== "\n") {
    const c = texto[i];
    if (c === "\\") i += 1;
    else if (c === "[") enClase = true;
    else if (c === "]") enClase = false;
    else if (c === "/" && !enClase) {
      i += 1;
      while (/[a-z]/.test(texto[i] ?? "")) i += 1;
      return i;
    }
    i += 1;
  }
  return null;
}

/**
 * Separa el texto en comentarios, código y literales (un solo recorrido).
 *
 * @returns {{
 *   comentarios: { linea: number, texto: string }[],
 *   codigo: string,
 *   visible: string,
 * }} `comentarios`: uno por LÍNEA de cada comentario (los de bloque se parten), sin su delimitador;
 *   `codigo`: el texto con comentarios y literales reemplazados por espacios (los saltos de línea quedan,
 *   así las líneas coinciden con las del original); `visible`: el texto con solo los comentarios en blanco.
 */
function lexico(texto, familia) {
  const f = FAMILIAS[familia];
  const comentarios = [];
  const codigo = [];
  const visible = [];
  let i = 0;
  let linea = 1;
  let regexPermitido = true; // ¿un `/` ahora abre una expresión regular? (al empezar, sí)
  let palabra = null; // identificador en curso, o el último completo si desde entonces solo hubo blancos
  let enPalabra = false; // el carácter anterior era parte de un identificador

  /** Pasa el texto hasta `fin` (sin incluir) a las dos salidas, en blanco lo que no corresponde. */
  const avanzar = (fin, enCodigo, enVisible) => {
    for (; i < fin; i += 1) {
      const c = texto[i];
      const blanco = c === "\n" ? c : " ";
      codigo.push(enCodigo ? c : blanco);
      visible.push(enVisible ? c : blanco);
      if (c === "\n") linea += 1;
    }
  };
  /** Un literal (texto, plantilla, regex) cuenta como un valor para decidir si un `/` siguiente divide. */
  const comoValor = () => {
    regexPermitido = false;
    palabra = null;
    enPalabra = false;
  };
  /** ¿El `#` en `k` está al principio del texto o después de un blanco? (el `#` pegado a una palabra no comenta). */
  const despuesDeUnBlanco = (k) => texto[k - 1] === undefined || /\s/.test(texto[k - 1]);
  /** Consume el cuerpo de una plantilla desde `i` hasta su cierre; cada `${…}` vuelve a recorrer código. */
  const plantilla = () => {
    while (texto[i] !== undefined) {
      const c = texto[i];
      if (c === "\\") {
        avanzar(Math.min(i + 2, texto.length), false, true);
      } else if (c === "`") {
        avanzar(i + 1, false, true);
        comoValor();
        return;
      } else if (c === "$" && texto[i + 1] === "{") {
        avanzar(i + 2, false, true);
        regexPermitido = true;
        palabra = null;
        enPalabra = false;
        recorrer(true); // vuelve en el `}` que lo cierra (o al final): el cuerpo sigue desde ahí
      } else {
        avanzar(i + 1, false, true);
      }
    }
  };
  /** Recorre código desde `i`. Dentro de un `${`, termina en el `}` que lo cierra, sin consumirlo. */
  const recorrer = (enInterpolacion) => {
    let llaves = 0; // `{` propias abiertas dentro de la interpolación
    while (texto[i] !== undefined) {
      const c = texto[i];
      const finDeUnaRegex =
        f.regex && c === "/" && (regexPermitido || PALABRAS_ANTES_DE_UNA_REGEX.has(palabra))
          ? finDeLaRegex(texto, i)
          : null;
      if (
        f.linea !== null &&
        texto.startsWith(f.linea, i) &&
        (f.linea !== "#" || despuesDeUnBlanco(i))
      ) {
        const salto = texto.indexOf("\n", i);
        const fin = salto === -1 ? texto.length : salto;
        comentarios.push({ linea, texto: texto.slice(i + f.linea.length, fin) });
        avanzar(fin, false, false);
      } else if (f.bloque && texto.startsWith("/*", i)) {
        const cierre = texto.indexOf("*/", i + 2);
        const fin = cierre === -1 ? texto.length : cierre + 2;
        texto
          .slice(i + 2, cierre === -1 ? texto.length : cierre)
          .split("\n")
          .forEach((parte, k) => comentarios.push({ linea: linea + k, texto: parte }));
        avanzar(fin, false, false);
      } else if (f.comillas.includes(c)) {
        avanzar(finDelTexto(texto, i), false, true);
        comoValor();
      } else if (f.plantillas && c === "`") {
        avanzar(i + 1, false, true);
        plantilla();
      } else if (enInterpolacion && c === "}" && llaves === 0) {
        return;
      } else if (finDeUnaRegex !== null) {
        avanzar(finDeUnaRegex, false, true);
        comoValor();
      } else {
        if (c === "{") llaves += 1;
        else if (c === "}") llaves -= 1;
        if (ES_DE_IDENTIFICADOR.test(c)) {
          palabra = enPalabra ? palabra + c : c;
          enPalabra = true;
          regexPermitido = false;
        } else if (/\s/.test(c)) {
          enPalabra = false;
        } else {
          palabra = null;
          enPalabra = false;
          regexPermitido = ANTES_DE_UNA_REGEX.has(c);
        }
        avanzar(i + 1, true, true);
      }
    }
  };
  recorrer(false);
  return { comentarios, codigo: codigo.join(""), visible: visible.join("") };
}

const PREFIJO_DE_UN_COMENTARIO = /^[\s*/#]+/;
const ES_ESLINT = /^eslint-disable/i;
const ES_TS = /^@ts-(ignore|expect-error|nocheck)\b/i;
const ES_MARCA_SIN_PUNTUACION = /^(?:FIXME|HACK|XXX)\b/;
const ES_TODO_CON_PUNTUACION = /^(?:todo|fixme|hack|xxx)\s*(?:[:(]|$)/i;

/** El tipo de marcador que es una línea de comentario (ya sin su delimitador), o `null`. */
function tipoDeComentario(texto) {
  const cuerpo = texto.replace(PREFIJO_DE_UN_COMENTARIO, "");
  if (ES_ESLINT.test(cuerpo)) return "eslint-disable";
  const ts = ES_TS.exec(cuerpo);
  if (ts !== null) return `ts-${ts[1].toLowerCase()}`;
  if (ES_MARCA_SIN_PUNTUACION.test(cuerpo) || ES_TODO_CON_PUNTUACION.test(cuerpo)) return "todo";
  return null;
}

/**
 * Una prueba saltada, pendiente o exclusiva: `skip`, `todo`, `only` (con cualquier modificador delante) y los
 * alias de jest. Es el patrón de M4 (`verificar-mecanismo.cjs`) SIN las pruebas condicionales (`skipIf`,
 * `runIf`): esas son el interruptor deliberado de las pruebas de integración cuando no hay base de datos, no un
 * marcador de deuda (el riesgo de que se salteen en silencio es otro hallazgo del backlog).
 */
const ES_PRUEBA_SALTADA =
  /\b(?:describe|it|test|suite)(?:\.[A-Za-z]+)*\.(?:skip|todo|only)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|\b(?:ctx|context|task)\.skip\s*\(/;
const ES_CONTINUE_ON_ERROR = /\bcontinue-on-error\s*:/;
const ES_YAML = /\.ya?ml$/i; // (los .yml y .yaml son de la familia `hash`; el .toml no cuenta)

/**
 * Los marcadores de un archivo.
 *
 * @param {string} ruta Relativa a la raíz, con `/`.
 * @param {string} texto Contenido (UTF-8).
 * @param {{ topeDeLineas: number, excluidos: ReadonlySet<string> }} [opciones] El tope de líneas por archivo y las
 *   rutas que no se miden (de `configuracion.json`).
 * @returns {{
 *   marcadores: { tipo: string, linea: number, tamano?: number }[],
 *   ilegible: { linea: number, motivo: string } | null,
 * }} `marcadores` ordenados por línea; `ilegible` si es un archivo de datos que no se pudo leer (no hay
 *   forma de contar sus entradas: el control falla en vez de decir que no hay nada).
 */
function detectar(ruta, texto, opciones = OPCIONES_POR_DEFECTO) {
  const familia = familiaDe(ruta);
  if (familia === null) return { marcadores: [], ilegible: null };
  const { comentarios, codigo, visible } = lexico(texto.replace(/^\uFEFF/, ""), familia);
  const marcadores = [];
  for (const { linea, texto: cuerpo } of comentarios) {
    const tipo = tipoDeComentario(cuerpo);
    if (tipo !== null) marcadores.push({ tipo, linea });
  }
  const lineasDeCodigo = codigo.split("\n");
  for (const [posicion, renglon] of lineasDeCodigo.entries()) {
    const linea = posicion + 1;
    if (familia === "js" && ES_PRUEBA_SALTADA.test(renglon)) {
      marcadores.push({ tipo: "prueba-saltada", linea });
    }
    if (ES_YAML.test(ruta) && ES_CONTINUE_ON_ERROR.test(renglon)) {
      marcadores.push({ tipo: "continue-on-error", linea });
    }
  }
  const grande = tamanoExcedido(ruta, texto, opciones);
  if (grande !== null) marcadores.push({ tipo: "archivo-grande", ...grande });
  let ilegible = null;
  const especial = ESPECIALES.find((candidato) => candidato.coincide(ruta));
  if (especial !== undefined) {
    const arbol = analizarJson(visible);
    if (arbol.error === undefined) {
      for (const linea of especial.lineas(arbol.raiz, JSON.parse(visible))) {
        marcadores.push({ tipo: especial.tipo, linea });
      }
    } else {
      ilegible = { linea: arbol.error, motivo: "no es JSON válido" };
    }
  }
  marcadores.sort((a, b) => a.linea - b.linea); // estable: en la misma línea, el orden en que se hallaron
  return { marcadores, ilegible };
}

module.exports = {
  DESCRIPCION_DE_MARCADORES,
  TIPOS_DE_MARCADOR,
  detectar,
  familiaDe,
  lexico,
  tipoDeComentario,
};
