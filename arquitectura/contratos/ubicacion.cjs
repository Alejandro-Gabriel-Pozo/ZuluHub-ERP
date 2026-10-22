/**
 * Dónde está cada falla: archivo Y línea (contratos-arquitectonicos.md §2.5 y §4, meta-invariante M3).
 *
 * Es el ÚNICO lugar donde se calcula una línea que no viene del código analizado. Los chequeos no
 * calculan líneas: dicen DÓNDE buscar con un descriptor (`donde`) y `crearUbicador` lo resuelve leyendo
 * el archivo con la misma función `leer` con la que el guardián lee el repositorio. Las reglas, por
 * tipo de falla, están en `REGLAS_DE_LINEA` (una por código de falla; una prueba exige que no falte ni
 * sobre ninguna) y valen así:
 *
 *  (a) Falla dentro de un JSON (declaración `contratos.json`, `excepciones.json`, `exclusiones.json`):
 *      la línea de la CLAVE ofensora (`"usa"`, `"noUsa"`, `"vence"`, `"id"`…) o del elemento de la lista
 *      (un id dentro de `"usa"`). Si la clave no existe (el campo falta) es la línea del objeto que la
 *      contiene. JSON inválido: la línea donde el analizador encuentra el error (en el final del texto,
 *      la de su último carácter); archivo vacío, ilegible o sin texto: 1.
 *  (b) Declaración AUSENTE: el archivo es el que habría que crear y la línea es 1.
 *  (c) Ruta sin clase, ambigua, ilegible o con código en una clase excluida: el archivo es la ruta y la
 *      línea es 1.
 *  (d) Falla del registro de contratos (`contratos.cjs`): la línea de `id: "<id>"` del contrato; si no
 *      está (contrato sin id, registro que no es una lista) es 1.
 *  (e) Falla de alcance global (clase esperada sin rutas, tabla de clasificación inválida): archivo
 *      `clasificacion.cjs` y la línea de la regla de esa clase (`clase: "<clase>"`) o 1.
 *  (f) Hallazgos del código analizado (usos, definiciones): la línea real del detector.
 *
 * Un hallazgo que ya trae `linea` la conserva. Uno que no la trae ni dice dónde buscarla queda SIN
 * línea, y la autocomprobación de `guardian.cjs` lo convierte en una falla propia («falla sin
 * ubicación»): así M3 no depende de la memoria de quien agrega un chequeo.
 */

const enArchivo = () => ({ tipo: "archivo" });
/** La clave (o el elemento) del JSON al que lleva `camino`: p. ej. `enJson(2, "vence")`, `enJson("usa", 0)`. */
const enJson = (...camino) => ({ tipo: "json", camino });
/** La primera línea del archivo que contiene el texto; 1 si no está. */
const enTexto = (texto) => ({ tipo: "texto", texto });
/** Regla (d): la línea de `id: "<id>"` en el registro. Sin id (`null`) o si no está, la línea 1. */
const enContrato = (id) => (id === null ? enArchivo() : enTexto(`id: "${id}"`));

