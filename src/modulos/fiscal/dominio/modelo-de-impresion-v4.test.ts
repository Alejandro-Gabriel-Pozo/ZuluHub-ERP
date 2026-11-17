import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  facturaArmada,
  imprimibleDe as imprimible,
  renglon,
} from "../../../../test/utilidades/facturacion";
import {
  modeloDeImpresion,
  VERSION_DE_REPRESENTACION_ACTUAL,
  type ComprobanteParaImprimir,
  type MarcaParaImprimir,
  type ModeloImpreso,
} from "./modelo-de-impresion";
import { PRIMERA_VERSION_CON_UNIDAD, unidadSegunLaVersion } from "./versiones-de-representacion";

/**
 * Versión de representación 4 (E1 §3.2): el renglón imprime la unidad («1,250 kg») cuando el comprobante guardó una. Las versiones 1 a 3
 * reimprimen idéntico aunque el renglón guardado tenga unidad (lo sellado no cambia). Previene: que subir la versión cambie lo que ya se
 * imprimió, o que la unidad base («u») aparezca en la hoja.
 */

const MARCA: MarcaParaImprimir = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "https://ejemplo.test/zulu.png",
  colorPrincipal: "#8b4513",
};

const modelo = (c: ComprobanteParaImprimir): ModeloImpreso => {
  const r = modeloDeImpresion(c, MARCA);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

/** 1,250 kg de pan a 400,00 (500,00) y una medialuna sin unidad (121,00): lo que arma ventas para un peso y para la unidad base. */
const conUnidad = (unidad: string | null) => [
  { ...renglon("400.00", "1.2500", "21", null, "Pan de campo"), unidad },
  renglon("121.00", "1", "21", null, "Medialuna"),
];
const comprobante = (unidad: string | null, version: number): ComprobanteParaImprimir =>
  imprimible(facturaArmada(consumidorFinal, conUnidad(unidad)), {
    versionDeRepresentacion: version,
  });

describe("modelo de impresión v4: la unidad del renglón", () => {
  it("es la versión actual y la primera con unidad", () => {
    expect(VERSION_DE_REPRESENTACION_ACTUAL).toBe(PRIMERA_VERSION_CON_UNIDAD);
    expect(PRIMERA_VERSION_CON_UNIDAD).toBe(4);
  });

  it("golden: el renglón de peso lleva «kg» y el de unidad base no lleva ninguna", async () => {
    const m = modelo(comprobante("kg", 4));
    expect(m.versionDeRepresentacion).toBe(4);
    expect(m.renglones[0]).toMatchObject({ cantidad: "1.2500", unidad: "kg" });
    expect(Object.hasOwn(m.renglones[1] ?? {}, "unidad")).toBe(false);
    await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-v4-factura-b-con-unidad.golden.txt",
    );
  });

  it("golden: sin ninguna unidad guardada, la hoja sale como la de la versión 3 (sin «u»)", async () => {
    const m = modelo(comprobante(null, 4));
    expect(m.renglones.every((r) => !Object.hasOwn(r, "unidad"))).toBe(true);
    await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-v4-factura-b-sin-unidad.golden.txt",
    );
  });

  it("v4 es la v3 más la unidad, y nada más (el QR, los totales y los textos no cambian)", () => {
    const v4 = modelo(comprobante("kg", 4));
    const v3 = modelo(comprobante("kg", 3));
    const sinUnidad = {
      ...v4,
      versionDeRepresentacion: 3,
      renglones: v4.renglones.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => k !== "unidad")),
      ),
    };
    expect(sinUnidad).toEqual(v3);
    expect(v4.qr).toEqual(v3.qr);
    expect(v4.totales).toEqual(v3.totales);
  });

  it("las versiones 1 a 3 reimprimen idéntico aunque el renglón guardado tenga unidad", () => {
    for (const version of [1, 2, 3]) {
      const guardadoConUnidad = modelo(comprobante("kg", version));
      const guardadoSinUnidad = modelo(comprobante(null, version));
      expect(JSON.stringify(guardadoConUnidad), `versión ${version}`).toBe(
        JSON.stringify(guardadoSinUnidad),
      );
      expect(guardadoConUnidad.renglones.some((r) => Object.hasOwn(r, "unidad"))).toBe(false);
    }
  });
});

describe("unidadSegunLaVersion", () => {
  it("solo da la unidad desde la versión 4 y cuando hay", () => {
    expect(unidadSegunLaVersion(4, "kg")).toEqual({ unidad: "kg" });
    expect(unidadSegunLaVersion(5, "ml")).toEqual({ unidad: "ml" });
    expect(unidadSegunLaVersion(4, null)).toEqual({});
    for (const version of [0, 1, 2, 3]) expect(unidadSegunLaVersion(version, "kg")).toEqual({});
  });
});
