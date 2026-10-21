import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { HAY_GIT, RAIZ, cargarDelRepo } from "./guardian-apoyo";

/**
 * Clasificación de rutas: el matcher de globs mínimo, las reglas por niveles y la clasificación
 * completa de las rutas reales. Toda ruta cae en UNA clase; si no cae en ninguna, o cae en dos
 * distintas al mismo nivel, falla.
 */

type Nivel = { nombre: string; reglas: { clase: string; glob: string }[] };
type Clasificacion = {
  porRuta: Map<string, string>;
  porClase: Record<string, string[]>;
  reglas: { glob: string; rutas: number }[];
  fallas: { codigo: string; archivo: string; motivo: string; correccion: string }[];
};
const require = createRequire(import.meta.url);
const { compilar, esRutaExacta, segmentoARegexp } =
  require("../../arquitectura/contratos/globs.cjs") as {
    compilar: (glob: string) => RegExp;
    esRutaExacta: (ruta: string) => boolean;
    segmentoARegexp: (segmento: string) => string;
  };
const coincide = (glob: string, ruta: string): boolean => compilar(glob).test(ruta);
const {
  clasificar,
  CLASES,
  CLASES_ESPERADAS,
  CLASES_EXCLUIBLES,
  EXTENSIONES_DE_CODIGO,
  PERMITIDO_EN_CLASE_EXCLUIDA,
  revisarClasesExcluidas,
} = require("../../arquitectura/contratos/clasificacion.cjs") as {
  clasificar: (rutas: string[], opciones?: { niveles?: Nivel[] }) => Clasificacion;
  CLASES: string[];
  CLASES_ESPERADAS: string[];
  CLASES_EXCLUIBLES: string[];
  EXTENSIONES_DE_CODIGO: string[];
  PERMITIDO_EN_CLASE_EXCLUIDA: Record<string, { extensiones: string[]; rutas: string[] }>;
  revisarClasesExcluidas: (
    porClase: Record<string, string[]>,
    opciones?: { excluibles?: string[]; permitidoPorClase?: object },
  ) => { archivo: string; motivo: string }[];
  NIVELES: Nivel[];
};

