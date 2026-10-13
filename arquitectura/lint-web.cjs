/**
 * Reglas de lint de la web (`apps/**`) y de la composición (`src/composicion/**`). Se definen acá, y
 * no solo en `eslint.config.js`, para que `test/arquitectura/lint.test.ts` las pruebe con
 * violaciones inyectadas, igual que las del dinero.
 *
 * ESLint no suma las opciones de una misma regla entre bloques que comparten archivos: el último
 * gana. Por eso cada archivo cae en UN solo bloque de `no-restricted-syntax`, con todos sus selectores.
 */
const { bloques: bloquesDeDinero } = require("./lint-dinero.cjs");

/** Los selectores del dinero (caso 0b), para los archivos de `src/**` que además tienen reglas de la web. */
const selectoresDeDinero = bloquesDeDinero
  .find((b) => b.name === "dinero/sin-conversiones-forzadas")
  .rules["no-restricted-syntax"].slice(1);

/**
 * R-W8. Previene: texto de marca (nombre, vocabulario) pintado como HTML y, con él, inyección de
 * marcado. Chequeo: la violación inyectada de `lint.test.ts`. No hay `eslint-plugin-react`, de ahí
 * el selector sobre el atributo JSX.
 */
const SELECTORES_DE_HTML = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      "No se pinta HTML crudo en apps/**: el texto de marca va como texto, nunca como marcado (R-W8).",
  },
  {
    // El mismo atributo pasado por un objeto (`{...{ dangerouslySetInnerHTML: … }}`).
    selector: "Property[key.name='dangerouslySetInnerHTML']",
    message: "No se pinta HTML crudo en apps/** (R-W8): tampoco por un objeto expandido.",
  },
];

/**
 * R-W3. Previene: un contexto con una empresa o una marca que mandó el navegador. Los contextos con
 * persona o invitación se arman solo en `src/composicion/contextos.ts` (y en las pruebas), a partir
 * de lo que ya resolvió el servidor. Chequeo: las violaciones inyectadas de `lint.test.ts`. Alcance:
 * `apps/**` y la composición; los casos de uso de los módulos arman el contexto de sistema de sus
 * trabajos y el de invitación a partir del token, sin dato alguno del navegador.
 */
const TIPOS_DE_CONTEXTO = "OPERATIVO|SESION|INVITACION|GRUPO|PLATAFORMA";
const MENSAJE_DE_CONTEXTO =
  "Los contextos con persona o invitación se arman solo en src/composicion/contextos.ts (R-W3).";
const SELECTORES_DE_CONTEXTO = ["key.name='tipo'", "key.value='tipo'"].flatMap((clave) =>
  [
    `Property[${clave}] > Literal[value=/^(${TIPOS_DE_CONTEXTO})$/]`,
    // Con `as const`: `tipo: "OPERATIVO" as const`.
    `Property[${clave}] > TSAsExpression > Literal[value=/^(${TIPOS_DE_CONTEXTO})$/]`,
  ].map((selector) => ({ selector, message: MENSAJE_DE_CONTEXTO })),
);

/**
 * R-W1. Previene: variables leídas en cualquier lado, sin validar, o un secreto que llega a un
 * componente. Solo `src/composicion/entorno.ts` toca el entorno del proceso (scripts/ y test/ quedan
 * fuera del alcance del bloque). Se prohíbe el global `process` entero y no solo `process.env`:
 * así tampoco sirve `const { env } = process` ni un alias. Chequeo: las violaciones de `lint.test.ts`.
 */
const MENSAJE_DE_ENTORNO =
  "El entorno del proceso se lee solo en src/composicion/entorno.ts (R-W1): el resto recibe los valores ya validados.";

const { selectoresDeImporteEnApps } = require("./lint-dinero.cjs");

/** @type {import("eslint").Linter.Config[]} */
const bloques = [
  {
    // R-W10 (el dinero no es `number` en apps/**) comparte este bloque: ver `lint-dinero.cjs`.
    name: "web/apps",
    files: ["apps/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...SELECTORES_DE_HTML,
        ...SELECTORES_DE_CONTEXTO,
        ...selectoresDeImporteEnApps,
      ],
    },
  },
  {
    name: "web/composicion",
    files: ["src/composicion/**/*.ts"],
    ignores: ["src/composicion/contextos.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...selectoresDeDinero, ...SELECTORES_DE_CONTEXTO],
    },
  },
  {
    name: "web/sin-process-env",
    files: ["src/**/*.ts", "apps/**/*.{ts,tsx}"],
    ignores: ["src/composicion/entorno.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-globals": ["error", { name: "process", message: MENSAJE_DE_ENTORNO }],
      "no-restricted-properties": [
        "error",
        { object: "globalThis", property: "process", message: MENSAJE_DE_ENTORNO },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "process", message: MENSAJE_DE_ENTORNO },
            { name: "node:process", message: MENSAJE_DE_ENTORNO },
          ],
        },
      ],
    },
  },
];

module.exports = { bloques };
