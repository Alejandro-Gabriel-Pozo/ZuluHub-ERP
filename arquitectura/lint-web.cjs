/**
 * Reglas de lint de la web (`apps/**`). Se definen acá, y no solo en `eslint.config.js`, para que
 * `test/arquitectura/lint.test.ts` las pruebe con violaciones inyectadas, igual que las del dinero.
 */

const { selectoresDeImporteEnApps } = require("./lint-dinero.cjs");

/** @type {import("eslint").Linter.Config[]} */
const bloques = [
  {
    // R-W8. Previene: texto de marca (nombre, vocabulario) pintado como HTML y, con él, inyección de
    // marcado. Chequeo: la violación inyectada de `lint.test.ts`. No hay `eslint-plugin-react`, de ahí
    // el selector sobre el atributo JSX.
    // R-W10 (el dinero no es `number` en apps/**) comparte este bloque: ver `lint-dinero.cjs`.
    name: "web/sin-html-inyectado-ni-dinero-number",
    files: ["apps/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
        ...selectoresDeImporteEnApps,
      ],
    },
  },
];

module.exports = { bloques };
