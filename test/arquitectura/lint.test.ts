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

/**
 * R-W10: en `apps/**` un importe, total o precio no es `number`. Previene un importe como `number` en un
 * formulario o en una prop ([A006], ADR-006): pierde centavos sin avisar. Chequeo: las violaciones
 * inyectadas de acá, en `.tsx` y `.ts`; y que la configuración REAL de ESLint aplique R-W8 y R-W10 juntas
 * (ESLint no combina las opciones de `no-restricted-syntax` entre bloques: el último reemplazaría al otro).
 */
describe("lint del dinero en la web (R-W10)", () => {
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
  const componente = "apps/web/ui/componentes/x.tsx";

  it.each([
    ["prop importe en una interfaz", "interface P { importe: number }"],
    ["prop total en un tipo", "type P = { total: number };"],
    ["prop opcional", "type P = { precio?: number };"],
    ["prop que admite null", "type P = { precio: number | null };"],
    ["compuesto importeNeto", "type P = { importeNeto: number };"],
    ["compuesto totalConIva", "type P = { totalConIva: number };"],
    ["compuesto precioUnitario", "type P = { precioUnitario: number };"],
    ["compuesto con guion bajo", "type P = { total_final: number };"],
    ["variable", "const importe: number = 0;"],
    ["parámetro", "export function f(total: number) { return total; }"],
    [
      "parámetro opcional con unión",
      "export function f(precio: number | undefined) { return precio; }",
    ],
    ["campo de clase", "class C { total: number = 0; }"],
    ["campo de objeto con un número", "export const a = { importe: 12.5 };"],
    ["campo de objeto con un entero", "export const a = { total: 0 };"],
    ["campo de objeto con signo", "export const a = { precio: -3 };"],
    ["prop JSX con un número", "export const a = <Campo importe={12.5} />;"],
  ])("se prohíbe %s (.tsx)", async (_nombre, codigo) => {
    const mensajes = await mensajesWeb(componente, codigo);
    expect(mensajes.some((m) => m.includes("R-W10"))).toBe(true);
  });

  it("también en un .ts de apps (acciones del servidor, tipos compartidos)", async () => {
    const mensajes = await mensajesWeb("apps/web/servidor/x.ts", "type P = { importe: number };");
    expect(mensajes.some((m) => m.includes("R-W10"))).toBe(true);
  });

  it.each([
    ["texto decimal", "type P = { importe: string };"],
    ["total como texto", "type P = { total: string; precio?: string };"],
    ["el tipo de dinero", "type P = { importe: ImporteJson; precioUnitario: PrecioUnitarioJson };"],
    ["un contador que no es dinero", "type P = { cantidadDePaginas: number; totales: number };"],
    ["totalizar no es un total", "type P = { totalizar: number; preciosVisibles: number };"],
    ["otro nombre numérico", "type P = { pagina: number; alto: number };"],
    ["valor en texto", 'export const a = { importe: "12.50", total: "0.00" };'],
    ["prop JSX con texto", 'export const a = <Campo importe="12.50" />;'],
    ["prop JSX con una variable", "export const a = <Campo importe={valor} />;"],
  ])("se permite %s", async (_nombre, codigo) => {
    const mensajes = await mensajesWeb(componente, codigo);
    expect(mensajes.filter((m) => m.includes("R-W10"))).toEqual([]);
  });

  it("R-W8 y R-W10 conviven en el mismo archivo", async () => {
    const mensajes = await mensajesWeb(
      componente,
      "export const a = <div dangerouslySetInnerHTML={x} {...{ importe: 1 }} />;",
    );
    expect(mensajes.some((m) => m.includes("R-W8"))).toBe(true);
    expect(mensajes.some((m) => m.includes("R-W10"))).toBe(true);
  });

  it("la configuración real de ESLint aplica las dos reglas juntas en apps/**", async () => {
    const real = new ESLint();
    for (const ruta of [
      "apps/web/ui/componentes/x.tsx",
      "apps/web/app/x.tsx",
      "apps/web/servidor/x.ts",
    ]) {
      const configuracion = (await real.calculateConfigForFile(ruta)) as {
        rules: Record<string, unknown[]>;
      };
      const opciones = JSON.stringify(configuracion.rules["no-restricted-syntax"]);
      expect(opciones, ruta).toContain("(R-W8)");
      expect(opciones, ruta).toContain("(ADR-006, R-W10)");
    }
  });
});
