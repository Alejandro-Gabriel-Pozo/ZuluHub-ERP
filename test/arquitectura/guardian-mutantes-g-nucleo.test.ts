import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AHORA,
  cargarDelRepo,
  contrato as contratoDeEjemplo,
  correr,
  limpiarTemporales,
  type Informe,
} from "./guardian-apoyo";
import { git, repoConArchivos } from "./guardian-mutantes-b-apoyo";

/**
 * Lo que el guardián hace, desde G6, con lo que git lista y no se puede analizar, y con el catálogo de la
 * batería de evasión: un nombre de archivo que no es UTF-8, un enlace roto o una ruta que ya no está (y no
 * es un borrado pendiente) FALLAN con `ruta-ilegible` en vez de avisar y seguir; el catálogo
 * (`evasiones.json`) se lee y se valida en cada corrida. Todo sobre repositorios git sintéticos en carpetas
 * temporales (nunca el real ni su `.git`).
 */

afterEach(limpiarTemporales);

const DATOS = {
  "arquitectura/contratos/excepciones.json": "[]\n",
  "arquitectura/contratos/exclusiones.json": "[]\n",
  "arquitectura/contratos/evasiones.json": "[]\n",
};
const EVASIONES = "arquitectura/contratos/evasiones.json";

/** Escribe un archivo cuyo nombre lleva bytes crudos (un `string` los pasaría a UTF-8): la ruta va como `Buffer`. */
function escribirConNombre(repo: string, nombre: number[], contenido = "x\n"): void {
  writeFileSync(Buffer.concat([Buffer.from(`${repo}/`), Buffer.from(nombre)]), contenido);
}
const bytes = (texto: string, ...resto: number[]): number[] => [...Buffer.from(texto), ...resto];

const fallaDeNombre = (archivo: string) => ({
  codigo: "ruta-ilegible",
  archivo,
  contrato: null,
  motivo: "El nombre del archivo no es UTF-8 válido: no se puede leer y quedaría sin analizar.",
  correccion: "Renombralo con un nombre UTF-8 (git mv).",
  donde: { tipo: "archivo" },
});

describe("cargarDelRepo: los nombres de archivo", () => {
  it("un nombre con acentos, eñes, símbolos y emojis válidos se lista bien y se puede leer", () => {
    const repo = repoConArchivos({ ...DATOS, "año/ñandú.ts": "uno", "🙂 ✓.txt": "dos" });
    const cargado = cargarDelRepo(repo);
    expect(cargado.rutas).toContain("año/ñandú.ts");
    expect(cargado.rutas).toContain("🙂 ✓.txt");
    expect(String(cargado.leer("año/ñandú.ts"))).toBe("uno");
    expect(String(cargado.leer("🙂 ✓.txt"))).toBe("dos");
    expect(cargado.previas).toEqual({ fallas: [], avisos: [] });
  });

  it("un nombre con un byte que no es UTF-8 FALLA con el nombre escapado, y no se pierde ni se lista", () => {
    const repo = repoConArchivos(DATOS);
    escribirConNombre(repo, bytes("archivo-", 0xff, 0x2e, 0x74, 0x73));
    escribirConNombre(repo, bytes("bien.ts"));
    const cargado = cargarDelRepo(repo);
    expect(cargado.previas.fallas).toStrictEqual([fallaDeNombre("archivo-\\xff.ts")]);
    expect(cargado.previas.avisos).toEqual([]);
    expect(cargado.rutas).toContain("bien.ts");
    expect(cargado.rutas.some((ruta) => ruta.startsWith("archivo-"))).toBe(false);
  });

  it("cada byte fuera de lo imprimible (control, borrar, 0x80 en adelante) va escapado con dos dígitos; lo demás, tal cual", () => {
    const repo = repoConArchivos(DATOS);
    // espacio (0x20) y tilde (0x7e) se ven; 0x07, 0x7f y los de «é» (0xc3 0xa9) y 0xff, escapados
    escribirConNombre(repo, bytes("a b~", 0x07, 0x7f, 0xc3, 0xa9, 0xff, 0x2e, 0x74));
    const { fallas } = cargarDelRepo(repo).previas as { fallas: { archivo: string }[] };
    expect(fallas.map((f) => f.archivo)).toEqual(["a b~\\x07\\x7f\\xc3\\xa9\\xff.t"]);
  });

  it("varios nombres rotos fallan cada uno por separado, en el orden de las rutas", () => {
    const repo = repoConArchivos(DATOS);
    escribirConNombre(repo, bytes("z-", 0xfe));
    escribirConNombre(repo, bytes("a-", 0xff));
    const { fallas } = cargarDelRepo(repo).previas as { fallas: { archivo: string }[] };
    expect(fallas.map((f) => f.archivo)).toEqual(["a-\\xff", "z-\\xfe"]);
  });
});

