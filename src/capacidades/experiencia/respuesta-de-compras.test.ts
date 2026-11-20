import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_COMPRAS } from "./respuesta-de-compras";

/**
 * Los códigos públicos de compras N1 y N2: cada uno con SU texto del catálogo (aprobado en `compra.html` y `orden.html`, 09/11/2026) y mostrado como un aviso. Previene:
 * que un código de compras salga con el texto de otro o sin texto.
 */
describe("códigos públicos de compras", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_COMPRAS).toEqual({
      COMPRAS_REMITO_REPETIDO: "compras.error.remito_ya_registrado",
      COMPRAS_FACTURA_REPETIDA: "compras.error.comprobante_ya_registrado",
      COMPRAS_PUNTO_DE_VENTA_NO_DECLARADO: "compras.error.punto_de_venta_no_declarado",
      COMPRAS_CANTIDAD_INVALIDA: "compras.error.cantidad_invalida",
      COMPRAS_PRECIO_INVALIDO: "compras.error.precio_invalido",
      COMPRAS_PROVEEDOR_NO_ENCONTRADO: "compras.error.proveedor_no_encontrado",
      COMPRAS_ACCION_NO_PERMITIDA: "compras.error.sin_permiso",
    });
    const texto = (c: keyof typeof CLAVES_DE_ERRORES_DE_COMPRAS) =>
      CATALOGO_DE_TEXTOS[CLAVES_DE_ERRORES_DE_COMPRAS[c]].porDefecto;
    expect(texto("COMPRAS_REMITO_REPETIDO")).toBe("Ese remito ya está cargado");
    expect(texto("COMPRAS_FACTURA_REPETIDA")).toBe("Esa factura ya está cargada");
    expect(texto("COMPRAS_PUNTO_DE_VENTA_NO_DECLARADO")).toBe("Falta declarar los puntos de venta");
    expect(texto("COMPRAS_CANTIDAD_INVALIDA")).toBe("La cantidad tiene que ser mayor que cero");
    expect(texto("COMPRAS_PRECIO_INVALIDO")).toBe("Escribí un precio válido");
    expect(texto("COMPRAS_PROVEEDOR_NO_ENCONTRADO")).toBe("El proveedor ya no está disponible");
    expect(texto("COMPRAS_ACCION_NO_PERMITIDA")).toBe("Esta acción no está permitida");
  });

  it.each(Object.entries(CLAVES_DE_ERRORES_DE_COMPRAS))(
    "%s está en la tabla pública, como aviso de estado 422 y con su clave",
    (codigo, clave) => {
      const c = codigo as keyof typeof CLAVES_DE_ERRORES_DE_COMPRAS;
      expect(CODIGOS_PUBLICOS[c]).toEqual({ clave, presentacion: "AVISO", estadoHttp: 422 });
      expect(errorDeCodigo(c)).toEqual({ codigo, clave, presentacion: "AVISO" });
    },
  );
});
