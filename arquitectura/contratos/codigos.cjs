/**
 * Códigos de falla y de aviso del guardián: la lista CERRADA (contratos-arquitectonicos.md §4, M1 y M3).
 *
 * Cada chequeo del guardián emite hallazgos con un `codigo` de esta lista. Sirve para tres cosas:
 *  - el informe la publica como «reglas ejecutadas» (qué se comprueba);
 *  - la autocomprobación de `guardian.cjs` falla si un hallazgo trae un código que no está acá, de modo
 *    que agregar un chequeo sin anotarlo acá no pasa en silencio;
 *  - la matriz de invariantes (paso B) la lee para exigir que cada código pertenezca a un invariante.
 * Agregar un chequeo nuevo exige: sumarlo acá, decir en `ubicacion.cjs` cómo se calcula su línea y
 * sumar su caso en `test/arquitectura/guardian-diagnostico.test.ts`.
 */

/** código → qué comprueba (en el informe, `reglasEjecutadas.chequeos`). El orden es el del informe. */
const DESCRIPCION_DE_CODIGOS = Object.freeze({
  "sin-rutas": "el repositorio tiene rutas versionadas para analizar",
  "regla-de-clasificacion-invalida": "la tabla de clasificación tiene clases y globs válidos",
  "ruta-sin-clase": "toda ruta versionada cae en una clase; si no, falla",
  "clasificacion-ambigua": "dos reglas del mismo nivel que clasifican distinto fallan",
  "clase-sin-rutas": "una clase que el repo debe tener no puede quedar vacía",
  "codigo-en-clase-excluida":
    "una clase excluida del análisis (docs, generado) solo admite sus extensiones o rutas permitidas, nunca código",
  "registro-invalido":
    "un contrato con campos faltantes, vacíos o mal formados invalida el registro",
  "unidad-sin-declaracion": "cada unidad tiene su contratos.json",
  "declaracion-invalida": "el contratos.json declara usa y/o noUsa con la forma correcta",
  "declara-contrato-inexistente": "los ids de usa existen en el registro",
  "uso-sin-declarar": "la unidad que usa un contrato lo declara",
  "no-usa-falso": "la unidad que declara no usar nada no usa ningún contrato",
  "declaracion-falsa": "la unidad que declara un contrato lo usa de verdad",
  "definicion-fuera-de-la-fuente": "un valor de contrato solo se define en su fuente de verdad",
  "contrato-sin-fuente": "la fuente de verdad existe y contiene lo que dice",
  "ruta-ilegible": "todo archivo que un detector debe analizar se puede leer",
  "detector-invalido": "un detector no lanza errores y devuelve líneas reales del archivo",
  "detector-sin-rutas":
    "un detector no puede declarar una clase de la que no analizó ni un archivo",
  "detector-en-clase-excluida": "ningún detector apunta a una clase excluida del análisis",
  "excepcion-invalida": "las excepciones y exclusiones traen todos sus campos, sin sobrantes",
  "excepcion-vencida": "ninguna excepción o exclusión está vencida",
  "excepcion-plazo-excesivo": "ninguna excepción o exclusión dura más de 60 días (vence - creada)",
  "excepcion-vence-antes-de-creada": "el vencimiento no es anterior a la creación",
  "excepcion-creada-futura": "la fecha de creación no es futura respecto del reloj",
  "excepcion-ruta-no-exacta": "la ruta de una excepción es un archivo exacto, sin comodines",
  "excepcion-huella-cambiada": "la huella aprobada coincide con la línea (o el archivo) actual",
  "excepcion-obsoleta": "toda excepción o exclusión silencia algo",
  "excepcion-contrato-inexistente": "la excepción apunta a un contrato del registro",
  "falla-sin-ubicacion": "toda falla y todo aviso traen archivo y una línea entera desde 1 (M3)",
  "codigo-fuera-de-la-lista": "todo hallazgo usa un código de la lista cerrada del guardián",
});

/** Los códigos con los que el guardián puede FALLAR. Lista cerrada. */
const CODIGOS_DE_FALLA = Object.freeze(Object.keys(DESCRIPCION_DE_CODIGOS));

/**
 * Los códigos con los que el guardián puede AVISAR (no bloquea). `declaracion-falsa` es aviso cuando el
 * contrato no bloquea la declaración falsa; `excepcion-por-vencer` avisa que una excepción o exclusión
 * vence en pocos días; `ruta-ausente-en-disco` avisa de una ruta que git lista y ya no está.
 */
const CODIGOS_DE_AVISO = Object.freeze([
  "declaracion-falsa",
  "excepcion-por-vencer",
  "ruta-ausente-en-disco",
]);

module.exports = { DESCRIPCION_DE_CODIGOS, CODIGOS_DE_FALLA, CODIGOS_DE_AVISO };
