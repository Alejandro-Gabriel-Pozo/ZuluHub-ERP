import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carpetaTemporal, cargarDelRepo, escribirEn, limpiarTemporales } from "./guardian-apoyo";
import {
  correrCli,
  correrNodeEn,
  git,
  repoConArchivos,
  repoSano,
} from "./guardian-mutantes-b-apoyo";

/**
 * Lo que el guardián hace con git y con el disco, sobre repositorios git SINTÉTICOS en carpetas temporales
 * (nunca el repositorio real ni su `.git`, que el sandbox de la mutación no tiene): `cargarDelRepo`, el
 * CLI (`node arquitectura/contratos/guardian.cjs`), su informe, sus opciones y la vigilancia de la base.
 */

const require = createRequire(import.meta.url);
const { valorDeOpcion } = require("../../arquitectura/contratos/guardian.cjs") as {
  valorDeOpcion: (argumentos: string[], nombre: string) => string | undefined;
};

afterEach(limpiarTemporales);

const EXCEPCIONES = "arquitectura/contratos/excepciones.json";
const EXCLUSIONES = "arquitectura/contratos/exclusiones.json";
const EVASIONES = "arquitectura/contratos/evasiones.json";
const INFORME = "arquitectura/contratos/informe.json";
const VERIFICADOR = "arquitectura/contratos/no-debilitar.cjs";

