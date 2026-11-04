// Trae los tipos del proveedor de Playwright: sin ellos `cdp()` no tiene `send`.
import type {} from "@vitest/browser-playwright";
import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { formatearImporte } from "../formato-fiscal";
import {
  comprobanteDePrueba,
  esperarLasHojas,
  QR_DE_PRUEBA,
  type OpcionesDelComprobante,
} from "./ayudas-de-impresion";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";
import { ALTO_A4_MM, ANCHO_A4_MM, mmAPx } from "./geometria";
import type { ComprobanteParaLaHoja } from "./modelo-de-la-hoja";

/**
 * La hoja A4 en Chromium real: cada hoja de 210 x 297 mm exactos, sin nada que se salga de su alto, con el pie (y el QR) enteros, «Hoja
 * k de n» con el n real, «A transportar» solo en las que no son la última y el bloque final solo en la última. También con descripciones de
 * 200 caracteres, con una tipografía de reemplazo más ancha y con una vista previa de 360 px. No se prueba `window.print`: ver el informe.
 */

const centavosDe = (importe: string): bigint => BigInt(importe.replace(".", ""));
const aTexto = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

/** Una tipografía de reemplazo más ancha que la del sistema: DejaVu Sans, con las letras además separadas, haya o no esa fuente instalada. */
const FUENTE_ANCHA = `[data-hoja], [data-hoja] *, [data-medidor], [data-medidor] * { font-family: "DejaVu Sans", Verdana, sans-serif !important; letter-spacing: 0.04em !important; }`;

function conEstilo(css: string): () => void {
  const estilo = document.createElement("style");
  estilo.textContent = css;
  document.head.append(estilo);
  return () => estilo.remove();
}

const pieDe = (hoja: HTMLElement): HTMLElement => {
  const pie = hoja.querySelector<HTMLElement>("[data-pie]");
  if (pie === null) throw new Error("la hoja no tiene pie");
  return pie;
};

/** Lo que tiene que cumplir CADA hoja, con el reparto que haya hecho el paginador. */
function verificarLasHojas(hojas: readonly HTMLElement[], c: ComprobanteParaLaHoja): void {
  const n = hojas.length;
  const importes = c.renglones.map((r) => centavosDe(r.importe));
  let dibujados = 0;
  hojas.forEach((hoja, i) => {
    const etiqueta = `hoja ${i + 1} de ${n}`;
    // El papel: 210 x 297 mm exactos y nada que se pase de su alto.
    expect(Math.abs(hoja.offsetWidth - mmAPx(ANCHO_A4_MM)), etiqueta).toBeLessThanOrEqual(1);
    expect(Math.abs(hoja.offsetHeight - mmAPx(ALTO_A4_MM)), etiqueta).toBeLessThanOrEqual(1);
    expect(hoja.scrollHeight, `${etiqueta}: scrollHeight`).toBeLessThanOrEqual(hoja.clientHeight);
    expect(hoja.scrollWidth, `${etiqueta}: scrollWidth`).toBeLessThanOrEqual(hoja.clientWidth);
    // El pie y el QR, enteros dentro de la hoja y del pie; la tabla termina antes del pie.
    const pie = pieDe(hoja);
    const rHoja = hoja.getBoundingClientRect();
    const rPie = pie.getBoundingClientRect();
    expect(rPie.top, etiqueta).toBeGreaterThanOrEqual(rHoja.top - 0.5);
    expect(rPie.bottom, etiqueta).toBeLessThanOrEqual(rHoja.bottom + 0.5);
    expect(pie.scrollHeight, `${etiqueta}: el contenido del pie`).toBeLessThanOrEqual(
      pie.clientHeight + 1,
    );
    const qr = pie.querySelector("img[data-qr]");
    expect(qr, etiqueta).not.toBeNull();
    const rQr = (qr as Element).getBoundingClientRect();
    expect(rQr.top).toBeGreaterThanOrEqual(rPie.top - 0.5);
    expect(rQr.bottom).toBeLessThanOrEqual(rPie.bottom + 0.5);
    expect(rQr.right).toBeLessThanOrEqual(rPie.right + 0.5);
    const tabla = hoja.querySelector("table");
    expect(tabla?.getBoundingClientRect().bottom, etiqueta).toBeLessThanOrEqual(rPie.top + 0.5);
    // CAE y vencimiento en el pie de TODAS las hojas, y «Hoja k de n» con el n real.
    expect(pie.textContent).toContain("70417054367476 · vence 23/10/2026");
    expect(pie.textContent).toContain(`Hoja ${i + 1} de ${n}`);
    // «A transportar» solo en las que no son la última; el bloque final (Total) solo en la última.
    const aTransportar = pie.querySelector("[data-a-transportar]");
    const ultima = i === n - 1;
    expect(aTransportar === null, `${etiqueta}: A transportar`).toBe(ultima);
    expect(pie.textContent?.includes("Total") ?? false, `${etiqueta}: bloque final`).toBe(ultima);
    // Las filas de la hoja y los parciales exactos.
    const filas = hoja.querySelectorAll("tbody tr[data-fila]").length;
    const primera = hoja.querySelector("tbody tr");
    if (i === 0) {
      expect(primera?.hasAttribute("data-transporte"), etiqueta).toBe(false);
    } else {
      expect(primera?.hasAttribute("data-transporte"), etiqueta).toBe(true);
      expect(primera?.textContent).toContain("Transporte");
      expect(primera?.textContent).toContain(
        formatearImporte(aTexto(importes.slice(0, dibujados).reduce((a, x) => a + x, 0n))),
      );
    }
    dibujados += filas;
    if (aTransportar !== null) {
      expect(aTransportar.textContent).toContain("A transportar");
      expect(aTransportar.textContent).toContain(
        formatearImporte(aTexto(importes.slice(0, dibujados).reduce((a, x) => a + x, 0n))),
      );
    }
  });
  // Ni un renglón de menos ni uno repetido, y la suma final es el total del modelo.
  expect(dibujados).toBe(c.renglones.length);
  expect(aTexto(importes.reduce((a, x) => a + x, 0n))).toBe(c.totales.total);
}

