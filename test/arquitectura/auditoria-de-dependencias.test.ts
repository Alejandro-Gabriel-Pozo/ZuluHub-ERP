import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * La auditoría de dependencias del job «Seguridad» (`arquitectura/auditoria-de-dependencias.cjs`): falla ante todo aviso alto o crítico sin excepción
 * vigente. Previene dejar rojo a todo PR por un aviso sin corrección en una herramienta de desarrollo (picomatch, 17/11/2026) SIN aflojar el chequeo:
 * cada regla de la excepción tiene acá su violación inyectada.
 */

type Aviso = { source: number; name: string; severity: string; title?: string; url: string };
type Vulnerabilidad = { name: string; severity: string; via: (string | Aviso)[] };
type Excepcion = { id: string; paquete: string; motivo: string; fuente: string; vence: string };
const require = createRequire(import.meta.url);
const { evaluar, problemasDeLasExcepciones, avisosDeRaiz } =
  require("../../arquitectura/auditoria-de-dependencias.cjs") as {
    evaluar: (e: { auditoria: unknown; excepciones: unknown; hoy: string }) => {
      fallas: string[];
      exceptuados: string[];
    };
    problemasDeLasExcepciones: (valor: unknown) => string[];
    avisosDeRaiz: (paquete: string, vulnerabilidades: Record<string, unknown>) => Aviso[];
  };

const RAIZ = join(import.meta.dirname, "../..");
const SCRIPT = join(RAIZ, "arquitectura/auditoria-de-dependencias.cjs");
const ID = "GHSA-fc5q-39xc-vjpf";
const OTRO_ID = "GHSA-6pq8-jhm2-2vcw";
const aviso = (id: string, nombre: string, severidad: string): Aviso => ({
  source: 1,
  name: nombre,
  severity: severidad,
  title: `aviso de ${nombre}`,
  url: `https://github.com/advisories/${id}`,
});
const excepcion = (cambios: Partial<Excepcion> = {}): Excepcion => ({
  id: ID,
  paquete: "picomatch",
  motivo:
    "Solo desarrollo: llega por herramientas de prueba y no llega al bundle de la aplicación (comando de verificación).",
  fuente: "Decisión del dueño, 17/11/2026, opción A",
  vence: "2026-12-17",
  ...cambios,
});
const vulnerabilidad = (
  nombre: string,
  severidad: string,
  via: (string | Aviso)[],
): Vulnerabilidad => ({ name: nombre, severity: severidad, via });
/** La auditoría real de hoy en miniatura: picomatch (raíz) → tinyglobby → vite → vitest, y knip por dos caminos. */
const AUDITORIA = {
  vulnerabilities: {
    picomatch: vulnerabilidad("picomatch", "high", [aviso(ID, "picomatch", "high")]),
    tinyglobby: vulnerabilidad("tinyglobby", "high", ["picomatch"]),
    vite: vulnerabilidad("vite", "high", ["picomatch", "tinyglobby"]),
    vitest: vulnerabilidad("vitest", "high", ["vite", "tinyglobby"]),
    knip: vulnerabilidad("knip", "high", ["picomatch", "tinyglobby"]),
    qs: vulnerabilidad("qs", "moderate", [aviso(OTRO_ID, "qs", "moderate")]),
  },
  metadata: { vulnerabilities: { high: 5, critical: 0 } },
};
const evaluarCon = (auditoria: unknown, excepciones: unknown = [excepcion()], hoy = "2026-11-17") =>
  evaluar({ auditoria, excepciones, hoy });

