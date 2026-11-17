import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * H-DOM-1: toda ruta pública de la carta bajo `apps/web/app/s/carta` pide la carta con la PUERTA ENTERA (marca + dueño del host), nunca con la marca sola.
 * Previene: un host dedicado a la empresa A servía la carta de la B de la misma marca porque la página pasaba solo `puerta.marcaId`. El tipo de
 * `vidrieraParaLaPantalla`/`productoParaLaPantalla` ya exige el dueño; esto cubre el atajo de volver a pasar un string suelto o de resolver la carta por otro camino.
 * Límite que NO ve: una ruta de la carta que arme el alcance a mano (`{ marcaId, duenio: { tipo: "MARCA" } }`) o que llame al puerto por otro nombre; el revisor lo mira.
 */
const CARPETA_DE_LA_CARTA = "apps/web/app/s/carta";
const AYUDANTES = ["vidrieraParaLaPantalla", "productoParaLaPantalla"] as const;

const sinComentarios = (fuente: string): string =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Lo que está mal en UNA ruta de la carta, dicho en palabras; vacío si cumple. `conCodigo`: la ruta tiene un segmento `[codigo]`. */
function problemasDeUnaRutaDeLaCarta(fuente: string, conCodigo: boolean): string[] {
  const codigo = sinComentarios(fuente);
  const problemas: string[] = [];
  if (/\.marcaId\b/.test(codigo)) problemas.push("usa `.marcaId` suelto: pasar la puerta entera");
  const llamadas = [
    ...codigo.matchAll(new RegExp(`\\b(${AYUDANTES.join("|")})\\(\\s*([^,)]*)`, "g")),
  ];
  for (const [, ayudante, primero] of llamadas) {
    if ((primero ?? "").trim() !== "puerta") {
      problemas.push(`${ayudante ?? ""} no recibe \`puerta\` como primer argumento`);
    }
  }
  if (conCodigo && llamadas.length === 0) {
    problemas.push(
      "una ruta con [codigo] no llama a la carta con la puerta (sin dueño no se resuelve)",
    );
  }
  return problemas;
}

function archivosDeRutas(base: string): { ruta: string; conCodigo: boolean }[] {
  const encontrados: { ruta: string; conCodigo: boolean }[] = [];
  const recorrer = (carpeta: string) => {
    for (const e of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/^(page|route)\.tsx?$/.test(e.name)) {
        encontrados.push({ ruta, conCodigo: ruta.includes("[codigo]") });
      }
    }
  };
  recorrer(join(base, CARPETA_DE_LA_CARTA));
  return encontrados;
}

const directorios: string[] = [];
afterEach(() => {
  for (const d of directorios.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("H-DOM-1: las rutas de la carta piden la carta con la puerta entera", () => {
  it("la forma correcta pasa", () => {
    const bien = `const puerta = await exigirPuerta("CARTA");\nawait vidrieraParaLaPantalla(puerta, codigo);`;
    expect(problemasDeUnaRutaDeLaCarta(bien, true)).toEqual([]);
  });

  it.each([
    ["la marca suelta", `await vidrieraParaLaPantalla(puerta.marcaId, codigo);`],
    ["un string cualquiera", `await productoParaLaPantalla("m1", codigo, seg);`],
    ["otra variable", `await vidrieraParaLaPantalla(otra, codigo);`],
    [
      "un alcance a medida con puerta.marcaId",
      `const x = puerta.marcaId; await vidrieraParaLaPantalla(puerta, codigo);`,
    ],
    [
      "una llamada partida en líneas con la marca",
      `await vidrieraParaLaPantalla(\n  puerta.marcaId,\n  codigo,\n);`,
    ],
  ])("VIOLACIÓN inyectada: %s", (_nombre, fuente) => {
    expect(problemasDeUnaRutaDeLaCarta(fuente, true)).not.toEqual([]);
  });

  it("VIOLACIÓN inyectada: una ruta con [codigo] que no pide la carta por la puerta", () => {
    expect(
      problemasDeUnaRutaDeLaCarta(`export default function P() { return null; }`, true),
    ).not.toEqual([]);
    expect(
      problemasDeUnaRutaDeLaCarta(`export default function P() { return null; }`, false),
    ).toEqual([]);
  });

  it("un comentario que nombra `puerta.marcaId` no cuenta", () => {
    const fuente = `// antes: puerta.marcaId\nawait vidrieraParaLaPantalla(puerta, c);`;
    expect(problemasDeUnaRutaDeLaCarta(fuente, true)).toEqual([]);
  });

  it("recorre un árbol inyectado y marca solo la ruta mala", () => {
    const base = mkdtempSync(join(tmpdir(), "pedernal-carta-"));
    directorios.push(base);
    const poner = (ruta: string, contenido: string) => {
      const destino = join(base, CARPETA_DE_LA_CARTA, ruta);
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, contenido);
    };
    poner("[codigo]/page.tsx", "await vidrieraParaLaPantalla(puerta, c);");
    poner("[codigo]/[producto]/page.tsx", "await productoParaLaPantalla(puerta.marcaId, c, s);");
    const malas = archivosDeRutas(base)
      .filter(
        (a) => problemasDeUnaRutaDeLaCarta(readFileSync(a.ruta, "utf8"), a.conCodigo).length > 0,
      )
      .map((a) => a.ruta.replace(`${base}/`, ""));
    expect(malas).toEqual([`${CARPETA_DE_LA_CARTA}/[codigo]/[producto]/page.tsx`]);
  });

  it("el repositorio real las cumple y tiene rutas de la carta que revisar", () => {
    const rutas = archivosDeRutas(".");
    expect(rutas.filter((r) => r.conCodigo).length).toBeGreaterThanOrEqual(2);
    for (const r of rutas) {
      expect(
        problemasDeUnaRutaDeLaCarta(readFileSync(r.ruta, "utf8"), r.conCodigo),
        r.ruta,
      ).toEqual([]);
    }
  });
});
