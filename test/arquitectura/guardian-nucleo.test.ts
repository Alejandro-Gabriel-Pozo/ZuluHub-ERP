import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AHORA,
  BASE,
  EXCLUSIONES_BASE,
  HAY_GIT,
  RAIZ,
  cargarDelRepo,
  codigos,
  contrato,
  correr,
  ejecutar,
  formatearFalla,
  huellaDelArchivo,
  type Entradas,
  type Informe,
} from "./guardian-apoyo";

/**
 * El guardián sobre el repositorio REAL y sobre copias alteradas en memoria. El repo actual pasa con
 * el registro vacío; cada alteración (ruta sin clase, módulo sin declaración, excepción vencida,
 * huella cambiada, comodín) lo hace fallar; y un «pasó» siempre viene con evidencia de qué se miró.
 */

// Sin `.git` (sandbox de Stryker) `cargarDelRepo` lanza o no encuentra rutas: se usa un repo vacío y los
// bloques que lo miran se saltean (ver más abajo). Una corrida con `.git` lee el repo real, como siempre.
const real: ReturnType<typeof cargarDelRepo> = HAY_GIT
  ? cargarDelRepo(RAIZ)
  : {
      rutas: [],
      leer: () => null,
      contratos: [],
      excepciones: [],
      exclusiones: [],
      previas: { fallas: [], avisos: [] },
    };
const CLASES_DEL_INFORME = [
  "frontend",
  "backend",
  "migraciones",
  "scripts",
  "workers",
  "generado",
  "docs",
  "config",
  "pruebas",
];

/** Corre el guardián sobre el repo real con rutas y archivos de más (en memoria). */
function sobreElRepo(
  extra: Record<string, string> = {},
  sacar: string[] = [],
  cambios: Partial<Entradas> = {},
) {
  return ejecutar({
    ...real,
    rutas: [...real.rutas.filter((r) => !sacar.includes(r)), ...Object.keys(extra)],
    leer: (ruta) => extra[ruta] ?? (sacar.includes(ruta) ? null : real.leer(ruta)),
    ahora: AHORA,
    ...cambios,
  });
}

// Sin `.git` (sandbox de Stryker) no hay rutas versionadas y estos bloques se saltean: ver la prueba
// «el salto por falta de .git…», que falla si el `.git` falta fuera de ese sandbox.
const SIN_GIT = !HAY_GIT;
const describeConGit = describe.skipIf(SIN_GIT);
const itConGit = it.skipIf(SIN_GIT);

describeConGit("el repositorio actual pasa", () => {
  const resultado = sobreElRepo();

  it("sin fallas ni avisos, con el registro real vacío", () => {
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.informe.resultado).toBe("pasa");
    expect(real.contratos).toEqual([]);
    expect(real.excepciones).toEqual([]);
  });

  it("toda ruta versionada quedó clasificada", () => {
    const { informe } = resultado;
    expect(informe.totales["rutas"]).toBe(real.rutas.length);
    expect(informe.totales["rutasClasificadas"]).toBe(real.rutas.length);
    const listadas = CLASES_DEL_INFORME.flatMap(
      (clase) => informe.clases[clase]?.listaDeRutas ?? [],
    );
    expect(listadas.sort()).toEqual([...real.rutas].sort());
  });

  it("toda unidad existente tiene su declaración, con `noUsa` y sin contratos", () => {
    const { unidades } = resultado.informe;
    expect(unidades.length).toBeGreaterThanOrEqual(18);
    for (const { unidad, declaracion } of unidades) {
      expect(declaracion, unidad).toMatchObject({ usa: [] });
    }
    expect(unidades.map((u) => u.unidad)).toEqual(
      expect.arrayContaining([
        "apps/web",
        "apps/plataforma",
        "scripts",
        "migraciones",
        "src/modulos/fiscal",
        "src/capacidades",
        "src/primitivas",
        "src/puertos",
        "src/adaptadores",
        "src/composicion",
        "src/plataforma",
        "src/contexto",
        "src/consultas-de-grupo",
      ]),
    );
  });

  it("el informe separa lo analizado de lo excluido y lo deja explícito", () => {
    const { clases, exclusiones } = resultado.informe;
    expect(exclusiones.porClase.map((e) => e.clase).sort()).toEqual(["docs", "generado"]);
    expect(clases["generado"]?.excluidas).toBe(clases["generado"]?.rutas);
    expect(clases["docs"]?.excluidas).toBe(clases["docs"]?.rutas);
    for (const clase of ["frontend", "backend", "migraciones", "scripts", "config", "pruebas"]) {
      expect(clases[clase]?.excluidas, clase).toBe(0);
      expect(clases[clase]?.rutas, clase).toBeGreaterThan(0);
    }
  });

  it("es determinista: dos corridas dan exactamente el mismo informe", () => {
    expect(sobreElRepo()).toEqual(resultado);
  });
});

