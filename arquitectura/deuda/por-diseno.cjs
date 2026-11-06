/**
 * La categoría «POR DISEÑO» del libro de deuda (contratos-arquitectonicos.md §10; decisión del dueño 2026-11-06,
 * respuesta 1 de `Pedernal-docs/11-especificaciones/deuda-tecnica-plan.md`): lo que NO es una deuda a pagar sino
 * parte de una prueba (`@ts-expect-error` que afirma que algo no compila, `eslint-disable` que prueba un valor que
 * no es un `Error`), una excepción de herramienta con su motivo (`knip-ignora`) o un riesgo aceptado con su propia
 * fecha de revisión. No vence a los 60 días: se revisa una vez por año.
 *
 * Previene: que la regla «toda deuda vence en ≤ 60 días» obligue a renovar 27 cosas que no son deuda, o que se use
 * «por diseño» de comodín para esconder deuda de verdad. Por eso es una lista CERRADA y barata de controlar:
 *  - solo cuatro tipos (`TIPOS_POR_DISENO`), y `@ts-expect-error` / `eslint-disable` solo en archivos de prueba;
 *  - `cantidad` por archivo (el trinquete: un marcador más sin tocar el registro falla);
 *  - un tope global de entradas (`topeDePorDiseno`, que solo baja: lo vigila `no-debilitar.cjs`);
 *  - `revisar` obligatorio, a no más de un año, y que al llegar la fecha FALLA (fail closed).
 * Es puro: recibe las entradas ya leídas y el día de hoy.
 */
const { avisoDeVencimiento, diasEntre, esFechaValida } = require("../contratos/excepciones.cjs");

const TIPOS_POR_DISENO = Object.freeze([
  "ts-expect-error",
  "eslint-disable",
  "knip-ignora",
  "riesgo-aceptado",
]);
/** Los marcadores que se cuentan por archivo (el resto no tiene un número que vigilar). */
const TIPOS_CON_CANTIDAD = Object.freeze(["ts-expect-error", "eslint-disable"]);
const CAMPOS_DE_POR_DISENO = Object.freeze(["motivo", "aprobadoPor", "revisar"]);
const CAMPOS_DE_AMPLIACION = Object.freeze(["desde", "aprobadoPor", "fecha"]);
const CAMPOS_DE_EXCEPCION_AJENOS = Object.freeze(["motivo", "aprobadoPor", "vence"]);
/** La revisión es anual (un año bisiesto incluido). */
const PLAZO_DE_REVISION_EN_DIAS = 366;

const esDePrueba = (ruta) => /\.test\.[cm]?[jt]sx?$/.test(ruta) || ruta.startsWith("test/");

/**
 * Los problemas de forma de `origen`, `cantidad` y `porDiseno` de una entrada: `{ campo, motivo, correccion }`.
 * `ayudas` trae `esObjeto` y `esTexto` del libro (así este archivo no depende de `entradas.cjs`, que lo usa).
 */