describe("cargarDelRepo: lo que git lista y no está en el disco", () => {
  it("un enlace simbólico roto FALLA (no se avisa): no hay nada que analizar y no es un borrado pendiente", () => {
    const repo = repoConArchivos({ ...DATOS, "queda.ts": "q" });
    symlinkSync("/no/existe/en/el/runner", join(repo, "enlace.ts"));
    const cargado = cargarDelRepo(repo);
    expect(cargado.previas.fallas).toStrictEqual([
      {
        codigo: "ruta-ilegible",
        archivo: "enlace.ts",
        contrato: null,
        motivo:
          "Git la lista y no se puede leer en el disco (¿un enlace simbólico roto?), y no es un borrado pendiente: quedaría sin analizar.",
        correccion: "Arreglá el enlace o sacá el archivo del repositorio.",
        donde: { tipo: "archivo" },
      },
    ]);
    expect(cargado.previas.avisos).toEqual([]);
    expect(cargado.rutas).not.toContain("enlace.ts");
    expect(cargado.rutas).toContain("queda.ts");
  });

  it("el enlace roto también falla cuando ya está en el índice de git", () => {
    const repo = repoConArchivos(DATOS);
    symlinkSync("/no/existe", join(repo, "enlace.ts"));
    git(repo, "add", "enlace.ts");
    expect(
      cargarDelRepo(repo).previas.fallas.map((f) => (f as { archivo: string }).archivo),
    ).toEqual(["enlace.ts"]);
  });

  it("un enlace que apunta a un archivo que existe se lista y se lee como siempre", () => {
    const repo = repoConArchivos({ ...DATOS, "real.ts": "contenido" });
    symlinkSync("real.ts", join(repo, "alias.ts"));
    const cargado = cargarDelRepo(repo);
    expect(cargado.rutas).toContain("alias.ts");
    expect(String(cargado.leer("alias.ts"))).toBe("contenido");
    expect(cargado.previas).toEqual({ fallas: [], avisos: [] });
  });

  it("un borrado pendiente se avisa y un enlace roto falla, en la misma corrida", () => {
    const repo = repoConArchivos({ ...DATOS, "se-borra.ts": "b" });
    git(repo, "add", ".");
    rmSync(join(repo, "se-borra.ts"));
    symlinkSync("/no/existe", join(repo, "enlace.ts"));
    const cargado = cargarDelRepo(repo);
    expect(cargado.previas.avisos.map((a) => (a as { archivo: string }).archivo)).toEqual([
      "se-borra.ts",
    ]);
    expect(cargado.previas.fallas.map((f) => (f as { archivo: string }).archivo)).toEqual([
      "enlace.ts",
    ]);
  });

  it("un archivo borrado Y registrado (git rm) ya no se lista ni se avisa", () => {
    const repo = repoConArchivos({ ...DATOS, "se-va.ts": "b" });
    git(repo, "add", ".");
    git(repo, "rm", "-q", "-f", "se-va.ts");
    const cargado = cargarDelRepo(repo);
    expect(cargado.rutas).not.toContain("se-va.ts");
    expect(cargado.previas).toEqual({ fallas: [], avisos: [] });
  });
});

describe("cargarDelRepo: el catálogo de la batería de evasión", () => {
  it("lo lee como JSON y lo devuelve", () => {
    const repo = repoConArchivos({ ...DATOS, [EVASIONES]: '[{ "id": "EV-001" }]\n' });
    const cargado = cargarDelRepo(repo);
    expect(cargado.evasiones).toEqual([{ id: "EV-001" }]);
    expect(cargado.previas.fallas).toEqual([]);
  });

  it("si falta es una falla propia (evasion-invalida), con el motivo del sistema", () => {
    const repo = repoConArchivos({
      "arquitectura/contratos/excepciones.json": "[]\n",
      "arquitectura/contratos/exclusiones.json": "[]\n",
    });
    const cargado = cargarDelRepo(repo);
    expect(cargado.evasiones).toEqual([]);
    expect(cargado.previas.fallas).toStrictEqual([
      {
        codigo: "evasion-invalida",
        archivo: EVASIONES,
        contrato: null,
        motivo: `No se pudo leer el archivo como JSON: ENOENT: no such file or directory, open '${join(repo, EVASIONES)}'.`,
        correccion: "Dejalo como una lista JSON válida.",
        donde: { tipo: "json", camino: [] },
      },
    ]);
  });

  it("si no es JSON es una falla propia con el motivo del analizador, y las excepciones siguen con su código", () => {
    const roto = '[\n  { "id": "x",\n';
    const repo = repoConArchivos({ ...DATOS, [EVASIONES]: roto });
    let motivoDelAnalizador = "";
    try {
      JSON.parse(roto);
    } catch (error) {
      motivoDelAnalizador = (error as Error).message;
    }
    const { fallas } = cargarDelRepo(repo).previas as {
      fallas: { codigo: string; motivo: string }[];
    };
    expect(fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      ["evasion-invalida", `No se pudo leer el archivo como JSON: ${motivoDelAnalizador}.`],
    ]);
    const sinExcepciones = repoConArchivos({
      ...DATOS,
      "arquitectura/contratos/excepciones.json": "{",
    });
    expect(
      (cargarDelRepo(sinExcepciones).previas.fallas as { codigo: string }[]).map((f) => f.codigo),
    ).toEqual(["excepcion-invalida"]);
  });
});