describe("cargarDelRepo sobre un repositorio git sintético", () => {
  const DATOS = { [EXCEPCIONES]: "[]\n", [EXCLUSIONES]: "[]\n", [EVASIONES]: "[]\n" };

  it("lista las rutas versionadas y las nuevas que git no ignora, ordenadas, sin las ignoradas", () => {
    const repo = repoConArchivos({
      ...DATOS,
      "b.txt": "b",
      "z/c.txt": "c",
      "a.txt": "a",
      "ignorado.txt": "i",
      ".gitignore": "ignorado.txt\n",
    });
    // Lo versionado va ANTES y DESPUÉS de lo nuevo en el orden de git: la lista tiene que salir ordenada igual.
    git(repo, "add", "a.txt", "z/c.txt");
    const cargado = cargarDelRepo(repo);
    expect(cargado.rutas).toEqual([
      ".gitignore",
      "a.txt",
      EVASIONES,
      EXCEPCIONES,
      EXCLUSIONES,
      "b.txt",
      "z/c.txt",
    ]);
    expect(cargado.previas).toEqual({ fallas: [], avisos: [] });
    expect(cargado.excepciones).toEqual([]);
    expect(cargado.exclusiones).toEqual([]);
    expect(cargado.contratos).toEqual([]);
  });

  it("lee los archivos del disco tal cual, y devuelve null con los que no existen", () => {
    const repo = repoConArchivos({ ...DATOS, "a.txt": "uno\ndos\n" });
    const { leer } = cargarDelRepo(repo);
    const leido = leer("a.txt");
    expect(Buffer.isBuffer(leido)).toBe(true);
    expect(String(leido)).toBe("uno\ndos\n");
    expect(leer("no-existe.txt")).toBeNull();
  });

  it("lee las excepciones y las exclusiones como JSON", () => {
    const repo = repoConArchivos({
      [EXCEPCIONES]: '[{ "id": "exc-1" }]\n',
      [EXCLUSIONES]: '[{ "id": "excl-1" }, { "id": "excl-2" }]\n',
      [EVASIONES]: '[{ "id": "EV-001" }]\n',
    });
    const cargado = cargarDelRepo(repo);
    expect(cargado.excepciones).toEqual([{ id: "exc-1" }]);
    expect(cargado.exclusiones).toEqual([{ id: "excl-1" }, { id: "excl-2" }]);
    expect(cargado.evasiones).toEqual([{ id: "EV-001" }]);
    expect(cargado.previas.fallas).toEqual([]);
  });

  it("un archivo de datos que falta es una falla previa con el motivo del sistema, y se lee como lista vacía", () => {
    const repo = repoConArchivos({ "a.txt": "a" });
    const cargado = cargarDelRepo(repo);
    expect(cargado.excepciones).toEqual([]);
    expect(cargado.exclusiones).toEqual([]);
    expect(cargado.evasiones).toEqual([]);
    expect(cargado.previas.avisos).toEqual([]);
    expect(cargado.previas.fallas).toEqual(
      [EXCEPCIONES, EXCLUSIONES, EVASIONES].map((archivo) => ({
        codigo: archivo === EVASIONES ? "evasion-invalida" : "excepcion-invalida",
        archivo,
        contrato: null,
        motivo: `No se pudo leer el archivo como JSON: ENOENT: no such file or directory, open '${join(repo, archivo)}'.`,
        correccion: "Dejalo como una lista JSON válida.",
        donde: { tipo: "json", camino: [] },
      })),
    );
  });

  it("un archivo de datos que no es JSON es una falla previa con el motivo del analizador", () => {
    const roto = '[\n  { "id": "x",\n';
    let motivoDelAnalizador = "";
    try {
      JSON.parse(roto);
    } catch (error) {
      motivoDelAnalizador = (error as Error).message;
    }
    expect(motivoDelAnalizador).not.toBe("");
    const repo = repoConArchivos({
      [EXCEPCIONES]: roto,
      [EXCLUSIONES]: "[]\n",
      [EVASIONES]: "[]\n",
    });
    const cargado = cargarDelRepo(repo);
    expect(cargado.excepciones).toEqual([]);
    expect(cargado.previas.fallas).toEqual([
      {
        codigo: "excepcion-invalida",
        archivo: EXCEPCIONES,
        contrato: null,
        motivo: `No se pudo leer el archivo como JSON: ${motivoDelAnalizador}.`,
        correccion: "Dejalo como una lista JSON válida.",
        donde: { tipo: "json", camino: [] },
      },
    ]);
  });

  it("una ruta que git lista y ya no está en el disco se avisa y no se analiza", () => {
    const repo = repoConArchivos({ ...DATOS, "queda.txt": "q", "se-borra.txt": "b" });
    git(repo, "add", ".");
    rmSync(join(repo, "se-borra.txt"));
    const cargado = cargarDelRepo(repo);
    expect(cargado.rutas).toEqual([EVASIONES, EXCEPCIONES, EXCLUSIONES, "queda.txt"]);
    expect(cargado.previas.fallas).toEqual([]);
    expect(cargado.previas.avisos).toEqual([
      {
        codigo: "ruta-ausente-en-disco",
        archivo: "se-borra.txt",
        contrato: null,
        motivo: "Git la lista pero ya no está en el disco; no se analiza.",
        correccion: "Registrá el borrado (git rm) para que deje de listarse.",
        donde: { tipo: "archivo" },
      },
    ]);
  });
});

describe("valorDeOpcion", () => {
  it.each([
    [["--base", "x"], "x"],
    [["--base=x"], "x"],
    [["--base="], ""],
    [["--base"], ""],
    [["otra", "--base", "a/b", "--c"], "a/b"],
    [["--base=a=b"], "a=b"],
    [[], undefined],
    [["--basex=1"], undefined],
    [["--informe=1"], undefined],
  ])("en %j la opción --base vale %j", (argumentos, esperado) => {
    expect(valorDeOpcion(argumentos, "--base")).toBe(esperado);
  });
});

