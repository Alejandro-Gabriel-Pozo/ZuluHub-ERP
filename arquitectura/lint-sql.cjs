/**
 * Reglas de lint del acceso a datos (ADR-004, ADR-012). Se definen acá para que
 * `test/arquitectura/lint-sql.test.ts` las pruebe con violaciones inyectadas, igual que las de
 * dependencias (ADR-003).
 *
 * Alcance: donde se escribe SQL en producción (`adaptadores/` y la `persistencia/` de cada módulo).
 * Las pruebas quedan afuera: usan nombres de tabla fijos.
 *
 * 1. Los valores viajan como parámetros, nunca pegados en el texto del SQL (inyección).
 * 2. `ON CONFLICT ... DO UPDATE` está prohibido salvo en los archivos de la lista revisada. Un
 *    upsert sin guarda pisa en silencio un cambio más nuevo (se comprobó contra la base real): solo
 *    se admite con una condición de versión o fecha y con las columnas listadas a mano. Para eso se
 *    revisa el archivo y se lo agrega acá. `DO NOTHING` (idempotencia) siempre está permitido.
 */

/**
 * Archivos donde un `DO UPDATE` ya fue revisado (con guarda de versión o fecha y columnas
 * explícitas). Vacía a propósito: cada alta requiere una revisión y su prueba de concurrencia.
 * @type {string[]}
 */
const ARCHIVOS_CON_UPSERT_REVISADO = [];

const ALCANCE = ["src/adaptadores/**/*.ts", "src/modulos/*/persistencia/**/*.ts"];

const MENSAJE_UPSERT =
  "ON CONFLICT ... DO UPDATE pisa datos en silencio: usar INSERT con restricción única, DO NOTHING o un UPDATE con control de versión. Un upsert revisado se agrega a ARCHIVOS_CON_UPSERT_REVISADO.";

// Reglas contra la inyección: valen en todo el alcance, también en los archivos con upsert revisado.
const SELECTORES_DE_INYECCION = [
  {
    selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
    message:
      "sql.raw pega texto sin escapar: usar parámetros (sql`... ${valor}`) o sql.id/sql.table para identificadores fijos.",
  },
  {
    selector:
      "CallExpression[callee.property.name='query'] > TemplateLiteral[expressions.length>0]",
    message:
      "No se interpolan valores dentro del texto de query(): pasarlos como parámetros ($1, $2...).",
  },
  {
    selector: "CallExpression[callee.property.name='query'] > BinaryExpression[operator='+']",
    message:
      "No se concatena texto dentro de query(): pasar los valores como parámetros ($1, $2...).",
  },
];

// Reglas contra el upsert sin revisar.
const SELECTORES_DE_UPSERT = [
  { selector: "CallExpression[callee.property.name='doUpdateSet']", message: MENSAJE_UPSERT },
  { selector: "CallExpression[callee.property.name='doUpdateSetIf']", message: MENSAJE_UPSERT },
  { selector: "Literal[value=/\\bDO\\s+UPDATE\\b/i]", message: MENSAJE_UPSERT },
  { selector: "TemplateElement[value.raw=/\\bDO\\s+UPDATE\\b/i]", message: MENSAJE_UPSERT },
];

/**
 * ESLint no suma las opciones de una misma regla entre bloques que comparten archivos: el último
 * gana. Por eso cada archivo cae en UN solo bloque, con todos sus selectores.
 *
 * @param {readonly string[]} archivosConUpsertRevisado
 * @returns {import("eslint").Linter.Config[]}
 */
function crearBloques(archivosConUpsertRevisado) {
  /** @type {import("eslint").Linter.Config[]} */
  const bloques = [
    {
      name: "sql/estricto",
      files: ALCANCE,
      ignores: ["**/*.test.ts", ...archivosConUpsertRevisado],
      rules: {
        "no-restricted-syntax": ["error", ...SELECTORES_DE_INYECCION, ...SELECTORES_DE_UPSERT],
      },
    },
  ];
  if (archivosConUpsertRevisado.length > 0) {
    bloques.push({
      name: "sql/upsert-revisado",
      files: [...archivosConUpsertRevisado],
      ignores: ["**/*.test.ts"],
      rules: { "no-restricted-syntax": ["error", ...SELECTORES_DE_INYECCION] },
    });
  }
  return bloques;
}

const bloques = crearBloques(ARCHIVOS_CON_UPSERT_REVISADO);

module.exports = { bloques, crearBloques, ARCHIVOS_CON_UPSERT_REVISADO };