function formaDePorDiseno(entrada, { esObjeto, esTexto }) {
  const problemas = [];
  const nuevo = (campo, motivo, correccion) => problemas.push({ campo, motivo, correccion });
  const creadaValida = esTexto(entrada.creada) && esFechaValida(entrada.creada);
  if (entrada.origen !== undefined) {
    if (!esTexto(entrada.origen) || !esFechaValida(entrada.origen)) {
      nuevo(
        "origen",
        "«origen» tiene que ser una fecha AAAA-MM-DD real.",
        "Poné la fecha en que nació la deuda.",
      );
    } else if (creadaValida && entrada.origen > entrada.creada) {
      nuevo(
        "origen",
        "«origen» es posterior a «creada».",
        "El origen es la fecha real de la deuda: no puede ser después de la aprobación.",
      );
    }
  }
  const { porDiseno } = entrada;
  if (porDiseno === undefined) {
    if (entrada.cantidad !== undefined) {
      nuevo("cantidad", "solo una entrada «porDiseno» lleva «cantidad».", "Sacala.");
    }
    return problemas;
  }
  if (!esObjeto(porDiseno)) {
    nuevo("porDiseno", "«porDiseno» es `{ motivo, aprobadoPor, revisar }`.", "Corregí su forma.");
    return problemas;
  }
  for (const clave of Object.keys(porDiseno)) {
    if (!CAMPOS_DE_POR_DISENO.includes(clave)) {
      nuevo(
        "porDiseno",
        `«porDiseno» trae «${clave}», que no es un campo permitido.`,
        `Dejá solo: ${CAMPOS_DE_POR_DISENO.join(", ")}.`,
      );
    }
  }
  for (const campo of ["motivo", "aprobadoPor"]) {
    if (!esTexto(porDiseno[campo])) {
      nuevo(
        "porDiseno",
        `«porDiseno.${campo}» falta o está vacío.`,
        "Una entrada por diseño dice por qué y quién la aprobó.",
      );
    }
  }
  if (!esTexto(porDiseno.revisar) || !esFechaValida(porDiseno.revisar)) {
    nuevo(
      "porDiseno",
      "«porDiseno.revisar» tiene que ser una fecha AAAA-MM-DD real.",
      "Poné cuándo se vuelve a revisar (como máximo un año).",
    );
  } else if (
    creadaValida &&
    diasEntre(entrada.creada, porDiseno.revisar) > PLAZO_DE_REVISION_EN_DIAS
  ) {
    nuevo(
      "porDiseno",
      `la revisión dura más de ${PLAZO_DE_REVISION_EN_DIAS} días desde «creada».`,
      "La revisión es anual.",
    );
  } else if (creadaValida && porDiseno.revisar <= entrada.creada) {
    nuevo(
      "porDiseno",
      "«porDiseno.revisar» no es posterior a «creada».",
      "La revisión es después de la aprobación.",
    );
  }
  for (const campo of CAMPOS_DE_EXCEPCION_AJENOS) {
    if (entrada[campo] !== undefined) {
      nuevo(
        campo,
        `«${campo}» es de una excepción con vencimiento: una entrada «porDiseno» no la lleva.`,
        "Una entrada es por diseño o es una excepción, no las dos.",
      );
    }
  }
  if (!TIPOS_POR_DISENO.includes(entrada.tipo)) {
    nuevo(
      "tipo",
      `el tipo «${String(entrada.tipo)}» no puede ser por diseño.`,
      `Solo: ${TIPOS_POR_DISENO.join(", ")}.`,
    );
  }
  const conCantidad = TIPOS_CON_CANTIDAD.includes(entrada.tipo);
  if (conCantidad) {
    if (!Number.isInteger(entrada.cantidad) || entrada.cantidad < 1) {
      nuevo(
        "cantidad",
        "una entrada por diseño de un marcador lleva «cantidad»: un entero (cuántos hay) desde 1.",
        "Poné cuántos marcadores tiene hoy el archivo.",
      );
    }
    if (Array.isArray(entrada.archivos) && !entrada.archivos.every(esDePrueba)) {
      nuevo(
        "archivos",
        `«${entrada.tipo}» solo es por diseño en un archivo de prueba (*.test.* o test/).`,
        "En código de producción es deuda con vencimiento.",
      );
    }
  } else if (entrada.cantidad !== undefined) {
    nuevo("cantidad", `un «${String(entrada.tipo)}» por diseño no lleva «cantidad».`, "Sacala.");
  }
  return problemas;
}

/** La forma de `ampliacionDelTope` en la configuración: `{ desde, aprobadoPor, fecha }`; `null` si es válida. */
function problemaDeAmpliacion(valor, { esObjeto, esTexto }) {
  if (
    !esObjeto(valor) ||
    Object.keys(valor).join() !== CAMPOS_DE_AMPLIACION.join() ||
    !Number.isInteger(valor.desde) ||
    valor.desde < 0 ||
    !esTexto(valor.aprobadoPor) ||
    !esTexto(valor.fecha) ||
    !esFechaValida(valor.fecha)
  ) {
    return "`ampliacionDelTope` es `{ desde (entero), aprobadoPor (texto), fecha (AAAA-MM-DD) }`, en ese orden.";
  }
  return null;
}

/**
 * La revisión anual de una entrada por diseño: `{ falla }` si `revisar` ya pasó, `{ aviso }` si faltan 14 días o
 * menos, `{}` si está al día o no es por diseño. Una fecha ilegible no se juzga acá (es un problema de forma).
 */
function revisionDe(crudo, hoy, archivo, contrato, indice) {
  const revisar = crudo.porDiseno?.revisar;
  if (!esFechaValida(revisar)) return {};
  if (revisar < hoy) {
    return {
      falla: {
        motivo: `La entrada «${String(crudo.id)}» (por diseño) tenía que revisarse el ${revisar} (hoy es ${hoy}).`,
        correccion:
          "Revisala con el dueño: si sigue siendo por diseño, nueva revisión a un año; si no, pagala o dale vencimiento.",
      },
    };
  }
  const aviso = avisoDeVencimiento(
    { id: crudo.id, vence: revisar },
    hoy,
    "Revisión por diseño",
    archivo,
    contrato,
    indice,
  );
  return aviso === null ? {} : { aviso };
}