describe("CLI: el informe y la salida", () => {
  const CLASES = (config: number): string =>
    `frontend 2, backend 2, migraciones 1, scripts 1, workers 0, generado 1, docs 1, config ${config}, pruebas 1`;

  it("sin opciones escribe el informe en su lugar de siempre y resume lo analizado", () => {
    const repo = repoSano();
    const corrida = correrCli(repo);
    expect(corrida.stderr).toBe("");
    expect(corrida.status).toBe(0);
    const texto = readFileSync(join(repo, INFORME), "utf8");
    const informe = JSON.parse(texto) as {
      resultado: string;
      analisisCompleto: boolean;
      totales: { rutasClasificadas: number };
      clases: { config: { rutas: number } };
    };
    expect(informe).toMatchObject({ resultado: "pasa", analisisCompleto: true });
    expect(informe.clases.config.rutas).toBeGreaterThanOrEqual(7);
    expect(corrida.stdout).toBe(
      `Guardián de contratos: OK · ${informe.totales.rutasClasificadas} rutas clasificadas (${CLASES(informe.clases.config.rutas)}) · ` +
        `5 unidades declaradas · 0 contratos · 0 avisos (informe: ${INFORME}).\n`,
    );
    // El informe es JSON con sangría de 2 espacios y termina en un salto de línea.
    expect(texto).toBe(`${JSON.stringify(informe, null, 2)}\n`);
    expect(texto.startsWith('{\n  "version": 1,\n  "generadoEn": "')).toBe(true);
  });

  it("--sin-informe no escribe nada y lo dice", () => {
    const repo = repoSano();
    const corrida = correrCli(repo, ["--sin-informe"]);
    expect(corrida.status).toBe(0);
    expect(existsSync(join(repo, INFORME))).toBe(false);
    expect(corrida.stdout).toMatch(/ 0 avisos \(sin informe\)\.\n$/);
  });

  it("--informe=<ruta> lo escribe donde se pide, creando las carpetas, y no en el lugar de siempre", () => {
    const repo = repoSano();
    const corrida = correrCli(repo, ["--informe=salida/profunda/otro.json"]);
    expect(corrida.stderr).toBe("");
    expect(corrida.status).toBe(0);
    expect(
      (
        JSON.parse(readFileSync(join(repo, "salida/profunda/otro.json"), "utf8")) as {
          version: number;
        }
      ).version,
    ).toBe(1);
    expect(existsSync(join(repo, INFORME))).toBe(false);
    expect(corrida.stdout).toMatch(/ 0 avisos \(informe: salida\/profunda\/otro\.json\)\.\n$/);
  });

  it("--informe=<ruta absoluta> lo escribe afuera del repositorio y muestra la ruta relativa", () => {
    const repo = repoSano();
    const afuera = repoSano();
    const destino = join(afuera, "informes/uno.json");
    const corrida = correrCli(repo, [`--informe=${destino}`]);
    expect(corrida.status).toBe(0);
    expect(existsSync(destino)).toBe(true);
    expect(existsSync(join(repo, INFORME))).toBe(false);
    expect(corrida.stdout).toContain(`(informe: ${relative(repo, destino)}).\n`);
    expect(relative(repo, destino).startsWith("..")).toBe(true);
  });

  it("--sin-informe manda sobre --informe=", () => {
    const repo = repoSano();
    const corrida = correrCli(repo, ["--informe=salida/x.json", "--sin-informe"]);
    expect(corrida.status).toBe(0);
    expect(existsSync(join(repo, "salida/x.json"))).toBe(false);
    expect(existsSync(join(repo, INFORME))).toBe(false);
  });

  it("una ruta sin clase sale por stderr como FALLA, termina en 1 y cuenta fallas y avisos", () => {
    const repo = repoSano();
    escribirEn(repo, "herramienta/x.ts", "export {};\n");
    const corrida = correrCli(repo, ["--sin-informe"]);
    expect(corrida.status).toBe(1);
    expect(corrida.stdout).toBe("");
    const lineas = corrida.stderr.split("\n");
    expect(lineas).toHaveLength(3);
    expect(lineas[0]).toMatch(
      /^FALLA herramienta\/x\.ts:1 · - · La ruta versionada no calza con ninguna clase .+ · .+$/,
    );
    expect(lineas[1]).toBe("Guardián de contratos: 1 fallas, 0 avisos (sin informe).");
    expect(lineas[2]).toBe("");
  });

  it("una falla igual deja el informe escrito y lo dice en el resumen", () => {
    const repo = repoSano();
    escribirEn(repo, "herramienta/x.ts", "export {};\n");
    const corrida = correrCli(repo);
    expect(corrida.status).toBe(1);
    expect(
      corrida.stderr.endsWith(
        `\nGuardián de contratos: 1 fallas, 0 avisos (informe: ${INFORME}).\n`,
      ),
    ).toBe(true);
    expect(
      (JSON.parse(readFileSync(join(repo, INFORME), "utf8")) as { resultado: string }).resultado,
    ).toBe("falla");
  });

  it("un aviso sale por stdout como AVISO y no cambia el 0 de salida", () => {
    const repo = repoSano();
    escribirEn(repo, "src/modulos/empresas/dominio/otra.ts", "export const otra = 1;\n");
    git(repo, "add", "src/modulos/empresas/dominio/otra.ts");
    rmSync(join(repo, "src/modulos/empresas/dominio/otra.ts"));
    const corrida = correrCli(repo, ["--sin-informe"]);
    expect(corrida.stderr).toBe("");
    expect(corrida.status).toBe(0);
    const lineas = corrida.stdout.split("\n");
    expect(lineas[0]).toBe(
      "AVISO src/modulos/empresas/dominio/otra.ts:1 · - · Git la lista pero ya no está en el disco; no se analiza. · Registrá el borrado (git rm) para que deje de listarse.",
    );
    expect(lineas[1]).toMatch(/^Guardián de contratos: OK · .* · 1 avisos \(sin informe\)\.$/);
    expect(lineas).toHaveLength(3);
  });

  it("un repositorio sin ninguna ruta falla sin romperse al armar el resumen", () => {
    const repo = repoSano();
    writeFileSync(join(repo, ".gitignore"), "*\n");
    const corrida = correrCli(repo);
    const linea =
      readFileSync(join(repo, "arquitectura/contratos/clasificacion.cjs"), "utf8")
        .split("\n")
        .findIndex((renglon) => renglon.includes("const NIVELES")) + 1;
    expect(linea).toBeGreaterThan(1);
    expect(corrida.status).toBe(1);
    expect(corrida.stdout).toBe("");
    expect(corrida.stderr).toBe(
      `FALLA arquitectura/contratos/clasificacion.cjs:${linea} · - · No hay ninguna ruta versionada para analizar: «pasó» no significa nada si no se miró nada. · Corré el guardián dentro de un repositorio git con archivos versionados.\n` +
        `Guardián de contratos: 1 fallas, 0 avisos (informe: ${INFORME}).\n`,
    );
    const informe = JSON.parse(readFileSync(join(repo, INFORME), "utf8")) as {
      analisisCompleto: boolean;
      clases: unknown;
    };
    expect(informe.analisisCompleto).toBe(false);
    expect(informe.clases).toEqual({});
  });

  it("al importarlo como módulo no se ejecuta como CLI: no imprime ni escribe el informe", () => {
    const repo = repoSano();
    const corrida = correrNodeEn(repo, 'require("./arquitectura/contratos/guardian.cjs")');
    expect(corrida.stderr).toBe("");
    expect(corrida.stdout).toBe("");
    expect(corrida.status).toBe(0);
    expect(existsSync(join(repo, INFORME))).toBe(false);
  });
});