type Ancho = number | "completo";

async function dibujar(opciones: OpcionesDelComprobante, ancho: Ancho = "completo") {
  const comprobante = comprobanteDePrueba(opciones);
  const pantalla = await render(
    <div style={ancho === "completo" ? undefined : { width: ancho }} data-contenedor="">
      <ComprobanteImpreso comprobante={comprobante} qrSvg={QR_DE_PRUEBA} formato="A4" />
    </div>,
  );
  const hojas = await esperarLasHojas();
  return { comprobante, hojas, pantalla };
}

describe("hoja A4: el reparto en hojas con 8, 26 y 60 renglones", () => {
  it.each([
    [8, false, 1],
    [8, true, 1],
    [26, false, 1],
    [26, true, 2],
    [60, false, 3],
    [60, true, 4],
  ] as const)("%i renglones, descripciones largas: %s", async (renglones, largas, minimo) => {
    const { comprobante, hojas } = await dibujar({ renglones, descripcionesLargas: largas });
    expect(hojas.length).toBeGreaterThanOrEqual(minimo);
    if (renglones === 8 && !largas) expect(hojas).toHaveLength(1);
    verificarLasHojas(hojas, comprobante);
  });

  it("con una tipografía de reemplazo más ancha, en una vista previa de 360 px", async () => {
    const quitar = conEstilo(FUENTE_ANCHA);
    try {
      for (const renglones of [8, 26, 60]) {
        const { comprobante, hojas, pantalla } = await dibujar(
          { renglones, descripcionesLargas: true },
          360,
        );
        verificarLasHojas(hojas, comprobante);
        await pantalla.unmount();
      }
    } finally {
      quitar();
    }
  });

  it("vuelve a medir si cambia la tipografía: más ancha, más hojas, y siguen entrando", async () => {
    const { comprobante, hojas } = await dibujar({ renglones: 60, descripcionesLargas: true });
    const antes = hojas.length;
    verificarLasHojas(hojas, comprobante);
    const quitar = conEstilo(FUENTE_ANCHA.replace("0.04em", "0.12em"));
    try {
      await expect
        .poll(() => document.querySelectorAll("[data-hoja]").length, { timeout: 5000 })
        .toBeGreaterThan(antes);
      verificarLasHojas(await esperarLasHojas(), comprobante);
    } finally {
      quitar();
    }
  });

  it("el A4 de 210 mm se ve entero en una vista previa de 360 px: sin corte a la derecha ni hueco debajo", async () => {
    const { hojas, pantalla } = await dibujar({ renglones: 60 }, 360);
    const marco = document.querySelector<HTMLElement>("[data-vista-previa]");
    const contenido = marco?.querySelector<HTMLElement>("[data-escala]");
    if (marco === null || marco === undefined || contenido === null || contenido === undefined) {
      throw new Error("no hay vista previa");
    }
    const escala = Number(contenido.dataset["escala"]);
    expect(escala).toBeLessThan(0.5);
    const rMarco = marco.getBoundingClientRect();
    expect(rMarco.width).toBeLessThanOrEqual(360 + 0.5);
    for (const hoja of hojas) {
      const r = hoja.getBoundingClientRect();
      expect(r.right).toBeLessThanOrEqual(rMarco.right + 0.5);
      expect(r.left).toBeGreaterThanOrEqual(rMarco.left - 0.5);
      expect(r.width).toBeCloseTo(mmAPx(ANCHO_A4_MM) * escala, 0);
    }
    // El marco mide el alto escalado de todas las hojas: ni recortado ni con hueco.
    const ultima = hojas.at(-1)?.getBoundingClientRect();
    expect(Math.abs((ultima?.bottom ?? 0) - rMarco.bottom)).toBeLessThanOrEqual(1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await pantalla.unmount();
  });

  it("con lugar de sobra no se achica ni se agranda: escala 1", async () => {
    const { pantalla } = await dibujar({ renglones: 8 }, 1200);
    const contenido = document.querySelector<HTMLElement>("[data-escala]");
    expect(contenido?.dataset["escala"]).toBe("1");
    await pantalla.unmount();
  });
});

describe("hoja A4: lo que dibuja según el comprobante", () => {
  const textoDe = (hoja: HTMLElement | undefined): string => hoja?.textContent ?? "";

  it("factura B a consumidor final: transparencia fiscal solo en la hoja final, abajo a la izquierda", async () => {
    const { hojas } = await dibujar({ letra: "B", renglones: 60 });
    expect(hojas.length).toBeGreaterThan(1);
    hojas.forEach((hoja, i) => {
      const bloque = hoja.querySelector("[data-transparencia]");
      expect(bloque === null).toBe(i !== hojas.length - 1);
    });
    const bloque = hojas.at(-1)?.querySelector("[data-transparencia]");
    expect(bloque?.textContent).toContain(
      "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)",
    );
    expect(bloque?.textContent).toContain("IVA Contenido 21 %");
    expect(bloque?.textContent).toContain("Otros Impuestos Nacionales Indirectos");
    expect(textoDe(hojas[0])).toContain("A CONSUMIDOR FINAL");
    expect(textoDe(hojas[0])).toContain("COD. 006");
    expect(textoDe(hojas[0])).toContain("Precio con IVA");
  });

  it("factura A: neto gravado por alícuota con su IVA y el cliente identificado", async () => {
    const { hojas } = await dibujar({ letra: "A", renglones: 8 });
    const ultima = textoDe(hojas.at(-1));
    expect(ultima).toContain("Neto gravado 21 %");
    expect(ultima).toContain("IVA 21 %");
    expect(hojas.at(-1)?.querySelector("[data-transparencia]")).toBeNull();
    expect(textoDe(hojas[0])).toContain("Distribuidora Sur SA");
    expect(textoDe(hojas[0])).toContain("CUIT 30-71234567-8");
    expect(textoDe(hojas[0])).toContain("COD. 001");
  });

  it("factura C: sin bloque de transparencia, sin columna de IVA y con «Precio»", async () => {
    const { hojas } = await dibujar({ letra: "C", renglones: 8 });
    expect(hojas[0]?.querySelector("[data-transparencia]")).toBeNull();
    const encabezados = [...(hojas[0]?.querySelectorAll("thead th") ?? [])].map(
      (th) => th.textContent,
    );
    expect(encabezados).toEqual(["Descripción", "Cantidad", "Precio", "Importe"]);
    expect(textoDe(hojas[0])).toContain("COD. 011");
  });

  it("nota de crédito: su rótulo y el comprobante al que corresponde", async () => {
    const { hojas } = await dibujar({ letra: "B", notaDeCredito: true, renglones: 8 });
    expect(textoDe(hojas[0])).toContain("NOTA DE CRÉDITO");
    expect(textoDe(hojas[0])).toContain("Corresponde a FACTURA B 00001-00000007 del 01/10/2026");
  });

  it("homologación: la leyenda en cada hoja; en producción, ninguna", async () => {
    const pruebas = await dibujar({
      leyendas: ["HOMOLOGACIÓN — SIN VALIDEZ FISCAL", "OTRA LEYENDA DEL MODELO"],
      renglones: 60,
    });
    expect(pruebas.hojas.length).toBeGreaterThan(1);
    for (const hoja of pruebas.hojas) {
      expect(textoDe(hoja)).toContain("HOMOLOGACIÓN — SIN VALIDEZ FISCAL");
      expect(textoDe(hoja)).toContain("OTRA LEYENDA DEL MODELO");
    }
    await pruebas.pantalla.unmount();
    const produccion = await dibujar({ renglones: 8 });
    expect(textoDe(produccion.hojas[0])).not.toContain("HOMOLOGACIÓN");
  });

  it("contacto: los datos que existen, sueltos y separados por « · »; sin contacto no hay línea", async () => {
    const con = await dibujar({ contacto: true, renglones: 8 });
    expect(textoDe(con.hojas[0])).toContain("011 5555-0100 · hola@zulu.example · www.zulu.example");
    await con.pantalla.unmount();
    const sin = await dibujar({ renglones: 8 });
    expect(textoDe(sin.hojas[0])).not.toContain("hola@zulu.example");
  });

  it("no dibuja Entrada, Salida ni referencias", async () => {
    const { hojas } = await dibujar({ renglones: 8 });
    expect(textoDe(hojas[0])).not.toMatch(/Entrada|Salida|Estad[ií]a|Referencia/);
  });
});

describe("hoja A4: accesibilidad, @page e impresión", () => {
  it("axe sin violaciones con varias hojas", async () => {
    const { pantalla } = await dibujar({ renglones: 60 });
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await pantalla.unmount();
  });

  it("el <style> de @page es del A4 mientras la vista está montada y se quita al desmontarla", async () => {
    const { pantalla } = await dibujar({ renglones: 8 });
    const estilos = [...document.querySelectorAll("style[data-estilo-de-pagina]")];
    expect(estilos).toHaveLength(1);
    expect(estilos[0]?.textContent).toContain("@page{size:A4;margin:0}");
    await pantalla.unmount();
    expect(document.querySelectorAll("style[data-estilo-de-pagina]")).toHaveLength(0);
  });

  it("al imprimir: sin escala, sin separación entre hojas y solo la hoja a la vista", async () => {
    const comprobante = comprobanteDePrueba({ renglones: 60 });
    await render(
      <div>
        <nav data-ajeno="">Menú de la aplicación</nav>
        <ComprobanteImpreso comprobante={comprobante} qrSvg={QR_DE_PRUEBA} formato="A4" />
      </div>,
    );
    const hojas = await esperarLasHojas();
    expect(hojas.length).toBeGreaterThan(1);
    const sesion = cdp();
    await sesion.send("Emulation.setEmulatedMedia", { media: "print" });
    try {
      const contenido = document.querySelector<HTMLElement>("[data-escala]");
      expect(getComputedStyle(contenido as Element).transform).toBe("none");
      const [primera, segunda] = hojas.map((h) => h.getBoundingClientRect());
      expect(Math.abs((segunda?.top ?? 0) - (primera?.bottom ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((primera?.width ?? 0) - mmAPx(ANCHO_A4_MM))).toBeLessThanOrEqual(1);
      expect(getComputedStyle(document.querySelector("[data-ajeno]") as Element).display).toBe(
        "none",
      );
      expect(getComputedStyle(hojas[0] as Element).display).not.toBe("none");
      expect(getComputedStyle(document.querySelector("[data-medidor]") as Element).display).toBe(
        "none",
      );
    } finally {
      await sesion.send("Emulation.setEmulatedMedia", { media: "" });
    }
  });
});