describeConGit("el repositorio real alterado en memoria falla", () => {
  it("una ruta nueva sin clase", () => {
    const r = sobreElRepo({ "herramienta-nueva/x.ts": "export {};" });
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toMatchObject({
      codigo: "ruta-sin-clase",
      archivo: "herramienta-nueva/x.ts",
    });
  });

  it("un módulo nuevo en src/modulos: falla por no tener clase ni contratos.json", () => {
    const r = sobreElRepo({ "src/modulos/nuevo/dominio/x.ts": "export {};" });
    expect(codigos(r).sort()).toEqual(["ruta-sin-clase", "unidad-sin-declaracion"]);
  });

  it("una app nueva en apps: falla por no tener clase ni contratos.json", () => {
    const r = sobreElRepo({ "apps/otra/app/page.tsx": "export {};" });
    expect(codigos(r).sort()).toEqual(["ruta-sin-clase", "unidad-sin-declaracion"]);
  });

  it("se borra el contratos.json de un módulo", () => {
    const r = sobreElRepo({}, ["src/modulos/fiscal/contratos.json"]);
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toMatchObject({
      codigo: "unidad-sin-declaracion",
      archivo: "src/modulos/fiscal/contratos.json",
    });
  });

  it("se renombra una carpeta fuera de la clasificación (arquitectura → arq)", () => {
    const rutas = real.rutas.map((r) => (r.startsWith("arquitectura/") ? `arq/${r.slice(13)}` : r));
    const r = ejecutar({ ...real, rutas, ahora: AHORA });
    expect(r.fallas.length).toBeGreaterThan(0);
    expect(new Set(codigos(r))).toEqual(new Set(["ruta-sin-clase"]));
  });

  it("una excepción vencida (con un contrato registrado) falla", () => {
    const r = sobreElRepo({}, [], {
      contratos: [contrato()],
      excepciones: [
        {
          id: "exc-vieja",
          contrato: "color-separador",
          ruta: "package.json",
          huella: "a".repeat(64),
          motivo: "x",
          responsable: "x",
          aprobadoPor: "x",
          creada: "2025-11-01",
          vence: "2026-01-01",
        },
      ],
    });
    expect(codigos(r)).toContain("excepcion-vencida");
  });

  it("una excepción ampliada con comodín falla", () => {
    const r = sobreElRepo({}, [], {
      contratos: [contrato()],
      excepciones: [
        {
          id: "exc-ancha",
          contrato: "color-separador",
          ruta: "apps/web/**",
          huella: "a".repeat(64),
          motivo: "x",
          responsable: "x",
          aprobadoPor: "x",
          creada: "2026-10-21",
          vence: "2026-12-20",
        },
      ],
    });
    expect(codigos(r)).toContain("excepcion-ruta-no-exacta");
  });

  it("vaciar el archivo de exclusiones deja de excluir, pero no es una falla: se analiza más", () => {
    const r = sobreElRepo({}, [], { exclusiones: [] });
    expect(r.fallas).toEqual([]);
    expect(r.informe.clases["docs"]?.excluidas).toBe(0);
  });

  it("el reloj vence las exclusiones de clase del repositorio", () => {
    const r = sobreElRepo({}, [], { ahora: new Date("2027-01-01T00:00:00Z") });
    expect(codigos(r)).toEqual(["excepcion-vencida", "excepcion-vencida"]);
  });
});

describe("distinguir «pasó» de «no encontró nada»", () => {
  it("una lista de rutas vacía falla en vez de pasar", () => {
    const r = ejecutar({
      rutas: [],
      leer: () => null,
      contratos: [],
      excepciones: [],
      exclusiones: [],
      ahora: AHORA,
    });
    expect(codigos(r)).toEqual(["sin-rutas"]);
    expect(r.informe.resultado).toBe("falla");
  });

  it.each([
    "frontend",
    "backend",
    "migraciones",
    "scripts",
    "config",
    "pruebas",
    "docs",
    "generado",
  ])("si la clase esperada «%s» queda con cero rutas, falla", (clase) => {
    const sacar = correr().informe.clases[clase]?.listaDeRutas ?? [];
    expect(sacar.length).toBeGreaterThan(0);
    const archivos = Object.fromEntries(sacar.map((ruta) => [ruta, null]));
    const r = correr({ archivos });
    expect(
      r.fallas.some((f) => f.codigo === "clase-sin-rutas" && f.motivo.includes(`«${clase}»`)),
    ).toBe(true);
  });

  it("una clase que no se espera (workers) sin rutas no es una falla", () => {
    expect(correr().informe.clases["workers"]?.rutas).toBe(0);
    expect(correr().fallas).toEqual([]);
  });

  it("un detector que declara una clase con archivos de la que no analizó ni uno falla", () => {
    const registro = contrato({
      deteccion: [
        { tipo: "uso", clases: ["frontend"], nombre: "mira el frontend", reconoce: () => [] },
      ],
    });
    expect(correr({ contratos: [registro] }).fallas).toEqual([]);
    const excluirAMano = ["apps/web/ui/tokens.css", "apps/web/ui/Caja.module.css"].map(
      (ruta, i) => ({
        id: `excl-${i}`,
        alcance: "ruta",
        ruta,
        huella: huellaDelArchivo(BASE[ruta] ?? ""),
        motivo: "Prueba",
        responsable: "Ingeniería",
        aprobadoPor: "Dueño",
        creada: "2026-10-21",
        vence: "2026-12-20",
      }),
    );
    const sinAnalizar = correr({
      contratos: [registro],
      exclusiones: [...EXCLUSIONES_BASE, ...excluirAMano],
    });
    expect(codigos(sinAnalizar)).toEqual(["detector-sin-rutas"]);
  });

  it("un detector que solo alcanza archivos binarios no cuenta como análisis", () => {
    const registro = contrato({
      deteccion: [
        { tipo: "uso", clases: ["pruebas"], nombre: "mira las pruebas", reconoce: () => [] },
      ],
    });
    const sinPruebasDeTexto = correr({
      contratos: [registro],
      archivos: { "test/una.test.ts": null, "test/foto.png": "binario" },
    });
    expect(codigos(sinPruebasDeTexto)).toContain("detector-sin-rutas");
    expect(sinPruebasDeTexto.informe.clases["pruebas"]).toMatchObject({
      binariasOmitidas: 1,
      analizadasPorDetectores: 0,
    });
  });

  it("el informe cuenta cuántos archivos leyeron los detectores por clase", () => {
    const { informe } = correr({ contratos: [contrato()] });
    expect(informe.clases["frontend"]?.analizadasPorDetectores).toBe(2);
    expect(informe.clases["backend"]?.analizadasPorDetectores).toBe(2);
    expect(informe.clases["pruebas"]?.analizadasPorDetectores).toBe(0);
    expect(informe.reglasEjecutadas.chequeos.map((c) => c.codigo)).toEqual(
      expect.arrayContaining(["ruta-sin-clase", "uso-sin-declarar", "excepcion-huella-cambiada"]),
    );
    expect(informe.reglasEjecutadas.clasificacion.length).toBeGreaterThan(10);
  });
});

