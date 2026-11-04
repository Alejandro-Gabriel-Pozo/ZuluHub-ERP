import { describe, expect, it } from "vitest";
import {
  comparar,
  type ContratoDePrueba,
  type DetectorDePrueba,
  type SalidaDeComparar,
} from "./guardian-mutantes-a-apoyo";

/**
 * Lo que `comparacion.cjs` hace con un archivo que un detector tiene que leer: se lee SIEMPRE, y si no es
 * texto UTF-8 (bytes nulos o secuencias que no decodifican) solo se deja afuera cuando su extensión es la de
 * un binario conocido; cualquier otro archivo ilegible FALLA (`ruta-ilegible`). Un archivo con extensión de
 * binario que es texto se analiza como texto: un detector no puede quedarse sin ver una definición porque
 * el nombre diga «.png». Nada de esto pasa en silencio: el informe cuenta lo analizado, lo omitido y lo que
 * no se pudo analizar.
 */

const FUENTE = "src/u/f.ts";
const NO_SE_PUDO_LEER = "No se pudo leer el archivo para analizarlo.";
const MOTIVO_DE_LA_CODIFICACION =
  "El archivo no es texto UTF-8 (tiene bytes nulos o secuencias que no decodifican) y su extensión no es la de un binario conocido: ningún detector lo puede leer.";
const CORRECCION_DE_LA_CODIFICACION =
  "Guardalo como UTF-8 (un archivo en UTF-16 o en otra codificación no se analiza) o, si de verdad es un binario, usá una extensión de binario conocida.";

/** Un detector que marca las líneas con la palabra `secreto` (uso) o, de tipo definición, con `color`. */
const detector = (tipo: string, palabra: string): DetectorDePrueba => ({
  tipo,
  clases: ["backend", "frontend"],
  reconoce: (texto) =>
    texto
      .split(/\r\n|\n/)
      .flatMap((linea, indice) => (linea.includes(palabra) ? [{ linea: indice + 1 }] : [])),
});
const contrato = (...deteccion: DetectorDePrueba[]): ContratoDePrueba => ({
  id: "c1",
  fuenteDeVerdad: { archivo: FUENTE, exportacion: "fuente" },
  deteccion,
  // La unidad declara usarlo y a veces no hay ningún uso legible: eso es un aviso, no el tema de estas pruebas.
  bloqueaDeclaracionFalsa: false,
});

type Contenido = string | Buffer | null;
/** Corre la comparación sobre archivos de la clase `backend` de la unidad `src/u` (que declara usar `c1`). */
function correr(archivos: Record<string, Contenido>, clases: Record<string, string> = {}) {
  const todos: Record<string, Contenido> = { [FUENTE]: "export const fuente = 1;", ...archivos };
  const leidas: string[] = [];
  const registro = contrato(detector("uso", "secreto"), detector("definicion", "color"));
  return {
    ...comparar({
      registro: { contratos: [registro], porId: new Map([[registro.id, registro]]) },
      porRuta: new Map(
        Object.keys(archivos).map((ruta): [string, string] => [ruta, clases[ruta] ?? "backend"]),
      ),
      rutas: new Set(Object.keys(todos)),
      leer: (ruta) => {
        leidas.push(ruta);
        return todos[ruta] ?? null;
      },
      declaraciones: new Map([["src/u", { usa: ["c1"], noUsa: null }]]),
      clasesExcluidas: new Set(),
      rutasExcluidas: new Set(),
    }),
    leidas,
  };
}
const utf16 = (texto: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(texto, "utf16le")]);
const PNG_DE_VERDAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function fallasDe(salida: SalidaDeComparar) {
  return salida.fallas.map((f) => [f.codigo, f.archivo, f.motivo]);
}

