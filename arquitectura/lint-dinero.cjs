/**
 * Reglas de lint del dinero (caso 0b §5). Se definen acá, y no solo en `eslint.config.js`, para que
 * `test/arquitectura/lint.test.ts` las pruebe con violaciones inyectadas, igual que las de
 * dependencias (ADR-003).
 */

const TIPOS_DE_DINERO = "Importe|MontoExacto|PrecioUnitario|Cantidad|Porcentaje|Moneda";

/** @type {import("eslint").Linter.Config[]} */
const bloques = [
  {
    name: "dinero/sin-conversiones-forzadas",
    files: ["src/**/*.ts", "test/**/*.ts", "api/**/*.ts"],
    ignores: ["src/primitivas/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `TSAsExpression > TSTypeReference[typeName.name=/^(${TIPOS_DE_DINERO})$/]`,
          message:
            "No se fuerza un tipo de dinero con `as` fuera de primitivas/: se construye desde texto validado (ADR-006).",
        },
        {
          selector: `TSTypeAssertion > TSTypeReference[typeName.name=/^(${TIPOS_DE_DINERO})$/]`,
          message:
            "No se fuerza un tipo de dinero con una aserción fuera de primitivas/ (ADR-006).",
        },
      ],
    },
  },
  {
    name: "dinero/sin-number",
    files: ["src/primitivas/dinero/**/*.ts", "src/primitivas/cantidad/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/]",
          message: "Ni Number ni parseFloat ni parseInt en dinero: usar bigint y texto (ADR-006).",
        },
        {
          selector:
            "MemberExpression[object.name='Number'][property.name=/^(parseFloat|parseInt)$/]",
          message: "Ni Number.parseFloat ni Number.parseInt en dinero (ADR-006).",
        },
        {
          selector: "UnaryExpression[operator='+']",
          message: "El `+` unario convierte a number: no se usa en dinero (ADR-006).",
        },
        {
          selector: "MemberExpression[object.name='Math']",
          message: "Math trabaja con number: no se usa en dinero (ADR-006).",
        },
      ],
    },
  },
];

module.exports = { bloques };
