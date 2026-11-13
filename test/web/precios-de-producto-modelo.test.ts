import { describe, expect, it } from "vitest";
import { errorDeCodigo, type ErrorPublico } from "../../src/capacidades/experiencia/respuesta";
import {
  armarLosPrecios,
  rutaDeLosPrecios,
  textoDelError,
  valorInicialDelCampo,
  type PreciosDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-precios-de-producto";

/**
 * El modelo de vista de los precios de un producto (A1, T3): lo que se ve, en el orden de la maqueta `productos.html`, con los textos del catálogo. Importes como texto decimal: nunca
 * pasan por `Number`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const PANTALLA: PreciosDeLaPantalla = {
  id: ID,
  nombre: "Hamburguesa Funghi",
  tipo: "DE_LA_EMPRESA",
  vigente: { precioId: "p2", importe: "13000.000000", desde: "2026-11-02" },
  historial: [{ importe: "11500.000000", desde: "2026-10-15" }],
  claveDelCambio: "clave",
};

describe("rutaDeLosPrecios", () => {
  it("cuelga de la ficha del producto", () => {
    expect(rutaDeLosPrecios(ID)).toBe(`/catalogo/productos/${ID}/precios`);
  });
});

describe("armarLosPrecios", () => {
  it("arma el precio, la vigencia y el historial con los textos de la maqueta", () => {
    expect(armarLosPrecios(PANTALLA)).toEqual({
      id: ID,
      titulo: "Hamburguesa Funghi",
      segunMedida: null,
      campo: { etiqueta: "Precio (IVA incluido)", valorInicial: "13000.00" },
      vigencia: "Vigente desde 02/11/2026",
      historial: {
        titulo: "Historial",
        filas: [{ precio: "$ 11.500,00", desde: "15/10/2026" }],
      },
      guardar: "Guardar",
    });
  });

  it("sin anteriores no hay sección de historial", () => {
    expect(armarLosPrecios({ ...PANTALLA, historial: [] }).historial).toBeNull();
  });

  it("sin precio, o con un precio abierto vigente: «Precio abierto» y el campo vacío", () => {
    for (const vigente of [null, { precioId: "p", importe: null, desde: "2026-11-02" }]) {
      const armado = armarLosPrecios({ ...PANTALLA, vigente });
      expect(armado.vigencia).toBe("Precio abierto");
      expect(armado.campo.valorInicial).toBe("");
    }
  });

  it("un precio abierto en el historial se dice «Precio abierto»", () => {
    const armado = armarLosPrecios({
      ...PANTALLA,
      historial: [
        { importe: null, desde: "2026-10-20" },
        { importe: "11500.000000", desde: "2026-10-15" },
      ],
    });
    expect(armado.historial?.filas).toEqual([
      { precio: "Precio abierto", desde: "20/10/2026" },
      { precio: "$ 11.500,00", desde: "15/10/2026" },
    ]);
  });

  it("el historial conserva el orden que trae y los centavos exactos, sin pasar por Number", () => {
    const armado = armarLosPrecios({
      ...PANTALLA,
      historial: [
        { importe: "123456789012.340000", desde: "2026-10-20" },
        { importe: "0.050000", desde: "2026-10-15" },
      ],
    });
    expect(armado.historial?.filas.map((f) => f.precio)).toEqual([
      "$ 123.456.789.012,34",
      "$ 0,05",
    ]);
  });

  it("con variante activa dice «Según medida»", () => {
    expect(armarLosPrecios({ ...PANTALLA, tipo: "SEGUN_MEDIDA" }).segunMedida).toBe("Según medida");
  });

  it("un diccionario de la marca cambia la redacción, no la estructura", () => {
    const armado = armarLosPrecios(PANTALLA, { "catalogo.precio.historial": "Antes" });
    expect(armado.historial?.titulo).toBe("Antes");
  });
});

describe("valorInicialDelCampo", () => {
  it.each([
    ["13000.000000", "13000.00"],
    ["13000.500000", "13000.50"],
    ["13000.250000", "13000.25"],
    ["0.050000", "0.05"],
    ["0.000000", "0.00"],
    ["13000", "13000.00"],
    ["13000.", "13000.00"],
    ["999999999999.990000", "999999999999.99"],
  ])("%s se muestra como %s", (importe, campo) => {
    expect(valorInicialDelCampo(importe)).toBe(campo);
  });

  it.each(["28333.333333", "13000.001", "0.000001", "10.100001"])(
    "%s tiene más decimales que el campo: el campo sale vacío (no se recorta)",
    (importe) => {
      expect(valorInicialDelCampo(importe)).toBe("");
    },
  );

  it.each([null, "", "abc", "-5.00", "1,5", "1e3", ".5"])("%s: vacío", (importe) => {
    expect(valorInicialDelCampo(importe)).toBe("");
  });
});

describe("textoDelError", () => {
  const error = (cambios: Partial<ErrorPublico>): ErrorPublico => ({
    ...errorDeCodigo("CATALOGO_PRECIO_INVALIDO"),
    ...cambios,
  });

  it("«Escribí un precio válido» sale tal cual", () => {
    expect(textoDelError(error({}))).toBe("Escribí un precio válido");
  });

  it("la frase del precio cambiado lleva el importe vigente formateado, con un solo «$»", () => {
    const e = error({
      ...errorDeCodigo("CATALOGO_PRECIO_DESACTUALIZADO"),
      parametros: { importe: "13000.000000" },
    });
    expect(textoDelError(e)).toBe(
      "El precio vigente ahora es $ 13.000,00. Revisalo y volvé a intentar.",
    );
  });

  it("un error del guard sale con su texto", () => {
    expect(textoDelError(errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"))).toBe(
      "Esta acción no está permitida",
    );
  });
});