describe("auditoría de dependencias: avisos altos y críticos", () => {
  it("un aviso alto con excepción vigente pasa, y arrastra a sus dependientes sin pedir una excepción por cada uno", () => {
    const r = evaluarCon(AUDITORIA);
    expect(r.fallas).toEqual([]);
    expect(r.exceptuados).toEqual([`${ID} (picomatch) hasta 2026-12-17`]);
  });

  it("sin la excepción (violación inyectada) falla, nombra el aviso y los paquetes que arrastra", () => {
    const r = evaluarCon(AUDITORIA, []);
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toContain(`${ID} sin excepción`);
    expect(r.fallas[0]).toContain("knip, picomatch, tinyglobby, vite, vitest");
  });

  it("los avisos moderados y bajos no cuentan (igual que `--audit-level=high`)", () => {
    const soloModerado = {
      vulnerabilities: { qs: AUDITORIA.vulnerabilities.qs },
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    };
    expect(evaluarCon(soloModerado, []).fallas).toEqual([]);
  });

  it("un paquete dependiente con DOS avisos de raíz y solo uno exceptuado falla: todos sus avisos de raíz tienen que estarlo", () => {
    const dos = {
      vulnerabilities: {
        ...AUDITORIA.vulnerabilities,
        vitest: vulnerabilidad("vitest", "high", [
          "vite",
          aviso("GHSA-2222-3333-4444", "vitest", "high"),
        ]),
      },
    };
    const r = evaluarCon(dos);
    expect(r.fallas.some((f) => f.startsWith("GHSA-2222-3333-4444 sin excepción"))).toBe(true);
    expect(r.fallas.some((f) => f.includes(ID))).toBe(false);
  });

  it("una excepción por nombre de paquete dependiente (vite) no cubre el aviso de raíz: la excepción es del aviso", () => {
    const r = evaluarCon(AUDITORIA, [excepcion({ paquete: "vite" })]);
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toContain("dice «vite» pero el aviso es de «picomatch»");
  });

  it("un CRÍTICO nunca se exceptúa, ni con una excepción vigente", () => {
    const critico = {
      vulnerabilities: {
        picomatch: vulnerabilidad("picomatch", "critical", [aviso(ID, "picomatch", "critical")]),
      },
    };
    const r = evaluarCon(critico);
    expect(r.fallas.some((f) => f.includes("CRÍTICO y un crítico nunca se exceptúa"))).toBe(true);
  });

  it("un aviso alto que npm sube a crítico después de excepcionarlo falla", () => {
    const sube = {
      vulnerabilities: {
        ...AUDITORIA.vulnerabilities,
        picomatch: vulnerabilidad("picomatch", "critical", [aviso(ID, "picomatch", "critical")]),
      },
    };
    expect(evaluarCon(sube).fallas.length).toBeGreaterThan(0);
  });

  it("un paquete alto sin ningún aviso de raíz que lo explique falla (no se puede decir que sea inocuo)", () => {
    const huerfano = {
      vulnerabilities: { raro: vulnerabilidad("raro", "high", ["no-existe"]) },
      metadata: { vulnerabilities: { high: 1 } },
    };
    const r = evaluarCon(huerfano, []);
    expect(r.fallas).toEqual([
      "raro: severidad high sin un aviso de raíz alto o crítico que la explique.",
    ]);
  });

  it("las cadenas circulares de `via` no cuelgan la resolución", () => {
    const circular = {
      a: vulnerabilidad("a", "high", ["b"]),
      b: vulnerabilidad("b", "high", ["a", aviso(ID, "picomatch", "high")]),
    };
    expect(avisosDeRaiz("a", circular).map((x) => x.url)).toEqual([
      `https://github.com/advisories/${ID}`,
    ]);
  });
});

describe("auditoría de dependencias: vencimiento y excepciones que sobran", () => {
  it("una excepción vencida falla (no se renueva sola) y el último día todavía vale", () => {
    const vencida = evaluarCon(AUDITORIA, [excepcion()], "2026-12-18");
    expect(vencida.fallas).toHaveLength(1);
    expect(vencida.fallas[0]).toContain("VENCIÓ el 2026-12-17");
    expect(evaluarCon(AUDITORIA, [excepcion()], "2026-12-17").fallas).toEqual([]);
  });

  it("una excepción que ya no corresponde a ningún aviso (corregido) falla pidiendo sacarla", () => {
    const corregido = {
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    };
    const r = evaluarCon(corregido);
    expect(r.fallas).toEqual([
      `${ID}: la excepción ya no corresponde a ningún aviso alto: sacala de arquitectura/auditoria-excepciones.json.`,
    ]);
  });

  it("falla cerrado ante una salida que no se entiende", () => {
    for (const rara of [
      null,
      "texto",
      [],
      {},
      { vulnerabilities: null },
      { vulnerabilities: [] },
    ]) {
      const r = evaluarCon(rara, []);
      expect(r.fallas, JSON.stringify(rara)).toHaveLength(1);
      expect(r.fallas[0]).toContain("no se entiende");
    }
  });

  it("falla cerrado si el resumen cuenta avisos altos que el detalle no trae", () => {
    const r = evaluarCon(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 2, critical: 0 } } },
      [],
    );
    expect(r.fallas[0]).toContain("salida inconsistente");
  });

  it("un aviso de raíz sin id GHSA legible falla", () => {
    const sinId = {
      vulnerabilities: {
        x: vulnerabilidad("x", "high", [
          { source: 1, name: "x", severity: "high", url: "https://ejemplo.com/otra-cosa" },
        ]),
      },
    };
    expect(evaluarCon(sinId, []).fallas.some((f) => f.includes("identificador GHSA legible"))).toBe(
      true,
    );
  });
});

