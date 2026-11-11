/**
 * La FORMA del registro de decisiones (`registro.json`) y de la lista de archivos sensibles (`archivos-sensibles.json`).
 *
 * Previene: que una decisión de permisos, dinero, lo que ve un cliente o lo comercial quede escrita solo como «SUPUESTO» en un comentario
 * o en un PR, donde el dueño no la ve (caso real, 11/11/2026: una sesión movió `presentacion_de_producto` de catálogo a compras contra el
 * diseño aprobado y nadie lo supo hasta que el dueño preguntó). El registro es la lista única que el dueño puede leer
 * (`npm run decisiones`); este archivo solo dice cuándo una entrada es válida.
 *
 * Regla del repo («Todo nace cerrado»): la validación declara lo que se PERMITE (conjunto, largo, forma), nunca lo que se prohíbe. Por
 * eso cada campo tiene su lista cerrada o su patrón de lo permitido, y una entrada con una clave de más o de menos falla.
 * Es puro: recibe valores ya leídos, no toca el disco.
 */

const TIPOS = Object.freeze([
  "DINERO",
  "PERMISOS",
  "CLIENTE",
  "DATOS",
  "COMERCIAL",
  "INFRAESTRUCTURA",
  "SIN_DECISION",
]);
const ESTADOS = Object.freeze(["PENDIENTE_DE_OK", "CONFIRMADA", "CORREGIDA"]);
const QUIENES = Object.freeze(["dueño", "padre", "sesión"]);

/** El tipo que no es una decisión de negocio (un cambio puramente técnico): lleva `motivo` y no se le pide OK al dueño. */
const TIPO_SIN_DECISION = "SIN_DECISION";

/** Largos máximos (una regla, un lugar): una línea de negocio, y un poco más para lo que cambia, el lugar y el motivo. */
const LARGO_MAXIMO_DE_LA_DECISION = 200;
const LARGO_MAXIMO_DE_QUE_CAMBIA = 300;
const LARGO_MAXIMO_DE_DONDE = 300;
const LARGO_MAXIMO_DEL_MOTIVO = 300;
const LARGO_MINIMO_DE_UN_TEXTO = 3;

const CLAVES_BASE = Object.freeze([
  "id",
  "fecha",
  "quien",
  "tipo",
  "estado",
  "decision",
  "que_cambia",
  "donde",
]);
const CLAVES_DE_SIN_DECISION = Object.freeze([...CLAVES_BASE, "motivo"]);

const FORMA_DEL_ID = /^DEC-\d{4}$/;
/**
 * Lo PERMITIDO en un texto: palabras de letras, dígitos y los signos de una frase, separadas por UN espacio, sin blancos en los
 * extremos ni saltos de línea ni caracteres de control.
 */
const PALABRA = "[\\p{L}\\p{N}.,;:()«»\"'%/¿?¡!+=$&*#_\\-–—`≤≥→★§]+";
const FORMA_DE_UN_TEXTO = new RegExp(`^(?:${PALABRA} )*${PALABRA}$`, "u");

const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Los problemas de un texto (vacío si está bien). `campo` es el nombre que sale en el mensaje. */
function problemasDeUnTexto(valor, campo, largoMaximo) {
  if (typeof valor !== "string") return [`${campo} tiene que ser un texto.`];
  if (valor.length < LARGO_MINIMO_DE_UN_TEXTO || valor.length > largoMaximo) {
    return [
      `${campo} tiene que tener entre ${LARGO_MINIMO_DE_UN_TEXTO} y ${largoMaximo} caracteres.`,
    ];
  }
  if (!FORMA_DE_UN_TEXTO.test(valor)) {
    return [
      `${campo} admite letras, números y los signos de una frase, con un solo espacio entre palabras y sin saltos de línea.`,
    ];
  }
  return [];
}

/** Si `fecha` es un día real del calendario con la forma AAAA-MM-DD (la ida y vuelta por `Date` solo se repite si la forma es exacta). */
function esFechaReal(fecha) {
  const dia = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(dia.getTime()) && dia.toISOString().slice(0, 10) === fecha;
}

const dentroDe = (lista, valor) => lista.includes(valor);

