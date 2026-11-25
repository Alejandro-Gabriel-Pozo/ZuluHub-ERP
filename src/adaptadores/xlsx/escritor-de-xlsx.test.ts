import { describe, expect, it } from "vitest";
import type { HojaDePlanilla } from "../../primitivas/planilla/celda";
import { crearEscritorDeXlsx } from "./escritor-de-xlsx";
import { leerZipComoTextos } from "./leer-zip-de-prueba";

const HOJAS: readonly HojaDePlanilla[] = [
  {
    nombre: "Cabecera",
    encabezados: ["Proveedor", "Total según factura", "Fecha del comprobante", "Cantidad", "Signo"],
    filas: [
      [
        { tipo: "texto", valor: "=HYPERLINK(\"http://x\")" },
        { tipo: "decimal", valor: "1369499.91", decimales: 2 },
        { tipo: "fecha", valor: "2026-10-23" },
        { tipo: "decimal", valor: "8.9400", decimales: 4 },
        { tipo: "entero", valor: -1 },
      ],
      [
        { tipo: "texto", valor: "-2+3" },
        { tipo: "decimal", valor: "12345678901234567.89", decimales: 2 },
        null,
        null,
        { tipo: "entero", valor: 1 },
      ],
    ],
  },
  { nombre: "Detalle", encabezados: ["Producto"], filas: [[{ tipo: "texto", valor: "@SUM(A1)" }]] },
];

describe("el escritor de .xlsx", () => {
  it("escribe el dinero como número exacto, las fechas como serie del día, y no deja ninguna fórmula", async () => {
    const zip = leerZipComoTextos(await crearEscritorDeXlsx().escribir(HOJAS));
    const hoja1 = zip.get("xl/worksheets/sheet1.xml") ?? "";
    expect(hoja1).toContain("<v>1369499.91</v>");
    expect(hoja1).toContain("<v>46318</v>");
    expect(hoja1).toContain("<v>8.94</v>");
    expect(hoja1).toContain("<v>-1</v>");
    // Ninguna fórmula en ninguna hoja.
    for (const [nombre, xml] of zip) if (nombre.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    // El texto peligroso es una cadena (t="s") con su comilla antepuesta; el importe de 17 dígitos también es texto exacto.
    const cadenas = zip.get("xl/sharedStrings.xml") ?? "";
    expect(cadenas).toContain("'=HYPERLINK");
    expect(cadenas).toContain("'-2+3");
    expect(cadenas).toContain("'@SUM(A1)");
    expect(cadenas).toContain("12345678901234567.89");
    expect(hoja1).not.toContain("<v>12345678901234567");
  });

  it("las dos hojas llevan su nombre y sus encabezados", async () => {
    const zip = leerZipComoTextos(await crearEscritorDeXlsx().escribir(HOJAS));
    expect(zip.get("xl/workbook.xml")).toContain('name="Cabecera"');
    expect(zip.get("xl/workbook.xml")).toContain('name="Detalle"');
    expect(zip.get("xl/sharedStrings.xml")).toContain("Total según factura");
  });

  it("repetir da el mismo contenido de celdas (los bytes del zip llevan la hora de armado)", async () => {
    const [a, b] = await Promise.all([
      crearEscritorDeXlsx().escribir(HOJAS),
      crearEscritorDeXlsx().escribir(HOJAS),
    ]);
    const za = leerZipComoTextos(a);
    const zb = leerZipComoTextos(b);
    expect([...zb.entries()]).toEqual([...za.entries()]);
  });
});