describe("salida del guardián", () => {
  it("cada falla se imprime como archivo:línea · contrato · motivo · corrección", () => {
    const r = correr({
      contratos: [contrato()],
      archivos: {
        "apps/web/ui/Linea.module.css": ".l { border-color: var(--color-separador); }\n",
      },
    });
    expect(r.fallas).toHaveLength(1);
    const [archivoYLinea, nombre, motivo, correccion] = formatearFalla(r.fallas[0]!).split(" · ");
    expect(archivoYLinea).toBe("apps/web/ui/Linea.module.css:1");
    expect(nombre).toBe("color-separador");
    expect(motivo).toContain("no depender de ningún contrato");
    expect(correccion).toContain("apps/web/contratos.json");
  });

  it("una falla sin contrato se imprime con guion, y siempre con archivo:línea", () => {
    const r = correr({ archivos: { "herramienta/x.ts": "" } });
    expect(formatearFalla(r.fallas[0]!).startsWith("herramienta/x.ts:1 · - · ")).toBe(true);
  });
});

describe("CLI: node arquitectura/contratos/guardian.cjs", () => {
  itConGit("sobre este repositorio sale 0, escribe el informe y lista las rutas por clase", () => {
    const carpeta = mkdtempSync(join(tmpdir(), "guardian-"));
    try {
      const destino = join(carpeta, "informe.json");
      const corrida = spawnSync(
        process.execPath,
        ["arquitectura/contratos/guardian.cjs", `--informe=${destino}`],
        { cwd: RAIZ, encoding: "utf8" },
      );
      expect(corrida.status, corrida.stderr).toBe(0);
      expect(corrida.stdout).toContain("Guardián de contratos: OK");
      const informe = JSON.parse(readFileSync(destino, "utf8")) as Informe;
      expect(informe.resultado).toBe("pasa");
      expect(informe.totales["rutas"]).toBeGreaterThan(1000);
      expect(Object.keys(informe.clases).sort()).toEqual([...CLASES_DEL_INFORME].sort());
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  itConGit("el informe por defecto no se commitea (está en .gitignore)", () => {
    const salida = execFileSync("git", ["check-ignore", "arquitectura/contratos/informe.json"], {
      cwd: RAIZ,
      encoding: "utf8",
    });
    expect(salida.trim()).toBe("arquitectura/contratos/informe.json");
  });

  it("package.json encadena el guardián en `arquitectura` y lo expone como script", () => {
    const { scripts } = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(scripts["guardian"]).toBe("node arquitectura/contratos/guardian.cjs");
    expect(scripts["arquitectura"]).toContain("npm run guardian");
    expect(scripts["gate"]).toContain("npm run arquitectura");
  });
});

describe("el salto por falta de .git no esconde un guardián que dejó de analizar", () => {
  it("sin .git solo se admite dentro del sandbox de Stryker (.stryker-tmp)", () => {
    const enSandboxDeStryker = RAIZ.split(sep).includes(".stryker-tmp");
    if (!HAY_GIT && !enSandboxDeStryker) {
      expect.fail(
        "falta .git fuera del sandbox de Stryker: las pruebas del repositorio real se estarían salteando",
      );
    }
    expect(HAY_GIT || enSandboxDeStryker).toBe(true);
  });
});
