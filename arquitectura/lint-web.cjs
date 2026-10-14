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

/**
 * C-2 (D10). Previene: un tamaño de letra fijo en `px` dentro de la plantilla de la carta, que no respeta el
 * tamaño que el comensal configuró en su celular ni la perilla `letra_base` y rompe el control «Letra». Esta
 * parte mira el JavaScript (`style={{ fontSize: "18px" }}` o `fontSize: 18`, que en React también son px); los
 * archivos `.css` los revisa la prueba de convenciones de `reglas.test.ts`. Chequeo: las violaciones de
 * `lint.test.ts`. El bloque repite los selectores de `web/apps` porque ESLint no suma las opciones de una misma
 * regla entre bloques: el último reemplazaría al otro.
 */
const MENSAJE_DE_LETRA_EN_PX =
  "Ningún tamaño de letra en px dentro de la plantilla de la carta (D10): se usa rem o em.";
bloques.push({
  name: "web/carta-sin-px-de-letra",
  files: ["apps/web/ui/plantillas/carta/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      ...SELECTORES_DE_HTML,
      ...SELECTORES_DE_CONTEXTO,
      ...selectoresDeImporteEnApps,
      {
        selector: "Property[key.name='fontSize'] > Literal[value=/px\\s*$/i]",
        message: MENSAJE_DE_LETRA_EN_PX,
      },
      {
        selector: "Property[key.name='fontSize'] > Literal[value=type(number)]",
        message: MENSAJE_DE_LETRA_EN_PX,
      },
    ],
  },
});

/**
 * ADR-016, punto 4. Previene: una acción del servidor o un componente que arma un repositorio con el
 * `publico.ts` de un módulo y se salta el control de permisos y la auditoría que sí hacen los casos de uso y
 * las consultas (caso real: `publico.ts` reexporta también su persistencia, ADR-012). Las pantallas y acciones
 * entran por `crearCasosDeUso*`, `crearConsultas*` y la composición (`apps/web/servidor/composicion.ts`),
 * nunca por `crearRepositorio*` ni `crearLectura*` (el armado de las lecturas de persistencia). Chequeo: las
 * violaciones inyectadas de `lint.test.ts`. Alcance: `apps/**` (la composición sí los arma: es su trabajo).
 * Este bloque va DESPUÉS del de `process` y repite sus `paths`: ESLint no suma las opciones de una misma regla
 * entre bloques que comparten archivos, el último reemplaza al anterior.
 */
const MENSAJE_DE_ARMADOR =
  "Una acción del servidor o un componente no arma repositorios ni lecturas de persistencia (ADR-016): entra por los casos de uso y las consultas de publico.ts, que pasan por el guard y la auditoría.";
bloques.push({
  name: "web/sin-armadores-de-repositorios",
  files: ["apps/**/*.{ts,tsx}"],
  ignores: ["**/*.test.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "process", message: MENSAJE_DE_ENTORNO },
          { name: "node:process", message: MENSAJE_DE_ENTORNO },
        ],
        patterns: [
          {
            group: ["**/modulos/*/publico", "**/modulos/*/publico.ts"],
            importNamePattern: "^crear(Repositorio|Lectura)",
            message: MENSAJE_DE_ARMADOR,
          },
        ],
      },
    ],
  },
});

module.exports = { bloques };