/** Los problemas de UNA entrada del registro (vacío si está bien). */
function problemasDeUnaEntrada(entrada) {
  if (!esObjeto(entrada)) return ["la entrada tiene que ser un objeto."];
  const problemas = [];
  const esSinDecision = entrada.tipo === TIPO_SIN_DECISION;
  const esperadas = esSinDecision ? CLAVES_DE_SIN_DECISION : CLAVES_BASE;
  const claves = Object.keys(entrada);
  const sobran = claves.filter((clave) => !esperadas.includes(clave));
  const faltan = esperadas.filter((clave) => !claves.includes(clave));
  if (sobran.length > 0) problemas.push(`claves que no existen: ${sobran.join(", ")}.`);
  if (faltan.length > 0) {
    problemas.push(
      `faltan ${faltan.join(", ")}${esSinDecision && faltan.includes("motivo") ? " (un SIN_DECISION explica en `motivo` por qué no es una decisión de negocio)" : ""}.`,
    );
  }
  if (typeof entrada.id !== "string" || !FORMA_DEL_ID.test(entrada.id))
    problemas.push("id tiene la forma DEC-0001.");
  if (!esFechaReal(entrada.fecha)) problemas.push("fecha es un día real con la forma AAAA-MM-DD.");
  if (!dentroDe(QUIENES, entrada.quien)) problemas.push(`quien es uno de: ${QUIENES.join(", ")}.`);
  if (!dentroDe(TIPOS, entrada.tipo)) problemas.push(`tipo es uno de: ${TIPOS.join(", ")}.`);
  if (!dentroDe(ESTADOS, entrada.estado))
    problemas.push(`estado es uno de: ${ESTADOS.join(", ")}.`);
  problemas.push(...problemasDeUnTexto(entrada.decision, "decision", LARGO_MAXIMO_DE_LA_DECISION));
  problemas.push(
    ...problemasDeUnTexto(entrada.que_cambia, "que_cambia", LARGO_MAXIMO_DE_QUE_CAMBIA),
  );
  problemas.push(...problemasDeUnTexto(entrada.donde, "donde", LARGO_MAXIMO_DE_DONDE));
  if (esSinDecision && "motivo" in entrada) {
    problemas.push(...problemasDeUnTexto(entrada.motivo, "motivo", LARGO_MAXIMO_DEL_MOTIVO));
  }
  return problemas;
}

/**
 * Los problemas del registro completo: una lista de entradas válidas con `id` único. Devuelve `[{ id, problema }]`; `id` es el de la
 * entrada (o su posición si no se puede leer) para que el mensaje diga cuál es.
 */
function problemasDelRegistro(registro) {
  if (!Array.isArray(registro)) return [{ id: "registro", problema: "tiene que ser una lista." }];
  const vistos = new Set();
  const salida = [];
  registro.forEach((entrada, posicion) => {
    const id =
      esObjeto(entrada) && typeof entrada.id === "string" ? entrada.id : `#${posicion + 1}`;
    for (const problema of problemasDeUnaEntrada(entrada)) salida.push({ id, problema });
    if (vistos.has(id)) salida.push({ id, problema: "el id está repetido." });
    vistos.add(id);
  });
  return salida;
}

/**
 * Los problemas de la lista de archivos sensibles: `{ "sensibles": [{ "ruta": "carpeta/" o "archivo", "que": "texto" }] }`. Una ruta que
 * termina en `/` es una carpeta (todo lo que cuelga de ella); si no, un archivo exacto.
 */
const TRAMO_DE_UNA_RUTA = "(?!\\.{1,2}(?:/|$))[A-Za-z0-9._-]+";
const FORMA_DE_UNA_RUTA = new RegExp(`^${TRAMO_DE_UNA_RUTA}(?:/${TRAMO_DE_UNA_RUTA})*/?$`);
function problemasDeLosSensibles(valor) {
  if (
    !esObjeto(valor) ||
    Object.keys(valor).join() !== "sensibles" ||
    !Array.isArray(valor.sensibles)
  ) {
    return ['archivos-sensibles.json tiene que ser { "sensibles": [ { "ruta", "que" } ] }.'];
  }
  if (valor.sensibles.length === 0) return ["archivos-sensibles.json no puede quedar vacío."];
  const problemas = [];
  const vistas = new Set();
  for (const [posicion, fila] of valor.sensibles.entries()) {
    const nombre = `sensibles[${posicion}]`;
    if (!esObjeto(fila) || Object.keys(fila).sort().join() !== "que,ruta") {
      problemas.push(`${nombre}: lleva exactamente ruta y que.`);
      continue;
    }
    if (typeof fila.ruta !== "string" || !FORMA_DE_UNA_RUTA.test(fila.ruta)) {
      problemas.push(
        `${nombre}: ruta es un archivo o una carpeta (termina en «/») del repositorio.`,
      );
    } else if (vistas.has(fila.ruta)) {
      problemas.push(`${nombre}: la ruta «${fila.ruta}» está repetida.`);
    } else vistas.add(fila.ruta);
    problemas.push(...problemasDeUnTexto(fila.que, `${nombre}.que`, LARGO_MAXIMO_DE_LA_DECISION));
  }
  return problemas;
}

module.exports = { TIPO_SIN_DECISION, problemasDeLosSensibles, problemasDelRegistro };
