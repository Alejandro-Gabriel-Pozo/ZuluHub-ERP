import { readdirSync, readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { leerElPdf } from "../../../test/utilidades/pdf";
import { CaracterNoSoportadoEnElPdf } from "./caracteres-del-pdf";
import { crearPincel, mm } from "./pincel-del-pdf";

/** Un documento A4 con una página y lo que se escriba en él, como bytes. */
async function conPincel(dibujar: boolean, escribir: (p: ReturnType<typeof crearPincel>) => void) {
  const doc = new PDFDocument({ size: [595, 842], margin: 0 });
  const trozos: Uint8Array[] = [];
  doc.on("data", (t) => trozos.push(t));
  const fin = new Promise<void>((resolver) => doc.on("end", resolver));
  escribir(crearPincel(doc, dibujar));
  doc.end();
  await fin;
  const bytes = new Uint8Array(trozos.reduce((suma, t) => suma + t.length, 0));
  let desde = 0;
  for (const t of trozos) {
    bytes.set(t, desde);
    desde += t.length;
  }
  return bytes;
}

describe("el pincel del PDF", () => {
  it("medir y dibujar dan el mismo alto, y medir no deja nada escrito en el documento", async () => {
    const texto =
      "Un texto bastante largo que tiene que partirse en varias líneas dentro de un ancho angosto. ".repeat(
        3,
      );
    let medido = 0;
    let dibujado = 0;
    const sinTexto = await conPincel(false, (p) => {
      medido = p.texto(texto, mm(10), mm(10), mm(40), { tam: 9 });
    });
    const conTexto = await conPincel(true, (p) => {
      dibujado = p.texto(texto, mm(10), mm(10), mm(40), { tam: 9 });
    });
    expect(medido).toBeGreaterThan(0);
    expect(dibujado).toBe(medido);
    expect((await leerElPdf(sinTexto))[0]?.texto).toBe("");
    expect((await leerElPdf(conTexto))[0]?.texto).not.toBe("");
  });

  it("una línea ocupa el tamaño por el interlineado de la hoja en pantalla (1,25) y el texto vacío no ocupa nada", async () => {
    await conPincel(false, (p) => {
      expect(p.alto("Una línea", mm(100), { tam: 9 })).toBeCloseTo(9 * 1.25, 3);
      expect(p.alto("Una línea", mm(100), { tam: 30, interlineado: 1.1 })).toBeCloseTo(30 * 1.1, 3);
      expect(p.alto("", mm(100), { tam: 9 })).toBe(0);
    });
  });

  it("un renglón más angosto pide más alto, y una palabra larguísima se parte en vez de salirse del ancho", async () => {
    await conPincel(false, (p) => {
      const ancho = mm(30);
      expect(p.alto("palabra ".repeat(12), ancho, { tam: 9 })).toBeGreaterThan(
        p.alto("palabra ".repeat(12), mm(150), { tam: 9 }),
      );
      expect(p.alto("W".repeat(200), ancho, { tam: 9 })).toBeGreaterThan(9 * 1.25 * 5);
    });
  });

  it("también al MEDIR rechaza un carácter que la tipografía no tiene (no se descubre recién al dibujar)", async () => {
    await conPincel(false, (p) => {
      expect(() => p.alto("hola 😀", mm(100), { tam: 9 })).toThrow(CaracterNoSoportadoEnElPdf);
      expect(() => p.ancho("שלום", { tam: 9 })).toThrow(CaracterNoSoportadoEnElPdf);
      expect(() => p.fila({ rotulo: "Cliente", valor: "日本" }, 0, 0, mm(100), 9)).toThrow(
        CaracterNoSoportadoEnElPdf,
      );
      expect(() => p.fila({ rotulo: "Cl‮iente", valor: "x" }, 0, 0, mm(100), 9)).toThrow(
        CaracterNoSoportadoEnElPdf,
      );
    });
  });

  it("solo el pincel escribe o mide texto en el documento: ningún otro archivo del adaptador toca la API de texto de la librería", () => {
    const carpeta = new URL(".", import.meta.url);
    const archivos = readdirSync(carpeta).filter(
      (nombre) =>
        nombre.endsWith(".ts") && !nombre.endsWith(".test.ts") && nombre !== "pincel-del-pdf.ts",
    );
    expect(archivos.length).toBeGreaterThan(3);
    for (const archivo of archivos) {
      const fuente = readFileSync(new URL(archivo, carpeta), "utf8");
      expect(fuente, archivo).not.toMatch(/\.(text|heightOfString|widthOfString)\(/);
    }
  });
});