describe("auditoría de dependencias: la lista de excepciones declara lo permitido", () => {
  const problemas = (valor: unknown) => problemasDeLasExcepciones(valor);

  it("una excepción completa y bien formada no tiene problemas", () => {
    expect(problemas([excepcion()])).toEqual([]);
    expect(problemas([])).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ["no es un arreglo", { id: ID }, "tiene que ser un arreglo"],
    ["un elemento que no es objeto", ["GHSA"], "tiene que ser un objeto"],
    ["un campo de más", [{ ...excepcion(), nota: "x" }], "«nota» no es un campo permitido"],
    ["falta el motivo", [{ ...excepcion(), motivo: undefined }], "falta «motivo»"],
    ["falta el vencimiento", [{ ...excepcion(), vence: undefined }], "falta «vence»"],
    ["un id que no es GHSA", [excepcion({ id: "CVE-2026-0001" })], "no es un identificador GHSA"],
    [
      "un id con letras fuera del conjunto",
      [excepcion({ id: "GHSA-aaaa-bbbb-cccc" })],
      "no es un identificador GHSA",
    ],
    ["un motivo de una palabra", [excepcion({ motivo: "dev" })], "tiene que explicar por qué"],
    ["una fuente vacía", [excepcion({ fuente: "" })], "tiene que decir quién lo decidió"],
    ["una fecha con otro formato", [excepcion({ vence: "17/12/2026" })], "fecha AAAA-MM-DD real"],
    ["una fecha que no existe", [excepcion({ vence: "2026-02-31" })], "fecha AAAA-MM-DD real"],
    [
      "un paquete con caracteres raros",
      [excepcion({ paquete: "pico match; rm -rf" })],
      "no es un nombre de paquete",
    ],
    ["un id repetido", [excepcion(), excepcion()], "está repetido"],
  ])("falla si %s", (_nombre, valor, mensaje) => {
    expect(problemas(valor).join("\n")).toContain(mensaje);
  });

  it("evaluar no mira los avisos si la lista está mal formada (falla antes)", () => {
    const r = evaluarCon(AUDITORIA, [{ ...excepcion(), nota: "x" }]);
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toContain("no es un campo permitido");
  });

  it("la lista real del repositorio está bien formada y ya no trae la excepción de picomatch (el aviso dejó de ser alto el 18/11/2026)", () => {
    const real = JSON.parse(
      readFileSync(join(RAIZ, "arquitectura/auditoria-excepciones.json"), "utf8"),
    ) as Excepcion[];
    expect(problemas(real)).toEqual([]);
    expect(real.map((e) => e.id)).not.toContain(ID);
  });
});

describe("auditoría de dependencias: el programa de punta a punta", () => {
  let carpeta = "";
  afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

  /** Corre el script con un `npm` falso que imprime `salida` y sale con `codigo` (npm audit sale con 1 si hay avisos). */
  const correr = (salida: string, codigo: number, excepciones: unknown = [excepcion()]) => {
    carpeta = mkdtempSync(join(tmpdir(), "auditoria-"));
    mkdirSync(join(carpeta, "bin"));
    mkdirSync(join(carpeta, "arquitectura"));
    writeFileSync(join(carpeta, "salida.json"), salida);
    writeFileSync(
      join(carpeta, "bin/npm"),
      `#!/bin/sh\ncat "${join(carpeta, "salida.json")}"\nexit ${codigo}\n`,
    );
    chmodSync(join(carpeta, "bin/npm"), 0o755);
    writeFileSync(
      join(carpeta, "arquitectura/auditoria-excepciones.json"),
      JSON.stringify(excepciones),
    );
    // El mutante activo pasa al hijo con el resto del entorno: sin esto la mutación nunca vería este código.
    return spawnSync(process.execPath, [SCRIPT], {
      cwd: carpeta,
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(carpeta, "bin")}:${process.env["PATH"] ?? ""}` },
    });
  };

  it("avisos con excepción vigente: sale con 0 aunque `npm audit` salga con 1", () => {
    // La excepción real vence el 2026-12-17: se usa una que vence lejos para que la prueba no dependa del día en que corra.
    const r = correr(JSON.stringify(AUDITORIA), 1, [excepcion({ vence: "2999-01-01" })]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Exceptuado: " + ID);
  });

  it("avisos sin excepción: sale con 1 y dice cuál", () => {
    const r = correr(JSON.stringify(AUDITORIA), 1, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`FALLA ${ID} sin excepción`);
  });

  it("excepción vencida: sale con 1", () => {
    const r = correr(JSON.stringify(AUDITORIA), 1, [excepcion({ vence: "2020-01-01" })]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("VENCIÓ");
  });

  it.each([
    ["una salida que no es JSON", "<html>502</html>", 1],
    [
      "un JSON con un error de npm",
      JSON.stringify({ error: { code: "ENOTFOUND", summary: "sin red" } }),
      1,
    ],
    ["una salida vacía", "", 1],
  ])("falla cerrado ante %s", (_nombre, salida, codigo) => {
    const r = correr(salida, codigo, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FALLA");
  });

  it("sin avisos y sin excepciones: sale con 0", () => {
    const r = correr(
      JSON.stringify({
        vulnerabilities: {},
        metadata: { vulnerabilities: { high: 0, critical: 0 } },
      }),
      0,
      [],
    );
    expect(r.status).toBe(0);
  });
});

describe("auditoría de dependencias: el job del CI la corre", () => {
  const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");

  it("el paso usa el script, ya no `npm audit --audit-level=high` a secas, y conserva las firmas y gitleaks", () => {
    expect(ci).toContain("run: node arquitectura/auditoria-de-dependencias.cjs");
    expect(ci).not.toMatch(/run:\s*npm audit --audit-level/);
    expect(ci).toContain("npm audit signatures");
    expect(ci).toContain("gitleaks");
  });
});