describe("CLI: --base, la vigilancia de la versión anterior", () => {
  /** Una carpeta de base; con `verificador` trae su `no-debilitar.cjs` con ese programa. */
  function base(verificador: string | null): string {
    const carpeta = carpetaTemporal("guardian-b-base-");
    escribirEn(carpeta, "dato.txt", "base");
    if (verificador !== null) escribirEn(carpeta, VERIFICADOR, verificador);
    return carpeta;
  }

  it("una base sin verificador avisa por stdout y no cambia el resultado", () => {
    const repo = repoSano();
    const carpeta = base(null);
    const corrida = correrCli(repo, ["--sin-informe", "--base", carpeta]);
    expect(corrida.stderr).toBe("");
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toMatch(
      new RegExp(
        `\\(sin informe\\)\\.\\nAVISO ${carpeta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} no trae arquitectura/contratos/no-debilitar\\.cjs: no hay versión anterior que vigile\\.\\n$`,
      ),
    );
  });

  it("la ruta de la base se resuelve desde la carpeta donde se corre", () => {
    const repo = repoSano();
    const carpeta = base(null);
    const corrida = correrCli(repo, ["--sin-informe", `--base=${relative(repo, carpeta)}`]);
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toContain(`AVISO ${carpeta} no trae `);
  });

  it.each([
    [
      "una carpeta que no existe",
      (): string => join(carpetaTemporal("guardian-b-nada-"), "no-existe"),
    ],
    ["un archivo que no es una carpeta", (): string => join(base(null), "dato.txt")],
  ])("%s: error en stderr y salida 2, después de correr el guardián", (_nombre, ruta) => {
    const repo = repoSano();
    const destino = ruta();
    const corrida = correrCli(repo, ["--sin-informe", "--base", destino]);
    expect(corrida.status).toBe(2);
    expect(corrida.stderr).toBe(`--base: «${destino}» no es una carpeta.\n`);
    expect(corrida.stdout).toMatch(/^Guardián de contratos: OK · /);
  });

  it.each([[["--base="]], [["--base"]], [["--base", ""]]])(
    "una base vacía o sin valor (%j) es un error",
    (opcion) => {
      const corrida = correrCli(repoSano(), ["--sin-informe", ...opcion]);
      expect(corrida.status).toBe(2);
      expect(corrida.stderr).toBe("--base: «» no es una carpeta.\n");
    },
  );

  it("el verificador de la base corre sobre este repositorio y su salida llega al terminal", () => {
    const repo = repoSano();
    const carpeta = base(
      'process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stderr.write("mensaje de la base\\n");\n',
    );
    const corrida = correrCli(repo, ["--sin-informe", "--base", carpeta]);
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toContain(`\n${JSON.stringify(["--arbol", repo])}\n`);
    expect(corrida.stderr).toBe("mensaje de la base\n");
  });

  it("si el verificador falla, el guardián sale con su código aunque él haya pasado", () => {
    const corrida = correrCli(repoSano(), ["--sin-informe", "--base", base("process.exit(3);\n")]);
    expect(corrida.status).toBe(3);
    expect(corrida.stdout).toMatch(/^Guardián de contratos: OK · /);
    expect(corrida.stderr).toBe("");
  });

  it("si el verificador muere por una señal, sale con 1", () => {
    const carpeta = base('process.kill(process.pid, "SIGKILL");\n');
    const corrida = correrCli(repoSano(), ["--sin-informe", "--base", carpeta]);
    expect(corrida.status).toBe(1);
  });

  it("si el guardián falla sale con 1, pase o no pase la base", () => {
    for (const programa of ["process.exit(0);\n", "process.exit(3);\n"]) {
      const repo = repoSano();
      escribirEn(repo, "herramienta/x.ts", "export {};\n");
      const corrida = correrCli(repo, ["--sin-informe", "--base", base(programa)]);
      expect(corrida.status, programa).toBe(1);
    }
  });

  it("con la base que pasa y el guardián que pasa sale con 0 y sin ruido", () => {
    const corrida = correrCli(repoSano(), ["--sin-informe", "--base", base("process.exit(0);\n")]);
    expect(corrida.status).toBe(0);
    expect(corrida.stderr).toBe("");
  });

  it("--base como primera opción no se confunde con --informe", () => {
    const repo = repoSano();
    const corrida = correrCli(repo, ["--base", base("process.exit(0);\n")]);
    expect(corrida.status).toBe(0);
    expect(corrida.stderr).toBe("");
    expect(existsSync(join(repo, INFORME))).toBe(true);
  });
});