describe("ejecutar: el catálogo de la batería de evasión", () => {
  const CASO = {
    id: "EV-001",
    via: "filtros",
    titulo: "Carpeta nueva sin regla",
    construccion: [],
    controlEsperado: "clasificacion.cjs",
    esperado: { tipo: "exige-excepcion" },
    estado: "brecha-abierta",
    responsable: "agente (a pedido del dueño)",
    severidad: "alta",
    justificacion: "Pasa sin detección.",
    mitigacion: "Revisión manual.",
    creada: "2026-10-01",
    vence: "2026-11-30",
  };

  it("sin catálogo (undefined) no se valida nada: ni fallas ni avisos de la batería", () => {
    const resultado = correr();
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
  });

  it("con un catálogo, sus fallas y sus avisos se suman a los del guardián", () => {
    const resultado = correr({
      evasiones: [CASO, { ...CASO, id: "EV-002", vence: "2026-10-20" }],
      archivos: { "herramienta/x.ts": "" },
    });
    expect(resultado.fallas.map((f) => f.codigo).sort()).toEqual([
      "brecha-vencida",
      "ruta-sin-clase",
    ]);
    expect(resultado.avisos.map((a) => a.codigo)).toEqual(["brecha-abierta"]);
    expect(resultado.informe.totales["fallas"]).toBe(2);
    expect(resultado.informe.totales["avisos"]).toBe(1);
  });

  it("un catálogo que no es una lista (aunque sea null) falla: nunca se saltea en silencio", () => {
    for (const evasiones of [null, {}, "[]", 0]) {
      expect(
        correr({ evasiones }).fallas.map((f) => f.codigo),
        JSON.stringify(evasiones),
      ).toEqual(["evasion-invalida"]);
    }
    expect(correr({ evasiones: [] }).fallas).toEqual([]);
  });

  it("usa el reloj del guardián: la misma brecha vence con otra fecha", () => {
    expect(correr({ evasiones: [CASO], ahora: AHORA }).fallas).toEqual([]);
    const despues = correr({ evasiones: [CASO], ahora: new Date("2026-12-01T00:00:00Z") });
    expect(despues.fallas.map((f) => f.codigo)).toEqual(["brecha-vencida"]);
  });

  it("la falla del catálogo trae archivo y la línea de su clave en el JSON", () => {
    const catalogo = [{ ...CASO, vence: "2026-10-20" }];
    const texto = `${JSON.stringify(catalogo, null, 2)}\n`;
    const resultado = correr({ evasiones: catalogo, archivos: { [EVASIONES]: texto } });
    const falla = resultado.fallas.find((f) => f.codigo === "brecha-vencida");
    expect(falla?.archivo).toBe(EVASIONES);
    expect(falla?.linea).toBe(texto.split("\n").findIndex((l) => l.includes('"vence"')) + 1);
  });
});

describe("el informe: lo analizado, lo omitido y lo que no se pudo analizar", () => {
  /** Un contrato de ejemplo que mira `frontend`, con los archivos de `BASE` más los de la prueba. */
  const conArchivos = (archivos: Record<string, string>): Informe =>
    correr({ contratos: [contratoDeEjemplo()], archivos }).informe;

  it("cuenta por clase los binarios omitidos y los archivos que no se pudieron leer", () => {
    const informe = conArchivos({
      "apps/web/ui/foto.png": "\u0000PNG",
      "apps/web/ui/rota.css": "\u0000\u0000",
    });
    expect(informe.clases["frontend"]).toMatchObject({
      binariasOmitidas: 1,
      noAnalizables: 1,
    });
    expect(informe.clases["backend"]).toMatchObject({ binariasOmitidas: 0, noAnalizables: 0 });
    expect(informe.resultado).toBe("falla");
  });

  it("un archivo de texto con extensión de binario se analiza y no cuenta como omitido", () => {
    const informe = conArchivos({ "apps/web/ui/paleta.png": "texto\n" });
    expect(informe.clases["frontend"]).toMatchObject({ binariasOmitidas: 0, noAnalizables: 0 });
    expect(informe.resultado).toBe("pasa");
  });

  it("si el registro no se pudo cargar no hay análisis: todo en cero", () => {
    const informe = correr({
      contratos: [{}],
      archivos: { "apps/web/ui/foto.png": "\u0000PNG" },
    }).informe;
    for (const clase of Object.values(informe.clases)) {
      expect([clase.binariasOmitidas, clase.noAnalizables, clase.analizadasPorDetectores]).toEqual([
        0, 0, 0,
      ]);
    }
  });
});