describe("matcher de globs", () => {
  it.each([
    ["*.md", "README.md", true],
    ["*.md", "docs/README.md", false],
    ["**/*.md", "README.md", true],
    ["**/*.md", "a/b/c.md", true],
    ["**/*.md", "a/b/c.mdx", false],
    ["a/**", "a/b", true],
    ["a/**", "a/b/c/d.ts", true],
    ["a/**", "a", false],
    ["a/**", "ab/c", false],
    ["a/**/b.ts", "a/b.ts", true],
    ["a/**/b.ts", "a/x/y/b.ts", true],
    ["a/*/b.ts", "a/x/b.ts", true],
    ["a/*/b.ts", "a/x/y/b.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["src/?.ts", "src/ab.ts", false],
    ["x.ts", "xyts", false],
    ["**/golden/**", "src/m/dominio/golden/a.txt", true],
    ["**/golden/**", "golden/a.txt", true],
    ["**/golden/**", "src/m/golden", false],
    ["**", "cualquier/cosa.ts", true],
    ["README.md", "readme.md", false],
    ["apps/web/app/**/route.ts", "apps/web/app/api/salud/route.ts", true],
    ["apps/web/app/**/route.ts", "apps/web/app/api/salud/page.tsx", false],
    ["apps/web/app/**", "apps/web/app/s/app/(entrada)/empresa/page.tsx", true],
    ["src/modulos/*/contratos.json", "src/modulos/fiscal/contratos.json", true],
    ["src/modulos/*/contratos.json", "src/modulos/fiscal/dominio/contratos.json", false],
  ])("«%s» sobre «%s» → %s", (glob, ruta, esperado) => {
    expect(coincide(glob, ruta)).toBe(esperado);
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["llaves", "src/{a,b}/x.ts"],
    ["corchetes", "src/[ab]/x.ts"],
    ["paréntesis", "src/(a)/x.ts"],
    ["negación", "!src/x.ts"],
    ["barra inicial", "/src/x.ts"],
    ["barra final", "src/"],
    ["barra doble", "src//x.ts"],
    ["** dentro de un segmento", "src/a**b/x.ts"],
    ["barra invertida", "src\\x.ts"],
  ])("rechaza un glob con %s", (_nombre, glob) => {
    expect(() => compilar(glob)).toThrow();
  });

  it.each([
    ["a+b.ts", "a+b.ts", "aab.ts"],
    ["a.b", "a.b", "axb"],
    ["a^b", "a^b", "ab"],
    ["a$b", "a$b", "ab"],
    ["a|b", "a|b", "a"],
  ])("el metacaracter de «%s» calza literal y no como regexp", (glob, literal, comoRegexp) => {
    expect(coincide(glob, literal)).toBe(true);
    expect(coincide(glob, comoRegexp)).toBe(false);
  });

  it.each(["\\", "{", "}", "(", ")", "[", "]", ".", "+", "^", "$", "|"])(
    "segmentoARegexp escapa «%s» como literal",
    (caracter) => {
      const regexp = new RegExp(`^${segmentoARegexp(`a${caracter}b`)}$`);
      expect(regexp.test(`a${caracter}b`)).toBe(true);
      expect(regexp.test("ab")).toBe(false);
    },
  );

  it("segmentoARegexp mantiene los comodines y escapa lo que los rodea", () => {
    expect(segmentoARegexp("*.{x}?")).toBe("[^/]*\\.\\{x\\}[^/]");
  });

  it.each([
    ["archivo", "apps/web/ui/Boton.module.css", true],
    [
      "carpetas de Next con paréntesis y corchetes",
      "apps/web/app/(entrada)/[...todo]/page.tsx",
      true,
    ],
    ["asterisco", "apps/web/ui/*.css", false],
    ["doble asterisco", "apps/**", false],
    ["interrogación", "apps/web/ui/Boton.module.cs?", false],
    ["llaves", "apps/{a,b}.ts", false],
    ["carpeta", "apps/web/ui/", false],
    ["punto punto", "apps/web/../web/ui/x.css", false],
    ["punto", "./apps/web/x.css", false],
    ["barra inicial", "/apps/web/x.css", false],
    ["vacía", "", false],
    ["con espacios en los extremos", " apps/x.ts", false],
  ])("ruta exacta: %s", (_nombre, ruta, esperado) => {
    expect(esRutaExacta(ruta)).toBe(esperado);
  });
});

describe("reglas de clasificación (con violaciones inyectadas)", () => {
  it.each([
    ["una carpeta de primer nivel nueva", "herramienta-nueva/x.ts"],
    ["un archivo nuevo en la raíz", ".editorconfig"],
    ["un módulo nuevo en src/modulos", "src/modulos/nuevo/dominio/x.ts"],
    ["una aplicación nueva en apps", "apps/otra/app/page.tsx"],
    ["una carpeta nueva en src", "src/nueva/x.ts"],
    ["un archivo suelto en src/modulos", "src/modulos/suelto.ts"],
    ["una carpeta renombrada (arquitectura → arq)", "arq/reglas.cjs"],
  ])("falla con archivo y mensaje: %s", (_nombre, ruta) => {
    const { fallas, porRuta } = clasificar(["package.json", ruta]);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toMatchObject({ codigo: "ruta-sin-clase", archivo: ruta });
    expect(fallas[0]?.motivo).toContain("no calza con ninguna clase");
    expect(fallas[0]?.correccion).toContain("clasificacion.cjs");
    expect(porRuta.has(ruta)).toBe(false);
  });

  const NIVELES_DE_PRUEBA: Nivel[] = [
    { nombre: "específico", reglas: [{ clase: "docs", glob: "src/leeme.txt" }] },
    {
      nombre: "general",
      reglas: [
        { clase: "backend", glob: "src/**" },
        { clase: "pruebas", glob: "**/*.txt" },
      ],
    },
  ];

  it("el primer nivel que calza decide, aunque un nivel posterior diga otra clase", () => {
    const { porRuta, fallas } = clasificar(["src/leeme.txt"], { niveles: NIVELES_DE_PRUEBA });
    expect(fallas).toEqual([]);
    expect(porRuta.get("src/leeme.txt")).toBe("docs");
  });

  it("dos reglas del mismo nivel que clasifican distinto fallan por ambigüedad", () => {
    const { fallas, porRuta } = clasificar(["src/notas.txt"], { niveles: NIVELES_DE_PRUEBA });
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toMatchObject({ codigo: "clasificacion-ambigua", archivo: "src/notas.txt" });
    expect(fallas[0]?.motivo).toContain("backend y pruebas");
    expect(porRuta.has("src/notas.txt")).toBe(false);
  });

  it("dos reglas del mismo nivel que dan la MISMA clase no son ambiguas", () => {
    const niveles: Nivel[] = [
      {
        nombre: "uno",
        reglas: [
          { clase: "backend", glob: "src/**" },
          { clase: "backend", glob: "**/*.ts" },
        ],
      },
    ];
    const { fallas, porRuta } = clasificar(["src/a.ts"], { niveles });
    expect(fallas).toEqual([]);
    expect(porRuta.get("src/a.ts")).toBe("backend");
  });

  it.each([
    ["una clase que no existe", [{ clase: "inventada", glob: "src/**" }]],
    ["un glob con llaves", [{ clase: "backend", glob: "src/{a,b}/**" }]],
    ["un glob vacío", [{ clase: "backend", glob: "" }]],
  ])("una tabla con %s invalida la clasificación entera", (_nombre, reglas) => {
    const { fallas, porRuta } = clasificar(["src/a.ts"], { niveles: [{ nombre: "roto", reglas }] });
    expect(fallas.map((f) => f.codigo)).toEqual(["regla-de-clasificacion-invalida"]);
    expect(porRuta.size).toBe(0);
  });

  it.each([
    ["package-lock.json", "generado"],
    ["skills-lock.json", "generado"],
    ["README.md", "docs"],
    ["test/fixtures/cartas/README.md", "docs"],
    [".claude/skills/neon/SKILL.md", "docs"],
    ["src/modulos/fiscal/contratos.json", "config"],
    ["apps/web/contratos.json", "config"],
    ["src/modulos/fiscal/dominio/factura.test.ts", "pruebas"],
    ["src/modulos/fiscal/dominio/golden/qr.golden.txt", "pruebas"],
    ["apps/web/ui/componentes/Boton.test.tsx", "pruebas"],
    ["test/utilidades/arca-grabaciones/corrida1/001-pedido.xml", "pruebas"],
    ["test/fixtures/fotos/foto-480.jpg", "pruebas"],
    ["migraciones/0001_base.sql", "migraciones"],
    ["migraciones/reversiones/0006_revertir_fiscal.sql", "migraciones"],
    ["scripts/migrar-base.ts", "scripts"],
    ["scripts/cargador-de-ts.mjs", "scripts"],
    ["workers/cola.ts", "workers"],
    ["apps/web/servidor/guarda.ts", "backend"],
    ["apps/web/proxy.ts", "backend"],
    ["apps/web/app/api/salud/route.ts", "backend"],
    ["apps/web/app/s/app/acciones.ts", "backend"],
    ["apps/web/app/s/app/(entrada)/empresa/page.tsx", "frontend"],
    ["apps/web/app/layout.tsx", "frontend"],
    ["apps/web/ui/tokens.css", "frontend"],
    ["apps/web/ui/componentes/Boton.module.css", "frontend"],
    ["apps/web/pantallas/errores.tsx", "frontend"],
    ["apps/web/next.config.ts", "config"],
    ["apps/web/vercel.json", "config"],
    ["apps/plataforma/contratos.json", "config"],
    ["apps/plataforma/servidor/ingreso.ts", "backend"],
    ["apps/plataforma/proxy.ts", "backend"],
    ["apps/plataforma/app/api/auth/[...todo]/route.ts", "backend"],
    ["apps/plataforma/app/ingreso/page.tsx", "frontend"],
    ["apps/plataforma/pantallas/ingreso.cliente.tsx", "frontend"],
    ["apps/plataforma/logica/ingreso.ts", "frontend"],
    ["apps/plataforma/next.config.ts", "config"],
    ["apps/plataforma/vercel.json", "config"],
    ["apps/plataforma/PRIMER-DESPLIEGUE.md", "docs"],
    ["src/modulos/fiscal/dominio/factura.ts", "backend"],
    ["src/primitivas/dinero/dinero.ts", "backend"],
    ["src/adaptadores/postgres/pool.ts", "backend"],
    ["src/composicion/web.ts", "backend"],
    ["arquitectura/reglas.cjs", "config"],
    [".github/workflows/ci.yml", "config"],
    ["package.json", "config"],
    ["eslint.config.js", "config"],
  ])("«%s» → %s", (ruta, clase) => {
    const { fallas, porRuta } = clasificar([ruta]);
    expect(fallas).toEqual([]);
    expect(porRuta.get(ruta)).toBe(clase);
  });
});

describe("clases excluidas del análisis: solo admiten lo permitido, nunca código", () => {
  /** Una tabla que manda TODO a la clase indicada: lo que cae ahí lo decide la lista de lo permitido. */
  const todoA = (clase: string): { niveles: Nivel[] } => ({
    niveles: [{ nombre: "todo", reglas: [{ clase, glob: "**" }] }],
  });
  const fallasDe = (clase: string, rutas: string[]) =>
    clasificar(rutas, todoA(clase)).fallas.map((f) => [f.codigo, f.archivo, f.motivo] as const);

  it("lo permitido hoy es exactamente esto (ampliarlo es una decisión del dueño)", () => {
    expect(PERMITIDO_EN_CLASE_EXCLUIDA).toEqual({
      docs: { extensiones: [".md", ".txt"], rutas: [] },
      generado: { extensiones: [], rutas: ["package-lock.json", "skills-lock.json"] },
    });
  });

  it("toda clase excluible tiene su lista y ninguna lista admite una extensión de código", () => {
    expect(Object.keys(PERMITIDO_EN_CLASE_EXCLUIDA).sort()).toEqual([...CLASES_EXCLUIBLES].sort());
    for (const permitido of Object.values(PERMITIDO_EN_CLASE_EXCLUIDA)) {
      for (const extension of permitido.extensiones) {
        expect(EXTENSIONES_DE_CODIGO).not.toContain(extension);
        expect(extension).toMatch(/^\.[a-z0-9]+$/);
      }
      for (const ruta of permitido.rutas) expect(ruta).not.toMatch(/[*?/]/);
    }
  });

  it("las extensiones de código son las del pedido, todas en minúsculas y con punto", () => {
    expect([...EXTENSIONES_DE_CODIGO].sort()).toEqual(
      [".ts", ".tsx", ".js", ".cjs", ".mjs", ".sql", ".yml", ".yaml", ".sh"].sort(),
    );
  });

  it.each(["docs", "generado"])(
    "una ruta de código en la clase «%s» falla con `codigo-en-clase-excluida`, en la ruta y línea 1",
    (clase) => {
      for (const extension of ["ts", "tsx", "js", "cjs", "mjs", "sql", "yml", "yaml", "sh"]) {
        const ruta = `lo/que/sea/ejecutable.${extension}`;
        const { fallas } = clasificar([ruta], todoA(clase));
        expect(fallas, ruta).toHaveLength(1);
        expect(fallas[0], ruta).toMatchObject({
          codigo: "codigo-en-clase-excluida",
          archivo: ruta,
          contrato: null,
        });
        expect(fallas[0]?.motivo, ruta).toContain(`es código («.${extension}»)`);
        expect(fallas[0]?.motivo, ruta).toContain(`«${clase}»`);
        expect(fallas[0]?.correccion, ruta).toContain("clasificacion.cjs");
      }
    },
  );

  it("la extensión se compara sin distinguir mayúsculas (`.TS` también es código; `.MD` es un documento)", () => {
    expect(fallasDe("docs", ["a/Script.TS", "a/Guia.MD", "a/Notas.Txt"]).map((f) => f[1])).toEqual([
      "a/Script.TS",
    ]);
  });

  it("lo permitido en docs pasa: .md y .txt, a cualquier profundidad, y las dobles extensiones valen por la última", () => {
    expect(
      fallasDe("docs", [
        "README.md",
        "a/b/c/guia.md",
        "notas.txt",
        ".claude/skills/neon/SKILL.md",
        "ejemplo.ts.md",
      ]),
    ).toEqual([]);
    expect(fallasDe("docs", ["ejemplo.md.ts"]).map((f) => f[1])).toEqual(["ejemplo.md.ts"]);
  });

  it("lo permitido en generado son SOLO los dos archivos de bloqueo, exactos y en la raíz", () => {
    expect(fallasDe("generado", ["package-lock.json", "skills-lock.json"])).toEqual([]);
    expect(
      fallasDe("generado", ["sub/package-lock.json", "otro-lock.json", "package-lock.json.ts"]).map(
        (f) => f[1],
      ),
    ).toEqual(["otro-lock.json", "package-lock.json.ts", "sub/package-lock.json"]);
  });

  it.each([
    ["una imagen en docs", "docs", ".claude/imagen.png"],
    ["un json en docs", "docs", "datos.json"],
    ["un archivo sin extensión en docs", "docs", "LICENSE"],
    ["un archivo oculto en docs", "docs", ".gitignore"],
    ["un json cualquiera en generado", "generado", "datos.json"],
    ["un documento en generado", "generado", "README.md"],
  ])(
    "%s no es de un tipo permitido: falla con el mismo código y otro motivo",
    (_n, clase, ruta) => {
      const [falla] = fallasDe(clase, [ruta]);
      expect(falla?.[0]).toBe("codigo-en-clase-excluida");
      expect(falla?.[1]).toBe(ruta);
      expect(falla?.[2]).toContain("no es de un tipo permitido");
      expect(falla?.[2]).not.toContain("es código");
    },
  );

  it("el motivo lista lo permitido en esa clase", () => {
    expect(fallasDe("docs", ["a.png"])[0]?.[2]).toContain("solo .md, .txt");
    expect(fallasDe("generado", ["a.png"])[0]?.[2]).toContain(
      "solo package-lock.json, skills-lock.json",
    );
  });

  it("el código en una clase que SÍ se analiza (backend, scripts, config) no falla por esta regla", () => {
    for (const clase of ["backend", "scripts", "config", "pruebas", "frontend"]) {
      expect(fallasDe(clase, ["a/b.ts", "c.sh", "d.yml", "e.mjs"]), clase).toEqual([]);
    }
  });

  it("una clase excluible sin lista (se agregó a CLASES_EXCLUIBLES y nadie dijo qué admite) no admite ninguna ruta", () => {
    const porClase = { docs: ["README.md"], nueva: ["a.md"] };
    const fallas = revisarClasesExcluidas(porClase, {
      excluibles: ["docs", "nueva"],
      permitidoPorClase: PERMITIDO_EN_CLASE_EXCLUIDA,
    });
    expect(fallas.map((f) => f.archivo)).toEqual(["a.md"]);
    expect(fallas[0]?.motivo).toContain("solo nada");
  });

  it("revisarClasesExcluidas mira solo las clases excluibles que se le dan (y tolera una clase sin rutas)", () => {
    expect(revisarClasesExcluidas({ backend: ["a.ts"] }, { excluibles: ["docs"] })).toEqual([]);
    expect(revisarClasesExcluidas({ docs: ["a.ts"] }, { excluibles: [] })).toEqual([]);
    expect(revisarClasesExcluidas({ docs: ["a.ts"] }).map((f) => f.archivo)).toEqual(["a.ts"]);
  });

  it("las rutas se reportan en orden y una por falla, junto con las demás fallas de clasificación", () => {
    const { fallas } = clasificar(["z.ts", "a.sh", "m.md", "sin-clase/x"], {
      niveles: [
        {
          nombre: "docs",
          reglas: [
            { clase: "docs", glob: "*.ts" },
            { clase: "docs", glob: "*.sh" },
            { clase: "docs", glob: "*.md" },
          ],
        },
      ],
    });
    expect(fallas.map((f) => [f.codigo, f.archivo])).toEqual([
      ["ruta-sin-clase", "sin-clase/x"],
      ["codigo-en-clase-excluida", "a.sh"],
      ["codigo-en-clase-excluida", "z.ts"],
    ]);
  });
});

const describeConGit = describe.skipIf(!HAY_GIT);
// Sin `.git` (sandbox de Stryker) `cargarDelRepo` no encuentra rutas: se saltea. La prueba de
// guardian-nucleo.test.ts impide que el salto ocurra fuera de ese sandbox.
describeConGit("clasificación de las rutas reales del repositorio", () => {
  const rutas = HAY_GIT ? cargarDelRepo(RAIZ).rutas : [];
  const resultado = clasificar(rutas);

  it("no deja ninguna ruta sin clase ni ambigua", () => {
    expect(resultado.fallas).toEqual([]);
    expect(rutas.length).toBeGreaterThan(1000);
  });

  it("las clases excluidas del repositorio real solo contienen lo permitido (ningún código escondido)", () => {
    expect(resultado.fallas.filter((f) => f.codigo === "codigo-en-clase-excluida")).toEqual([]);
    expect(resultado.porClase["generado"]).toEqual(["package-lock.json", "skills-lock.json"]);
    expect((resultado.porClase["docs"] ?? []).length).toBeGreaterThan(30);
    expect((resultado.porClase["docs"] ?? []).every((ruta) => /\.(md|txt)$/.test(ruta))).toBe(true);
  });

  it("cada ruta cae en exactamente una clase", () => {
    expect(resultado.porRuta.size).toBe(rutas.length);
    const todas = Object.values(resultado.porClase).flat();
    expect(todas).toHaveLength(rutas.length);
    expect(new Set(todas).size).toBe(rutas.length);
    for (const ruta of rutas) expect(CLASES).toContain(resultado.porRuta.get(ruta));
  });

  it.each(CLASES_ESPERADAS)("la clase esperada «%s» tiene rutas", (clase) => {
    expect(resultado.porClase[clase]?.length).toBeGreaterThan(0);
  });

  it("todo módulo real de src/modulos tiene su regla (un módulo nuevo no se clasifica solo)", () => {
    const modulos = new Set(
      rutas
        .map((ruta) => /^src\/modulos\/([^/]+)\//.exec(ruta)?.[1])
        .filter((m) => m !== undefined),
    );
    expect(modulos.size).toBeGreaterThan(0);
    for (const modulo of modulos) {
      const { fallas, porRuta } = clasificar([`src/modulos/${modulo}/dominio/x.ts`]);
      expect(fallas).toEqual([]);
      expect(porRuta.get(`src/modulos/${modulo}/dominio/x.ts`)).toBe("backend");
    }
  });
});