describe("un archivo que no es texto UTF-8 y no tiene extensión de binario FALLA", () => {
  it("UTF-16 con BOM: ruta-ilegible con el motivo de la codificación, contado como no analizable", () => {
    const salida = correr({ "src/u/a.ts": utf16("const secreto = 1;\n") });
    expect(salida.fallas).toStrictEqual([
      {
        codigo: "ruta-ilegible",
        archivo: "src/u/a.ts",
        contrato: null,
        motivo: MOTIVO_DE_LA_CODIFICACION,
        correccion: CORRECCION_DE_LA_CODIFICACION,
        donde: { tipo: "archivo" },
      },
    ]);
    expect(salida.noAnalizablesPorClase).toEqual({ backend: 1 });
    expect(salida.escaneadasPorClase).toEqual({});
    expect(salida.omitidasPorClase).toEqual({});
    // y el detector no llegó a ver el archivo: ningún uso ni definición salió de él
    expect(salida.hallazgos).toEqual([]);
  });

  it("bytes que no decodifican como UTF-8 (sin ningún nulo) también fallan", () => {
    const salida = correr({
      "src/u/a.ts": Buffer.from([0x63, 0x6f, 0x6c, 0x6f, 0x72, 0xff, 0x0a]),
    });
    expect(fallasDe(salida)).toEqual([["ruta-ilegible", "src/u/a.ts", MOTIVO_DE_LA_CODIFICACION]]);
    expect(salida.noAnalizablesPorClase).toEqual({ backend: 1 });
  });

  it("texto UTF-8 válido con un byte nulo adentro falla (un nulo nunca es texto)", () => {
    const salida = correr({ "src/u/a.ts": Buffer.from("secreto\u0000 = 1\n") });
    expect(fallasDe(salida)).toEqual([["ruta-ilegible", "src/u/a.ts", MOTIVO_DE_LA_CODIFICACION]]);
  });

  it("un texto (string) con un nulo también falla; sin nulos se analiza", () => {
    expect(fallasDe(correr({ "src/u/a.ts": "secreto\u0000" }))).toEqual([
      ["ruta-ilegible", "src/u/a.ts", MOTIVO_DE_LA_CODIFICACION],
    ]);
    const limpio = correr({ "src/u/a.ts": "secreto\n" });
    expect(limpio.fallas).toEqual([]);
    expect(limpio.escaneadasPorClase).toEqual({ backend: 1 });
  });

  it("un texto UTF-8 con acentos, eñes y emojis se lee bien", () => {
    const salida = correr({ "src/u/a.ts": "// ñandú ✓ 🙂 secreto\n" });
    expect(salida.fallas).toEqual([]);
    expect(salida.noAnalizablesPorClase).toEqual({});
    expect(salida.hallazgos.map((h) => [h.codigo, h.linea])).toEqual([]);
    expect(salida.escaneadasPorClase).toEqual({ backend: 1 });
  });

  it("cada archivo ilegible suma uno en su clase y falla por separado, sin frenar a los demás", () => {
    const salida = correr(
      {
        "src/u/a.ts": utf16("x"),
        "src/u/b.ts": utf16("y"),
        "src/u/c.ts": "secreto\n",
      },
      {},
    );
    expect(fallasDe(salida).map(([, archivo]) => archivo)).toEqual(["src/u/a.ts", "src/u/b.ts"]);
    expect(salida.noAnalizablesPorClase).toEqual({ backend: 2 });
    expect(salida.escaneadasPorClase).toEqual({ backend: 1 });
  });

  it("el archivo que no se puede leer (el disco devuelve null) también cuenta como no analizable", () => {
    const salida = correr({ "src/u/a.ts": null });
    expect(salida.fallas).toStrictEqual([
      {
        codigo: "ruta-ilegible",
        archivo: "src/u/a.ts",
        contrato: null,
        motivo: NO_SE_PUDO_LEER,
        correccion: "Verificá que el archivo exista en el árbol de trabajo.",
        donde: { tipo: "archivo" },
      },
    ]);
    expect(salida.noAnalizablesPorClase).toEqual({ backend: 1 });
    expect(salida.omitidasPorClase).toEqual({});
  });

  it("un archivo con extensión de binario que no se puede leer tampoco se omite en silencio", () => {
    const salida = correr({ "src/u/foto.png": null });
    expect(fallasDe(salida)).toEqual([["ruta-ilegible", "src/u/foto.png", NO_SE_PUDO_LEER]]);
    expect(salida.omitidasPorClase).toEqual({});
  });
});

