/**
 * Reglas de lint del acceso a datos: todo valor viaja como parámetro, nunca pegado en el texto
 * del SQL (inyección). Se definen acá para que `test/arquitectura/lint.test.ts` las pruebe con
 * violaciones inyectadas, igual que las de dependencias (ADR-003).
 *
 * Alcance: donde se escribe SQL en producción (`adaptadores/` y la `persistencia/` de cada módulo).
 * Las pruebas quedan afuera: usan nombres de tabla fijos.
 */

/** @type {import("eslint").Linter.Config[]} */
const bloques = [
  {
    name: "sql/sin-texto-crudo",
    files: ["src/adaptadores/**/*.ts", "src/modulos/*/persistencia/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
];

module.exports = { bloques };