/** Regla de línea de cada código de falla (en el informe, `reglasEjecutadas.chequeos`). */
const REGLAS_DE_LINEA = Object.freeze({
  "sin-rutas": "(e) clasificacion.cjs: línea de la tabla `const NIVELES` (1 si no se puede leer)",
  "regla-de-clasificacion-invalida":
    '(e) clasificacion.cjs: línea de la regla ofensora (`clase: "…"` o `glob: "…"`), 1 si no está',
  "ruta-sin-clase": "(c) la ruta, línea 1",
  "clasificacion-ambigua": "(c) la ruta, línea 1",
  "codigo-en-clase-excluida": "(c) la ruta, línea 1",
  "clase-sin-rutas":
    '(e) clasificacion.cjs: línea de la primera regla `clase: "<clase>"`, 1 si no está',
  "registro-invalido": '(d) contratos.cjs: línea de `id: "<id>"` del contrato, 1 si no está',
  "unidad-sin-declaracion": "(b) el contratos.json que falta, línea 1",
  "declaracion-invalida":
    "(a) contratos.json: línea de la clave ofensora (usa, noUsa, un campo sobrante) o del objeto si falta; JSON inválido: línea del error",
  "declara-contrato-inexistente": '(a) contratos.json: línea del id dentro de "usa"',
  "uso-sin-declarar": "(f) línea real del uso en el código",
  "no-usa-falso": "(f) línea real del uso en el código",
  "declaracion-falsa": '(a) contratos.json: línea del id dentro de "usa"',
  "definicion-fuera-de-la-fuente": "(f) línea real de la definición en el código",
  "contrato-sin-fuente":
    "(b) el archivo de la fuente de verdad (el que hay que crear o completar), línea 1",
  "ruta-ilegible": "(c) la ruta, línea 1",
  "detector-invalido": '(d) contratos.cjs: línea de `id: "<id>"` del contrato dueño del detector',
  "detector-sin-rutas": '(d) contratos.cjs: línea de `id: "<id>"` del contrato dueño del detector',
  "detector-en-clase-excluida":
    '(d) contratos.cjs: línea de `id: "<id>"` del contrato dueño del detector',
  "excepcion-invalida":
    "(a) excepciones.json / exclusiones.json: línea de la clave ofensora o del objeto si el campo falta; JSON inválido: línea del error",
  "excepcion-vencida": '(a) excepciones.json / exclusiones.json: línea de "vence"',
  "excepcion-plazo-excesivo": '(a) excepciones.json / exclusiones.json: línea de "vence"',
  "excepcion-vence-antes-de-creada": '(a) excepciones.json / exclusiones.json: línea de "vence"',
  "excepcion-creada-futura": '(a) excepciones.json / exclusiones.json: línea de "creada"',
  "excepcion-ruta-no-exacta": '(a) excepciones.json / exclusiones.json: línea de "ruta"',
  "excepcion-huella-cambiada": '(a) excepciones.json / exclusiones.json: línea de "huella"',
  "excepcion-obsoleta": '(a) excepciones.json / exclusiones.json: línea del "id" de la entrada',
  "excepcion-contrato-inexistente": '(a) excepciones.json: línea de "contrato"',
  "evasion-invalida":
    "(a) evasiones.json: línea de la clave ofensora o de la entrada si falta; JSON inválido: línea del error",
  "brecha-plazo-excesivo": '(a) evasiones.json: línea de "vence"',
  "brecha-vencida": '(a) evasiones.json: línea de "vence"',
  "riesgo-plazo-excesivo": '(a) evasiones.json: línea de "revisar"',
  "riesgo-vencido": '(a) evasiones.json: línea de "revisar"',
  "evasion-no-bloqueada": '(a) evasiones.json: línea de "estado" del caso',
  "brecha-cerrada": '(a) evasiones.json: línea de "estado" del caso',
  "riesgo-cerrado": '(a) evasiones.json: línea de "estado" del caso',
  "falla-sin-ubicacion": "guardian.cjs (o el archivo ofensor si lo trae), línea 1",
  "codigo-fuera-de-la-lista": "guardian.cjs (o el archivo ofensor si lo trae), línea 1",
});

const PATRON_DE_LITERAL = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
/** Los cuatro dígitos hexadecimales de un escape `\uXXXX` (se prueba justo donde dice `lastIndex`). */
const PATRON_DE_HEXA = /[0-9a-fA-F]{4}/y;

/** El analizador encontró un error de forma; lleva la línea donde lo vio (`analizarJson` lo atrapa: nunca sale). */
class ErrorDeAnalisis extends Error {
  constructor(linea) {
    super();
    this.linea = linea;
  }
}

/** Cantidad de líneas hasta el último carácter que no es espacio (1 si el texto está vacío). */
const lineaDelFinal = (texto) => texto.trimEnd().split("\n").length;

/**
 * Analiza un texto JSON (estricto, igual que `JSON.parse`) y devuelve el árbol con la línea de cada
 * clave y de cada elemento, o `{ error: línea }`.
 */