describe("un archivo con extensión de binario conocida", () => {
  it("si es binario de verdad (bytes nulos o UTF-8 inválido) se omite, sin fallar, y se cuenta como omitido", () => {
    const salida = correr({
      "src/u/foto.png": PNG_DE_VERDAD,
      "src/u/otra.JPG": Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      "src/u/doc.pdf": Buffer.from("%PDF-1.7\n%\u0000\u0001\n"),
    });
    expect(salida.fallas).toEqual([]);
    expect(salida.omitidasPorClase).toEqual({ backend: 3 });
    expect(salida.escaneadasPorClase).toEqual({});
    expect(salida.noAnalizablesPorClase).toEqual({});
    expect(salida.hallazgos).toEqual([]);
  });

  it("la extensión es la ÚLTIMA del nombre: un «.png» en el medio no vuelve binario a un archivo ilegible", () => {
    const salida = correr({
      "src/u/foto.png.ts": utf16("const secreto = 1;\n"),
      "src/u/foto.pdf.bak": utf16("x"),
    });
    expect(fallasDe(salida)).toEqual([
      ["ruta-ilegible", "src/u/foto.pdf.bak", MOTIVO_DE_LA_CODIFICACION],
      ["ruta-ilegible", "src/u/foto.png.ts", MOTIVO_DE_LA_CODIFICACION],
    ]);
    expect(salida.omitidasPorClase).toEqual({});
  });

  it("se lee igual (la extensión sola no alcanza para saltearlo)", () => {
    const salida = correr({ "src/u/foto.png": PNG_DE_VERDAD });
    expect(salida.leidas).toContain("src/u/foto.png");
  });

  it("si es texto UTF-8 se analiza como texto: una definición escondida en un «.png» se ve", () => {
    const salida = correr({
      "src/u/paleta.png": "color de respaldo: #a1b2c3\nsecreto\n",
      "src/u/foto.webp": "texto plano que dice secreto\n",
    });
    expect(salida.omitidasPorClase).toEqual({});
    expect(salida.escaneadasPorClase).toEqual({ backend: 2 });
    expect(salida.fallas).toEqual([]);
    expect(
      salida.hallazgos
        .map((h) => [h.codigo, h.archivo, h.linea])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual([["definicion-fuera-de-la-fuente", "src/u/paleta.png", 1]]);
  });

  it("un texto vacío con extensión de binario es texto (no hay nada que omitir ni nada que ver)", () => {
    const salida = correr({ "src/u/vacio.png": "" });
    expect(salida.omitidasPorClase).toEqual({});
    expect(salida.escaneadasPorClase).toEqual({ backend: 1 });
    expect(salida.fallas).toEqual([]);
  });

  it("cada clase cuenta lo suyo por separado", () => {
    const salida = correr(
      {
        "src/u/a.png": PNG_DE_VERDAD,
        "src/u/b.ts": utf16("x"),
        "src/u/c.ts": "secreto\n",
        "src/u/d.css": "color\n",
        "src/u/e.css": utf16("x"),
      },
      { "src/u/d.css": "frontend", "src/u/e.css": "frontend", "src/u/b.ts": "backend" },
    );
    expect(salida.omitidasPorClase).toEqual({ backend: 1 });
    expect(salida.escaneadasPorClase).toEqual({ backend: 1, frontend: 1 });
    expect(salida.noAnalizablesPorClase).toEqual({ backend: 1, frontend: 1 });
  });
});
