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

/**
 * R-W10: el dinero en la web (`apps/**`). Previene un importe como `number` en un formulario o en una
 * prop ([A006], ADR-006): en la frontera el dinero es texto decimal, y un `number` pierde centavos
 * (0,1 + 0,2) sin que nada lo note. Los nombres que delatan dinero son `importe`, `total` y `precio`
 * (y sus compuestos: `importeNeto`, `totalConIva`, `precioUnitario`); `totales` o `totalizar` no lo son.
 *
 * Son selectores y NO un bloque propio: en `apps/**` ya rige `no-restricted-syntax` de R-W8 (en
 * `lint-web.cjs`), y ESLint no combina las opciones de una misma regla entre bloques (el último
 * reemplaza al anterior). `lint-web.cjs` los suma a los suyos; `lint.test.ts` verifica que la
 * configuración real aplique las dos reglas juntas.
 */
const NOMBRE_DE_IMPORTE = "/^(importe|total|precio)([A-Z_].*)?$/";
const MENSAJE_DE_IMPORTE =
  "En apps/** un importe, total o precio no es `number`: es texto decimal en la frontera (ADR-006, R-W10).";

/** @type {{ selector: string; message: string }[]} */
const selectoresDeImporteEnApps = [
  // Tipos: propiedades de interfaces y tipos literales (las props de un componente), también opcionales.
  `TSPropertySignature[key.name=${NOMBRE_DE_IMPORTE}] > TSTypeAnnotation > TSNumberKeyword`,
  `TSPropertySignature[key.name=${NOMBRE_DE_IMPORTE}] > TSTypeAnnotation > TSUnionType > TSNumberKeyword`,
  // Campos de clase, variables y parámetros.
  `PropertyDefinition[key.name=${NOMBRE_DE_IMPORTE}] > TSTypeAnnotation > TSNumberKeyword`,
  `PropertyDefinition[key.name=${NOMBRE_DE_IMPORTE}] > TSTypeAnnotation > TSUnionType > TSNumberKeyword`,
  `Identifier[name=${NOMBRE_DE_IMPORTE}] > TSTypeAnnotation > TSNumberKeyword`,
  `Identifier[name=${NOMBRE_DE_IMPORTE}] > TSTypeAnnotation > TSUnionType > TSNumberKeyword`,
  // Valores: un número escrito en un campo de objeto o en una prop de JSX.
  `Property[key.name=${NOMBRE_DE_IMPORTE}] > Literal[raw=/^[.]?[0-9]/]`,
  `Property[key.name=${NOMBRE_DE_IMPORTE}] > UnaryExpression > Literal[raw=/^[.]?[0-9]/]`,
  `JSXAttribute[name.name=${NOMBRE_DE_IMPORTE}] > JSXExpressionContainer > Literal[raw=/^[.]?[0-9]/]`,
  `JSXAttribute[name.name=${NOMBRE_DE_IMPORTE}] > JSXExpressionContainer > UnaryExpression > Literal[raw=/^[.]?[0-9]/]`,
].map((selector) => ({ selector, message: MENSAJE_DE_IMPORTE }));

module.exports = { bloques, selectoresDeImporteEnApps };