function analizarJson(texto) {
  let i = 0;
  let linea = 1;
  const falla = () => {
    throw new ErrorDeAnalisis(i >= texto.length ? lineaDelFinal(texto) : linea);
  };
  // Se detiene en el primer carácter que no es blanco; pasado el final, `texto[i]` es `undefined` y corta también.
  const saltar = () => {
    for (;;) {
      const c = texto[i];
      if (c === "\n") linea += 1;
      else if (c !== " " && c !== "\t" && c !== "\r") break;
      i += 1;
    }
  };
  const cadena = () => {
    const desde = i;
    i += 1;
    for (;;) {
      const c = texto[i];
      if (c === undefined || c < " ") falla();
      if (c === '"') break;
      if (c === "\\") {
        const siguiente = texto[i + 1];
        PATRON_DE_HEXA.lastIndex = i + 2;
        // `includes(undefined)` busca el texto «undefined»: una barra al final del texto no calza y cae en `falla()`.
        if (siguiente === "u" && PATRON_DE_HEXA.test(texto)) i += 6;
        else if ('"\\/bfnrt'.includes(siguiente)) i += 2;
        else falla();
      } else {
        i += 1;
      }
    }
    i += 1;
    return JSON.parse(texto.slice(desde, i));
  };
  const lista = (cierre, elemento) => {
    i += 1;
    saltar();
    if (texto[i] === cierre) {
      i += 1;
      return;
    }
    for (;;) {
      saltar();
      elemento();
      saltar();
      if (texto[i] === ",") i += 1;
      else if (texto[i] === cierre) break;
      else falla();
    }
    i += 1;
  };
  const valor = () => {
    saltar();
    const inicio = linea;
    const c = texto[i];
    if (c === "{") {
      const miembros = new Map();
      lista("}", () => {
        if (texto[i] !== '"') falla();
        const lineaDeLaClave = linea;
        const clave = cadena();
        saltar();
        if (texto[i] !== ":") falla();
        i += 1;
        miembros.set(clave, { linea: lineaDeLaClave, nodo: valor() });
      });
      return { inicio, miembros };
    }
    if (c === "[") {
      const elementos = [];
      lista("]", () => elementos.push(valor()));
      return { inicio, elementos };
    }
    if (c === '"') {
      cadena();
      return { inicio };
    }
    PATRON_DE_LITERAL.lastIndex = i;
    const literal = PATRON_DE_LITERAL.exec(texto);
    if (literal === null) falla();
    i += literal[0].length;
    return { inicio };
  };
  try {
    const raiz = valor();
    saltar();
    if (i < texto.length) falla();
    return { raiz };
  } catch (error) {
    if (!(error instanceof ErrorDeAnalisis)) throw error;
    return { error: error.linea };
  }
}

/** La línea del último tramo del camino que existe en el árbol (si falta un tramo, la del contenedor). */
function lineaDelCamino(raiz, camino) {
  let nodo = raiz;
  let linea = raiz.inicio;
  for (const tramo of camino) {
    if (nodo.miembros !== undefined && nodo.miembros.has(tramo)) {
      const miembro = nodo.miembros.get(tramo);
      linea = miembro.linea;
      nodo = miembro.nodo;
    } else if (nodo.elementos !== undefined && nodo.elementos[tramo] !== undefined) {
      nodo = nodo.elementos[tramo];
      linea = nodo.inicio;
    } else {
      break;
    }
  }
  return linea;
}

/**
 * Arma la función que completa la `linea` de un hallazgo a partir de su `donde`.
 *
 * @param {(ruta: string) => Buffer | string | null} leer La misma función con la que el guardián lee.
 */
function crearUbicador(leer) {
  const textos = new Map();
  const textoDe = (archivo) => {
    if (!textos.has(archivo)) {
      const contenido = leer(archivo);
      textos.set(archivo, contenido === null ? null : contenido.toString());
    }
    return textos.get(archivo);
  };
  const lineaSegun = (archivo, donde) => {
    if (donde?.tipo === "archivo") return 1;
    if (donde?.tipo === "texto") {
      const texto = textoDe(archivo);
      if (texto === null) return 1;
      const lineas = texto.split(/\r\n|\n/);
      const indice = lineas.findIndex((renglon) => renglon.includes(donde.texto));
      return indice === -1 ? 1 : indice + 1;
    }
    if (donde?.tipo === "json") {
      const texto = textoDe(archivo);
      if (texto === null) return 1;
      const arbol = analizarJson(texto);
      return arbol.error ?? lineaDelCamino(arbol.raiz, donde.camino);
    }
    return undefined;
  };
  /** Devuelve el hallazgo con `linea` completa y sin el descriptor interno `donde`. */
  return (hallazgo) => {
    const { donde, ...resto } = hallazgo;
    if (resto.linea !== undefined || typeof resto.archivo !== "string") return resto;
    const linea = lineaSegun(resto.archivo, donde);
    return linea === undefined ? resto : { ...resto, linea };
  };
}

module.exports = {
  enArchivo,
  enJson,
  enTexto,
  enContrato,
  crearUbicador,
  REGLAS_DE_LINEA,
};
