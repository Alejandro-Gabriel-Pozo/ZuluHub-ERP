import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  LINEA_DE_USO,
  SIN_CONTRATOS,
  TOKENS,
  codigos,
  contrato,
  contratoDeRadio,
  correr,
  declaracion,
  type Detector,
} from "./guardian-apoyo";

/**
 * Unidades, declaración y comparación declaración-uso. Cada falla del guardián tiene acá su violación
 * inyectada: el uso se deduce del código, y ninguna etiqueta lo silencia.
 */

const require = createRequire(import.meta.url);
const { unidadDe, descubrirUnidades } =
  require("../../arquitectura/contratos/declaraciones.cjs") as {
    unidadDe: (ruta: string) => string | null;
    descubrirUnidades: (rutas: string[]) => Map<string, string[]>;
  };
const { NIVELES } = require("../../arquitectura/contratos/clasificacion.cjs") as {
  NIVELES: { nombre: string; reglas: { clase: string; glob: string }[] }[];
};

const WEB = "apps/web/contratos.json";
const CSS_CON_USO = "apps/web/ui/Linea.module.css";

describe("unidades", () => {
  it.each([
    ["src/modulos/fiscal/dominio/factura.ts", "src/modulos/fiscal"],
    ["src/modulos/fiscal/contratos.json", "src/modulos/fiscal"],
    ["src/primitivas/dinero/dinero.ts", "src/primitivas"],
    ["src/consultas-de-grupo/publico.ts", "src/consultas-de-grupo"],
    ["apps/web/ui/tokens.css", "apps/web"],
    ["scripts/migrar-base.ts", "scripts"],
    ["migraciones/0001_base.sql", "migraciones"],
    ["workers/cola.ts", "workers"],
    ["test/arquitectura/reglas.test.ts", null],
    ["arquitectura/reglas.cjs", null],
    [".github/workflows/ci.yml", null],
    ["package.json", null],
    ["src/modulos/suelto.ts", null],
    ["apps/suelto.ts", null],
  ])("«%s» pertenece a %s", (ruta, unidad) => {
    expect(unidadDe(ruta)).toBe(unidad);
  });

  it("las unidades se descubren solas desde las rutas versionadas", () => {
    const unidades = descubrirUnidades([
      "src/modulos/a/x.ts",
      "src/modulos/b/x.ts",
      "src/capacidades/p/x.ts",
      "src/puertos/p.ts",
      "apps/web/app/page.tsx",
      "scripts/s.ts",
      "package.json",
    ]);
    expect([...unidades.keys()]).toEqual([
      "apps/web",
      "scripts",
      "src/capacidades",
      "src/modulos/a",
      "src/modulos/b",
      "src/puertos",
    ]);
  });
});

describe("declaración por unidad: faltas y formato", () => {
  it("el repositorio sintético, con todo declarado, pasa", () => {
    const resultado = correr();
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.resultado).toBe("pasa");
  });

  it("una unidad nueva sin contratos.json falla (módulo nuevo)", () => {
    const resultado = correr({
      archivos: { "src/modulos/nuevo/dominio/x.ts": "export {};" },
      niveles: [
        {
          nombre: "módulo nuevo ya clasificado",
          reglas: [{ clase: "backend", glob: "src/modulos/nuevo/**" }],
        },
        ...NIVELES,
      ],
    });
    const falla = resultado.fallas.find((f) => f.codigo === "unidad-sin-declaracion");
    expect(falla).toMatchObject({ archivo: "src/modulos/nuevo/contratos.json" });
    expect(falla?.motivo).toContain("src/modulos/nuevo");
    expect(codigos(resultado)).toEqual(["unidad-sin-declaracion"]);
  });

  it("un módulo nuevo sin clase ni declaración falla por las dos cosas", () => {
    const resultado = correr({ archivos: { "src/modulos/nuevo/dominio/x.ts": "export {};" } });
    expect(codigos(resultado).sort()).toEqual(["ruta-sin-clase", "unidad-sin-declaracion"]);
  });

  it.each([
    ["la de la web", WEB],
    ["la de un módulo", "src/modulos/empresas/contratos.json"],
    ["la de un grupo de src", "src/capacidades/contratos.json"],
    ["la de scripts", "scripts/contratos.json"],
    ["la de migraciones", "migraciones/contratos.json"],
  ])("borrar la declaración: %s", (_nombre, archivo) => {
    const resultado = correr({ archivos: { [archivo]: null } });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({ codigo: "unidad-sin-declaracion", archivo });
  });

  it.each([
    ["JSON roto", "{ usa: ["],
    ["una lista en vez de un objeto", "[]"],
    ["un objeto vacío (ni usa ni noUsa)", "{}"],
    ["usa vacío sin noUsa", '{"usa": []}'],
    ["noUsa vacío", '{"noUsa": ""}'],
    ["noUsa con solo espacios", '{"usa": [], "noUsa": "   "}'],
    ["noUsa que no es texto", '{"noUsa": 5}'],
    ["usa que no es una lista", '{"usa": "color-separador"}'],
    ["usa con un id vacío", '{"usa": [""]}'],
    ["usa con un id repetido", '{"usa": ["color-separador", "color-separador"]}'],
    ["usa con ids y noUsa a la vez", '{"usa": ["color-separador"], "noUsa": "x"}'],
    ["un campo que no es del esquema", '{"usa": [], "noUsa": "x", "extra": 1}'],
  ])("declaración inválida: %s", (_nombre, contenido) => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: { [WEB]: contenido },
    });
    expect(resultado.fallas.length).toBeGreaterThan(0);
    expect(resultado.fallas.every((f) => f.codigo === "declaracion-invalida")).toBe(true);
    expect(resultado.fallas[0]?.archivo).toBe(WEB);
  });

  it("declarar un contrato que no existe en el registro falla", () => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: { [WEB]: declaracion(["fantasma"]) },
    });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({
      codigo: "declara-contrato-inexistente",
      archivo: WEB,
      contrato: "fantasma",
    });
  });
});

