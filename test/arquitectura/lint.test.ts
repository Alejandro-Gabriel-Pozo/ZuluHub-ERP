import { readdirSync, readFileSync } from "node:fs";
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
 * R-W1 y R-W3 (W1). Previenen, respectivamente, variables de entorno leídas sin validar y un contexto
 * con persona armado fuera de `src/composicion/contextos.ts`. Cada una con su violación inyectada y el
 * caso permitido que no debe dispararla. Se prueba con las reglas de la web más las del dinero, como
 * las ve ESLint sobre un archivo de `src/composicion`: ninguna tapa a la otra.
 */
describe("lint de la web y la composición (R-W1, R-W3)", () => {
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
      ...(bloques as never[]),
      ...(bloquesDeWeb as never[]),
    ],
  });
  const mensajesWeb = async (ruta: string, codigo: string): Promise<string[]> => {
    const [resultado] = await eslintWeb.lintText(codigo, { filePath: ruta });
    return (resultado?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
  };

  describe("R-W1: process solo en src/composicion/entorno.ts", () => {
    it.each([
      ["process.env", "export const a = process.env.X;"],
      ["process.env con corchetes", 'export const a = process.env["X"];'],
      ["desestructurar env", "const { env } = process;\nexport const a = env.X;"],
      ["un alias de process", "const p = process;\nexport const a = p.env.X;"],
      ["globalThis.process", "export const a = globalThis.process.env.X;"],
      ["importar process", 'import { env } from "node:process";\nexport const a = env.X;'],
      ["importar process sin prefijo", 'import process from "process";\nexport const a = process;'],
    ])("se prohíbe %s en la composición, en los módulos y en apps", async (_nombre, codigo) => {
      expect(await mensajesWeb("src/composicion/web.ts", codigo)).not.toEqual([]);
      expect(await mensajesWeb("src/modulos/empresas/casos-de-uso/x.ts", codigo)).not.toEqual([]);
      expect(await mensajesWeb("src/adaptadores/correo/x.ts", codigo)).not.toEqual([]);
      expect(await mensajesWeb("apps/web/servidor/x.ts", codigo)).not.toEqual([]);
      expect(await mensajesWeb("apps/web/app/s/neutra/x.tsx", codigo)).not.toEqual([]);
    });

    it("en entorno.ts, en las pruebas y en scripts/ sí se permite", async () => {
      const codigo = "export const a = process.env.X;";
      expect(await mensajesWeb("src/composicion/entorno.ts", codigo)).toEqual([]);
      expect(await mensajesWeb("src/composicion/entorno.test.ts", codigo)).toEqual([]);
      expect(await mensajesWeb("test/integracion/global.ts", codigo)).toEqual([]);
      expect(await mensajesWeb("scripts/migrar.ts", codigo)).toEqual([]);
    });

    it("un parámetro o una propiedad llamados env no se confunden con el entorno", async () => {
      expect(
        await mensajesWeb(
          "src/composicion/web.ts",
          "export const a = (entorno: { env: string }) => entorno.env;",
        ),
      ).toEqual([]);
    });
  });

  describe("R-W3: contextos con persona solo en src/composicion/contextos.ts", () => {
    it.each([
      [
        "OPERATIVO",
        'export const c = { tipo: "OPERATIVO", empresaId, personaId, marcaDeEntrada, ahora };',
      ],
      ["INVITACION", 'export const c = { tipo: "INVITACION", tokenHash, ahora };'],
      ["SESION", 'export const c = { tipo: "SESION", usuarioAuth, ahora };'],
      ["GRUPO", 'export const c = { tipo: "GRUPO", tenantId, personaId, ahora };'],
      ["PLATAFORMA", 'export const c = { tipo: "PLATAFORMA", actor, ahora };'],
      ["clave entre comillas", 'export const c = { "tipo": "OPERATIVO", empresaId };'],
      [
        "con as const",
        'export const c = { tipo: "OPERATIVO" as const, empresaId, marcaDeEntrada };',
      ],
      [
        "tipado como Contexto",
        'export const c: Contexto = { tipo: "OPERATIVO", empresaId, marcaDeEntrada };',
      ],
    ])("se prohíbe armar un contexto %s fuera de contextos.ts", async (_nombre, codigo) => {
      expect(await mensajesWeb("apps/web/servidor/x.ts", codigo)).not.toEqual([]);
      expect(await mensajesWeb("apps/web/app/s/app/x.tsx", codigo)).not.toEqual([]);
      expect(await mensajesWeb("src/composicion/web.ts", codigo)).not.toEqual([]);
    });

    it("contextos.ts y las pruebas sí pueden armarlos", async () => {
      const codigo = 'export const c = { tipo: "OPERATIVO", empresaId, marcaDeEntrada };';
      expect(await mensajesWeb("src/composicion/contextos.ts", codigo)).toEqual([]);
      expect(await mensajesWeb("src/composicion/contextos.test.ts", codigo)).toEqual([]);
      expect(await mensajesWeb("test/integracion/entorno.ts", codigo)).toEqual([]);
    });

    it("otras propiedades tipo y otros valores no se tocan", async () => {
      expect(
        await mensajesWeb(
          "apps/web/servidor/x.ts",
          'export const a = { tipo: "ERROR_DE_PRUEBA" };',
        ),
      ).toEqual([]);
      expect(
        await mensajesWeb("apps/web/servidor/x.ts", 'export const a = { clase: "OPERATIVO" };'),
      ).toEqual([]);
      expect(
        await mensajesWeb(
          "apps/web/servidor/x.ts",
          'export const a = { tipo: "TRABAJOS", ahora };',
        ),
      ).toEqual([]);
    });

    it("convive con las reglas de la web y del dinero: ninguna tapa a la otra", async () => {
      expect(
        await mensajesWeb(
          "apps/web/app/s/neutra/x.tsx",
          "export const a = <div dangerouslySetInnerHTML={x} />;",
        ),
      ).not.toEqual([]);
      expect(
        await mensajesWeb("src/composicion/web.ts", "export const a = b as Importe;"),
      ).not.toEqual([]);
    });
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

/**
 * C-2 (D10): la plantilla de la carta no fija la letra en `px`. Previene que un tamaño fijo ignore el que el
 * comensal configuró y el control «Letra». Chequeo: las violaciones inyectadas de acá (JavaScript; los `.css`
 * se prueban en `reglas.test.ts`) y que el bloque conserve las demás reglas de la web.
 */
describe("lint de la letra de la carta (D10)", () => {
  const { bloques: bloquesDeWeb } = require("../../arquitectura/lint-web.cjs") as {
    bloques: ESLint.Options["baseConfig"] extends infer T ? Exclude<T, null> : never;
  };
  const eslintCarta = new ESLint({
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
  const mensajesCarta = async (ruta: string, codigo: string): Promise<string[]> => {
    const [resultado] = await eslintCarta.lintText(codigo, { filePath: ruta });
    return (resultado?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
  };
  const carta = "apps/web/ui/plantillas/carta/X.tsx";

  it.each([
    ["en px como texto", 'export const a = <p style={{ fontSize: "18px" }} />;'],
    ["en px con espacio", 'export const a = <p style={{ fontSize: "18 px" }} />;'],
    ["con un número (React lo toma como px)", "export const a = <p style={{ fontSize: 18 }} />;"],
  ])("se prohíbe fontSize %s", async (_nombre, codigo) => {
    expect((await mensajesCarta(carta, codigo)).join("\n")).toContain("D10");
  });

  it("rem y em pasan, y fuera de la carta no aplica", async () => {
    expect(
      await mensajesCarta(carta, 'export const a = <p style={{ fontSize: "1.125rem" }} />;'),
    ).toEqual([]);
    expect(
      await mensajesCarta(carta, 'export const a = <p style={{ fontSize: "1em" }} />;'),
    ).toEqual([]);
    expect(
      await mensajesCarta(
        "apps/web/ui/componentes/X.tsx",
        'export const a = <p style={{ fontSize: "18px" }} />;',
      ),
    ).toEqual([]);
  });

  it("conserva las otras reglas de la web dentro de la carta (R-W8 y R-W10)", async () => {
    const mensajes = (
      await mensajesCarta(
        carta,
        "export const a = <div dangerouslySetInnerHTML={x} {...{ importe: 1 }} />;",
      )
    ).join("\n");
    expect(mensajes).toContain("R-W8");
    expect(mensajes).toContain("R-W10");
  });
});

/**
 * Regla `sin-host-reenviado`. Previene: que un cliente falsifique la identidad del host (y con ella la
 * marca) mandando el encabezado reenviado de host; la identidad es SOLO la cabecera `host`. Se busca la
 * cadena (cualquier capitalización) en todo `apps/**` y `src/**`, como literal, clave o argumento. Solo
 * quedan afuera las pruebas (`*.test.ts*`), que verifican justamente que NO se lee. Chequeo: el caso
 * inyectado de acá. Agregarla después costaría una marca ajena en producción antes de enterarse.
 */
describe("sin-host-reenviado", () => {
  const CADENA = /x-forwarded-host/i;
  const esPrueba = (f: string) => /\.test\.tsx?$/.test(f);
  function infractores(raiz: string, leer: (f: string) => string, archivos: string[]): string[] {
    void raiz;
    return archivos.filter((f) => !esPrueba(f) && CADENA.test(leer(f)));
  }

  it("detecta la cadena en cualquier forma, y no en las pruebas", () => {
    const fuentes: Record<string, string> = {
      "apps/web/a.ts": 'h.get("X-Forwarded-Host")',
      "src/b.ts": "const x = { 'x-forwarded-host': 1 };",
      "src/c.ts": "// X-FORWARDED-HOST",
      "src/d.test.ts": '"x-forwarded-host"',
      "apps/web/e.tsx": 'const ok = h.get("host");',
    };
    expect(infractores("", (f) => fuentes[f] as string, Object.keys(fuentes))).toEqual([
      "apps/web/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("el repositorio real no la usa fuera de las pruebas", () => {
    const archivos = [...glob("apps"), ...glob("src")];
    expect(archivos.length).toBeGreaterThan(100);
    expect(infractores("", (f) => readFileSync(f, "utf8"), archivos)).toEqual([]);
  });
});

function glob(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/(^|[\\/])(node_modules|\.next)[\\/]/.test(f))
    .map((f) => `${dir}/${f}`.replaceAll("\\", "/"));
}
