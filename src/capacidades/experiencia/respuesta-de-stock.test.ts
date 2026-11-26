import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_STOCK } from "./respuesta-de-stock";

/**
 * Los códigos públicos de stock: cada uno con SU texto del catálogo (aprobado en la maqueta `stock.html`, fila «Errores y avisos», 09/11/2026, y, para los tres de gestión de depósitos, por el dueño el 25/11/2026, DEC-1018) y mostrado como un aviso.
 * Previene: que un código de stock salga con el texto de otro, sin texto o con un texto que cambió sin que nadie lo apruebe.
 */
describe("códigos públicos de stock", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_STOCK).toEqual({
      STOCK_CONTROL_AVISA: "stock.error.control_avisa",
      STOCK_YA_HAY_EXISTENCIA: "stock.carga.ya_hay_existencia",
      STOCK_TRANSFERENCIA_AL_MISMO_DEPOSITO: "stock.error.transferencia_al_mismo_deposito",
      STOCK_DETALLE_REQUERIDO: "stock.error.detalle_requerido",
      STOCK_CANTIDAD_INVALIDA: "stock.error.cantidad_invalida",
      STOCK_CONTEO_EN_CURSO: "stock.error.conteo_en_curso",
      STOCK_NOMBRE_DUPLICADO: "stock.error.nombre_duplicado",
      STOCK_DEPOSITO_CON_EXISTENCIA: "stock.error.deposito_con_existencia",
      STOCK_ES_EL_DE_VENTA: "stock.error.es_el_de_venta",
      STOCK_DEPOSITO_DESACTUALIZADO: "stock.error.deposito_desactualizado",
      STOCK_ACCION_NO_PERMITIDA: "stock.error.sin_permiso",
    });
    const textos = {
      "stock.error.control_avisa": "Va a quedar en negativo. ¿Confirmás?",
      "stock.error.transferencia_al_mismo_deposito":
        "El origen y el destino no pueden ser el mismo",
      "stock.error.detalle_requerido": "Escribí el detalle",
      "stock.error.cantidad_invalida": "La cantidad tiene que ser mayor que cero",
      "stock.error.conteo_en_curso": "Ya hay un conteo abierto en este depósito",
      "stock.error.nombre_duplicado": "Ya existe un depósito con ese nombre",
      "stock.error.deposito_con_existencia": "El depósito tiene existencia",
      "stock.error.es_el_de_venta": "No se puede desactivar el depósito de venta",
      "stock.error.deposito_desactualizado":
        "Otra persona modificó este depósito. Actualizá la pantalla",
      "stock.error.sin_permiso": "Esta acción no está permitida",
    } as const;
    for (const [clave, texto] of Object.entries(textos)) {
      expect(CATALOGO_DE_TEXTOS[clave as keyof typeof textos].porDefecto).toBe(texto);
    }
  });

  it.each(Object.entries(CLAVES_DE_ERRORES_DE_STOCK))(
    "%s está en la tabla pública, como aviso de estado 422 y con su clave",
    (codigo, clave) => {
      expect(CODIGOS_PUBLICOS[codigo as keyof typeof CLAVES_DE_ERRORES_DE_STOCK]).toEqual({
        clave,
        presentacion: "AVISO",
        estadoHttp: 422,
      });
      expect(errorDeCodigo(codigo as keyof typeof CLAVES_DE_ERRORES_DE_STOCK)).toEqual({
        codigo,
        clave,
        presentacion: "AVISO",
      });
    },
  );
});