describe("comparación declaración-uso (el uso real se deduce del código)", () => {
  const conUso = { [CSS_CON_USO]: `${LINEA_DE_USO}\n` };

  it("(a) uso sin declarar: la unidad usa un contrato que no declara; falla con archivo:línea", () => {
    const resultado = correr({
      contratos: [contrato(), contratoDeRadio()],
      archivos: {
        ...conUso,
        "apps/web/ui/Esquina.module.css":
          ".a { margin: 0; }\n.b { border-radius: var(--radio); }\n",
        [WEB]: declaracion(["radio-unico"]),
      },
    });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({
      codigo: "uso-sin-declarar",
      archivo: CSS_CON_USO,
      linea: 1,
      contrato: "color-separador",
    });
    expect(resultado.fallas[0]?.motivo).toContain("apps/web");
    expect(resultado.fallas[0]?.correccion).toContain("apps/web/contratos.json");
  });

  it("(a) cada línea con uso sin declarar es un hallazgo propio", () => {
    const resultado = correr({
      contratos: [contrato(), contratoDeRadio()],
      archivos: {
        [CSS_CON_USO]: `${LINEA_DE_USO}\n.x {}\n${LINEA_DE_USO}\n`,
        "apps/web/ui/Esquina.module.css": ".b { border-radius: var(--radio); }\n",
        [WEB]: declaracion(["radio-unico"]),
      },
    });
    expect(resultado.fallas.map((f) => [f.codigo, f.linea])).toEqual([
      ["uso-sin-declarar", 1],
      ["uso-sin-declarar", 3],
    ]);
  });

  it("(b) declaración falsa: declarada y sin ningún uso falla si el contrato lo exige", () => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: { [WEB]: declaracion(["color-separador"]) },
    });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({
      codigo: "declaracion-falsa",
      archivo: WEB,
      contrato: "color-separador",
    });
  });

  it("(b) declaración falsa: si el contrato no la bloquea, es solo un aviso", () => {
    const resultado = correr({
      contratos: [contrato({ bloqueaDeclaracionFalsa: false })],
      archivos: { [WEB]: declaracion(["color-separador"]) },
    });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.resultado).toBe("pasa");
    expect(resultado.avisos.map((a) => a.codigo)).toEqual(["declaracion-falsa"]);
  });

  it("(b) agregar la etiqueta no silencia ni inventa nada: con uso real y declarado pasa, sin uso falla", () => {
    const conEtiquetaYUso = correr({
      contratos: [contrato()],
      archivos: { ...conUso, [WEB]: declaracion(["color-separador"]) },
    });
    expect(conEtiquetaYUso.fallas).toEqual([]);
    const soloEtiqueta = correr({
      contratos: [contrato()],
      archivos: { [WEB]: declaracion(["color-separador"]) },
    });
    expect(codigos(soloEtiqueta)).toEqual(["declaracion-falsa"]);
  });

  it("(c) noUsa falso: declara no depender de nada y hay un uso", () => {
    const resultado = correr({ contratos: [contrato()], archivos: conUso });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({
      codigo: "no-usa-falso",
      archivo: CSS_CON_USO,
      linea: 1,
      contrato: "color-separador",
    });
    expect(resultado.fallas[0]?.motivo).toContain("Sin contratos todavía.");
  });

  it("declarar el contrato en OTRA unidad no cubre el uso de esta", () => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: {
        ...conUso,
        [WEB]: declaracion(["color-separador"]),
        "src/capacidades/permisos/estilo.ts": "export const c = 'var(--color-separador)';\n",
      },
    });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({
      codigo: "no-usa-falso",
      archivo: "src/capacidades/permisos/estilo.ts",
      linea: 1,
    });
  });

  it("un uso en una clase que el detector no mira (pruebas) no cuenta", () => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: { "test/estilo.test.ts": "const c = 'var(--color-separador)';\n" },
    });
    expect(resultado.fallas).toEqual([]);
  });

  it("un uso fuera de toda unidad no se compara con declaraciones, pero queda en el informe", () => {
    const registro = contrato({
      deteccion: [
        ...(contrato().deteccion as Detector[]),
        {
          tipo: "uso",
          clases: ["pruebas"],
          nombre: "uso en pruebas",
          reconoce: (c: string) =>
            c.includes("var(--color-separador)") ? [{ linea: 1, texto: c }] : [],
        },
      ],
    });
    const resultado = correr({
      contratos: [registro],
      archivos: { "test/estilo.test.ts": "const c = 'var(--color-separador)';\n" },
    });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.usosFueraDeUnidades).toEqual([
      expect.objectContaining({ archivo: "test/estilo.test.ts", linea: 1 }),
    ]);
  });

  it("(d) definición fuera de la fuente de verdad: valor copiado, aunque coincida", () => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: {
        "apps/web/ui/Copia.module.css": ".a {}\n:root {\n  --color-separador: #cccccc;\n}\n",
      },
    });
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({
      codigo: "definicion-fuera-de-la-fuente",
      archivo: "apps/web/ui/Copia.module.css",
      linea: 3,
      contrato: "color-separador",
    });
    expect(resultado.fallas[0]?.motivo).toContain("apps/web/ui/tokens.css");
  });

  it("la definición dentro de la fuente de verdad no es una falla", () => {
    const resultado = correr({ contratos: [contrato()] });
    expect(resultado.fallas).toEqual([]);
    expect(TOKENS).toContain("--color-separador");
  });

  it.each([
    ["el archivo de la fuente no existe", { "apps/web/ui/tokens.css": null }, "tokens.css"],
    [
      "el archivo existe pero no contiene la variable",
      { "apps/web/ui/tokens.css": ":root {\n  --otra: 1;\n}\n" },
      "--color-separador",
    ],
  ])("(e) contrato sin fuente: %s", (_nombre, archivos, mencion) => {
    const resultado = correr({ contratos: [contrato()], archivos });
    const falla = resultado.fallas.find((f) => f.codigo === "contrato-sin-fuente");
    expect(falla).toMatchObject({ archivo: "apps/web/ui/tokens.css", contrato: "color-separador" });
    expect(`${falla?.motivo ?? ""}${falla?.correccion ?? ""}`).toContain(mencion);
  });

  it("(e) la fuente por exportación se busca como palabra entera", () => {
    const soloUso = [(contrato().deteccion as Detector[])[0]];
    const delArchivo = "src/capacidades/permisos/permisos.ts";
    const registro = contrato({
      fuenteDeVerdad: { archivo: delArchivo, exportacion: "permiso" },
      deteccion: soloUso,
    });
    expect(correr({ contratos: [registro] }).fallas).toEqual([]);
    const otra = contrato({
      fuenteDeVerdad: { archivo: delArchivo, exportacion: "perm" },
      deteccion: soloUso,
    });
    expect(codigos(correr({ contratos: [otra] }))).toEqual(["contrato-sin-fuente"]);
  });

  it("un detector que devuelve una línea fuera del archivo falla, no se ignora", () => {
    const registro = contrato({
      deteccion: [
        {
          tipo: "uso",
          clases: ["frontend"],
          nombre: "roto",
          reconoce: () => [{ linea: 99, texto: "x" }],
        },
      ],
    });
    const resultado = correr({ contratos: [registro] });
    expect(resultado.fallas.map((f) => f.codigo)).toContain("detector-invalido");
  });

  it("un detector que lanza un error falla, no se ignora", () => {
    const registro = contrato({
      deteccion: [
        {
          tipo: "uso",
          clases: ["frontend"],
          nombre: "explota",
          reconoce: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    const resultado = correr({ contratos: [registro] });
    expect(resultado.fallas.map((f) => f.codigo)).toContain("detector-invalido");
    expect(resultado.fallas[0]?.motivo).toContain("boom");
  });

  it("el informe lista las reglas ejecutadas con el detector y sus clases", () => {
    const resultado = correr({ contratos: [contrato()] });
    expect(resultado.informe.reglasEjecutadas.detectores).toEqual([
      {
        contrato: "color-separador",
        detector: "uso de la variable",
        tipo: "uso",
        clases: ["frontend", "backend"],
      },
      {
        contrato: "color-separador",
        detector: "definición de la variable",
        tipo: "definicion",
        clases: ["frontend"],
      },
    ]);
  });

  it("la declaración con noUsa y sin uso real pasa", () => {
    const resultado = correr({
      contratos: [contrato()],
      archivos: { [WEB]: SIN_CONTRATOS },
    });
    expect(resultado.fallas).toEqual([]);
  });
});
