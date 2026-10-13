import { ESLint } from "eslint";
import { createRequire } from "node:module";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

/**
 * Cada regla de lint del dinero tiene una violación inyectada que la dispara y un caso permitido
 * que no (caso 0b §5). Se usa el parser de TypeScript sin información de tipos: las reglas son
 * sintácticas.
 */

const require = createRequire(import.meta.url);
const { bloques } = require("../../arquitectura/lint-dinero.cjs") as {
  bloques: ESLint.Options["baseConfig"] extends infer T ? Exclude<T, null> : never;
};

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...(bloques as never[]),
  ],
});

async function mensajes(ruta: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: ruta });
  return (resultado?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
}

describe("lint del dinero", () => {
  const fueraDeLasPrimitivas = "src/modulos/fiscal/dominio/x.ts";
  const dentroDeDinero = "src/primitivas/dinero/x.ts";

  it.each([
    ["as sobre Importe", "const a = b as Importe;"],
    ["as sobre MontoExacto vía unknown", "const a = b as unknown as MontoExacto;"],
    ["as sobre Cantidad", "const a = b as Cantidad;"],
    ["aserción angular sobre Porcentaje", "const a = <Porcentaje>b;"],
    ["as sobre PrecioUnitario", "const a = b as PrecioUnitario;"],
    ["as sobre Moneda", "const a = b as Moneda;"],
  ])("fuera de las primitivas se prohíbe: %s", async (_nombre, codigo) => {
    expect(await mensajes(fueraDeLasPrimitivas, codigo)).not.toEqual([]);
  });

  it("fuera de las primitivas sí se permite el as sobre otros tipos, y dentro de ellas sobre los de dinero", async () => {
    expect(await mensajes(fueraDeLasPrimitivas, "const a = b as string;")).toEqual([]);
    expect(await mensajes(fueraDeLasPrimitivas, "const a = b as ImporteJson;")).toEqual([]);
    expect(await mensajes("src/primitivas/dinero/interno.ts", "const a = b as Importe;")).toEqual(
      [],
    );
  });

  it.each([
    ["Number(", "const a = Number(x);"],
    ["parseFloat(", "const a = parseFloat(x);"],
    ["parseInt(", "const a = parseInt(x, 10);"],
    ["Number.parseFloat(", "const a = Number.parseFloat(x);"],
    ["Number.parseInt(", "const a = Number.parseInt(x, 10);"],
    ["+ unario", "const a = +x;"],
    ["Math.", "const a = Math.round(x);"],
  ])("dentro de primitivas/dinero y cantidad se prohíbe: %s", async (_nombre, codigo) => {
    expect(await mensajes(dentroDeDinero, codigo)).not.toEqual([]);
    expect(await mensajes("src/primitivas/cantidad/x.ts", codigo)).not.toEqual([]);
  });

  it("fuera de esas carpetas Number sigue permitido (la regla es solo de dinero)", async () => {
    expect(await mensajes(fueraDeLasPrimitivas, "const a = Number(x);")).toEqual([]);
    expect(await mensajes(dentroDeDinero, "const a = BigInt(x) + 1n;")).toEqual([]);
  });
});

/**
 * R-W8: sin `dangerouslySetInnerHTML` en `apps/**`. Previene que el texto de una marca (nombre,
 * vocabulario) se pinte como HTML. Sin `eslint-plugin-react` la regla es un selector sobre el atributo.
 */
describe("lint de la web (R-W8)", () => {
  const { bloques: bloquesDeWeb } = require("../../arquitectura/lint-web.cjs") as {
    bloques: ESLint.Options["baseConfig"] extends infer T ? Exclude<T, null> : never;
  };
  const eslintWeb = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      ...(bloquesDeWeb as never[]),
    ],
  });
  const mensajesWeb = async (ruta: string, codigo: string): Promise<string[]> => {
    const [resultado] = await eslintWeb.lintText(codigo, { filePath: ruta });
    return (resultado?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
  };
  const pantalla = "apps/web/app/s/neutra/x.tsx";

  it.each([
    ["como atributo", "export const a = <div dangerouslySetInnerHTML={{ __html: marca }} />;"],
    ["en un componente propio", "export const a = <Texto dangerouslySetInnerHTML={x} />;"],
    ["por un objeto expandido", "export const a = <div {...{ dangerouslySetInnerHTML: x }} />;"],
  ])("se prohíbe %s", async (_nombre, codigo) => {
    expect(await mensajesWeb(pantalla, codigo)).not.toEqual([]);
  });

  it("el texto normal y otros atributos pasan", async () => {
    expect(await mensajesWeb(pantalla, "export const a = <div title={t}>{texto}</div>;")).toEqual(
      [],
    );
  });
});
