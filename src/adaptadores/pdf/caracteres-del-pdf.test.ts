import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { leerElPdf } from "../../../test/utilidades/pdf";
import { soloCaracteresPermitidos } from "../../primitivas/texto/texto-de-una-linea";
import {
  CARACTERES_DEL_PDF,
  CaracterNoSoportadoEnElPdf,
  exigirTextoSoportado,
  primerCaracterNoSoportado,
} from "./caracteres-del-pdf";

/** Dibuja un texto con la tipografía del PDF y devuelve lo que un lector lee de vuelta. */
async function dibujarYLeer(texto: string): Promise<string> {
  const doc = new PDFDocument({ size: [595, 842], margin: 0 });
  const trozos: Uint8Array[] = [];
  doc.on("data", (t) => trozos.push(t));
  const fin = new Promise<void>((resolver) => doc.on("end", resolver));
  doc.font("Helvetica").fontSize(9).text(texto, 20, 20, { lineBreak: false });
  doc.end();
  await fin;
  const bytes = new Uint8Array(trozos.reduce((suma, t) => suma + t.length, 0));
  let desde = 0;
  for (const t of trozos) {
    bytes.set(t, desde);
    desde += t.length;
  }
  return (await leerElPdf(bytes))[0]?.trozos.map((t) => t.texto).join("") ?? "";
}

describe("los caracteres que el PDF puede dibujar", () => {
  it("cada carácter permitido se dibuja y se lee de vuelta igual (la lista no promete glifos que no existen)", async () => {
    const todos = [...CARACTERES_DEL_PDF].map((punto) => String.fromCodePoint(punto));
    // En tandas cortas: un fallo apunta a su tanda.
    for (let i = 0; i < todos.length; i += 32) {
      const tanda = todos.slice(i, i + 32).join("");
      // El lector junta los blancos de los extremos: se prueba con una letra a cada lado.
      expect(await dibujarYLeer(`x${tanda}x`)).toBe(`x${tanda}x`);
    }
  }, 60000);

  it("todo carácter que admite la primitiva del nombre del receptor se puede dibujar en el PDF (la lista de la primitiva ⊆ la del PDF)", () => {
    const admitidos: number[] = [];
    for (let punto = 0; punto <= 0x10ffff; punto += 1) {
      // Los sustitutos sueltos no son caracteres; el resto se prueba solo, con una letra a cada lado.
      if (punto >= 0xd800 && punto <= 0xdfff) continue;
      if (soloCaracteresPermitidos(`a${String.fromCodePoint(punto)}a`)) admitidos.push(punto);
    }
    // La prueba no es trivial: la primitiva admite un puñado de caracteres y no todo el plano.
    expect(admitidos.length).toBeGreaterThan(100);
    expect(admitidos.length).toBeLessThan(400);
    expect(admitidos.filter((punto) => !CARACTERES_DEL_PDF.has(punto))).toEqual([]);
  }, 60000);

  it("incluye las tildes, la ñ, la ü, los signos de apertura y el euro; excluye el emoji y la escritura de derecha a izquierda", () => {
    for (const texto of ["áéíóúÁÉÍÓÚñÑüÜ¿¡€—“”", "Peña Ñandú, S.R.L. (CUIT 30-1)"]) {
      expect(primerCaracterNoSoportado(texto)).toBeNull();
    }
    expect(primerCaracterNoSoportado("a😀b")).toBe(0x1f600);
    expect(primerCaracterNoSoportado("שלום")).toBe(0x5e9);
    expect(primerCaracterNoSoportado("日本")).toBe(0x65e5);
  });

  it("rechaza los de control, el espacio de no separación, el guion blando y el signo micro (el lector los normaliza)", () => {
    for (const c of ["\n", "\t", "\r", "\u0000", "\u007f", " ", "­", "‏", "‮"]) {
      expect(primerCaracterNoSoportado(`a${c}b`)).not.toBeNull();
    }
  });

  it("un carácter fuera de la lista corta con un error que lleva solo el punto de código, nunca el texto", () => {
    let error: unknown;
    try {
      exigirTextoSoportado("Cliente Secreto 😀");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CaracterNoSoportadoEnElPdf);
    expect((error as Error).message).toBe("carácter fuera de la tipografía del PDF: U+1F600");
    expect((error as Error).message).not.toContain("Secreto");
    expect(() => exigirTextoSoportado("Ñandú")).not.toThrow();
  });

  it("el texto vacío se acepta", () => {
    expect(primerCaracterNoSoportado("")).toBeNull();
  });
});