/**
 * Los controles de conjunto de la categoría: el tope de entradas y la cantidad por archivo.
 * `entradas` son las del libro (con `porDiseno` y `cantidad`); `lineasDe(entrada)` da cuántos marcadores hay.
 * Devuelve `{ indice, campo, codigo, motivo, correccion, aviso }`.
 */
function controlesDeConjunto({ entradas, configuracion, lineasDe }) {
  const hallazgos = [];
  const lista = entradas.filter((entrada) => entrada.porDiseno);
  if (lista.length > configuracion.topeDePorDiseno) {
    hallazgos.push({
      indice: lista[configuracion.topeDePorDiseno].indice,
      campo: "id",
      codigo: "deuda-tope-de-excepciones",
      motivo: `Hay ${lista.length} entradas por diseño y el tope es ${configuracion.topeDePorDiseno}: «por diseño» no puede volverse un comodín.`,
      correccion:
        "Pagá deuda (que una entrada deje de hacer falta) antes de abrir otra; el tope solo baja.",
      aviso: false,
    });
  }
  for (const entrada of lista) {
    const hay = entrada.cantidad === null ? null : lineasDe(entrada);
    if (hay === null) continue;
    const motivo = (detalle) =>
      `«${entrada.id}» registra ${entrada.cantidad} y el archivo tiene ${hay} marcadores: ${detalle}.`;
    if (hay > entrada.cantidad) {
      hallazgos.push({
        indice: entrada.indice,
        campo: "cantidad",
        codigo: "deuda-archivo-crece",
        motivo: motivo("un marcador por diseño no puede crecer sin pasar por el registro"),
        correccion:
          "Sacá el marcador, o registrá el nuevo con el dueño (el tope de entradas por diseño solo baja).",
        aviso: false,
      });
    } else if (hay < entrada.cantidad) {
      hallazgos.push({
        indice: entrada.indice,
        campo: "cantidad",
        codigo: "deuda-tamano-desactualizado",
        motivo: motivo("el trinquete tiene que bajar con él"),
        correccion: `Poné "cantidad": ${hay} en la entrada.`,
        aviso: true,
      });
    }
  }
  return hallazgos;
}

/** `true` si el PR sube el tope de excepciones con la ampliación aprobada, UNA sola vez (la base no tenía ninguna). */
function esAmpliacionAprobada(antes, ahora, ayudas) {
  const { ampliacion } = ahora;
  return (
    ahora.tope > antes.tope &&
    (antes.ampliacion === undefined || antes.ampliacion === null) &&
    problemaDeAmpliacion(ampliacion, ayudas) === null &&
    ampliacion.desde === antes.tope
  );
}

/**
 * Los hallazgos de los topes de la configuración (los que `no-debilitar.cjs` ve entre la base y el PR): el tope de
 * excepciones no sube salvo UNA ampliación aprobada, y el de entradas por diseño no sube nunca. `ayudas` trae lo
 * de `no-debilitar.cjs` (`hallazgo`, `enJson`, `esObjeto`, `esTexto` y el `archivo` de la configuración).
 */
function hallazgosDeTopes(antes, ahora, ayudas) {
  const { archivo, enJson, hallazgo } = ayudas;
  const hallazgos = [];
  if (ahora.tope > antes.tope && !esAmpliacionAprobada(antes, ahora, ayudas)) {
    hallazgos.push(
      hallazgo(
        "deuda-tope-subio",
        archivo,
        `El tope de excepciones de deuda subió de ${antes.tope} a ${ahora.tope}: la excepción se volvería la norma.`,
        "Dejá el tope como estaba (puede bajar, no subir).",
        { donde: enJson("topeDeExcepciones") },
      ),
    );
  }
  if (Number.isInteger(antes.topePorDiseno) && ahora.topePorDiseno > antes.topePorDiseno) {
    hallazgos.push(
      hallazgo(
        "deuda-tope-subio",
        archivo,
        `El tope de entradas por diseño subió de ${antes.topePorDiseno} a ${ahora.topePorDiseno}: «por diseño» se volvería un comodín.`,
        "Dejá el tope como estaba (solo baja).",
        { donde: enJson("topeDePorDiseno") },
      ),
    );
  }
  return hallazgos;
}

module.exports = {
  PLAZO_DE_REVISION_EN_DIAS,
  TIPOS_CON_CANTIDAD,
  TIPOS_POR_DISENO,
  controlesDeConjunto,
  esAmpliacionAprobada,
  esDePrueba,
  hallazgosDeTopes,
  formaDePorDiseno,
  problemaDeAmpliacion,
  revisionDe,
};
