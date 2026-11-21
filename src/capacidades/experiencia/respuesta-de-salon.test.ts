import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS, type ClaveDeTexto } from "../vocabulario/catalogo";
import { marcadoresDe } from "../vocabulario/vocabulario";
import { CODIGOS_PUBLICOS, clasificarError, errorDeCodigo, errorPublicoDe } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_SALON, PARAMETROS_DE_SALON } from "./respuesta-de-salon";

/**
 * Los códigos de la pantalla «Mesas»: cada uno con SU texto aprobado (`mesas.html`, 09/11/2026) y mostrado como un aviso; el de la superposición lleva el número de la mesa. Previene: un código del
 * salón con el texto de otro, sin texto, o que salga con el marcador `{numero}` sin reemplazar.
 */
describe("códigos públicos de «Mesas»", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_SALON).toEqual({
      SALON_NUMERO_DE_MESA_INVALIDO: "salon.texto.admin_escribi_un_numero_del_1_al_99",
      SALON_NUMERO_DE_MESA_EN_USO: "salon.texto.admin_ya_existe_una_mesa_con_ese_numero",
      SALON_MESA_FUERA_DEL_SALON: "salon.texto.admin_queda_fuera_del_salon",
      SALON_MESA_SUPERPUESTA: "salon.error.se_superpone_con_la_mesa",
    });
    const texto = (c: ClaveDeTexto) => CATALOGO_DE_TEXTOS[c].porDefecto;
    expect(texto("salon.texto.admin_escribi_un_numero_del_1_al_99")).toBe(
      "Escribí un número del 1 al 99",
    );
    expect(texto("salon.texto.admin_ya_existe_una_mesa_con_ese_numero")).toBe(
      "Ya existe una mesa con ese número",
    );
    expect(texto("salon.texto.admin_queda_fuera_del_salon")).toBe("Queda fuera del salón");
    expect(texto("salon.error.se_superpone_con_la_mesa")).toBe("Se superpone con la mesa {numero}");
  });

  it("todo código está en la tabla pública, como aviso, y los parámetros coinciden con los marcadores del texto", () => {
    for (const [codigo, clave] of Object.entries(CLAVES_DE_ERRORES_DE_SALON)) {
      expect(CODIGOS_PUBLICOS[codigo as keyof typeof CODIGOS_PUBLICOS]).toMatchObject({
        clave,
        presentacion: "AVISO",
      });
      const declarados =
        PARAMETROS_DE_SALON[codigo as keyof typeof CLAVES_DE_ERRORES_DE_SALON] ?? [];
      expect([...marcadoresDe(CATALOGO_DE_TEXTOS[clave].porDefecto)].sort()).toEqual(
        [...declarados].sort(),
      );
    }
  });

  it("la superposición lleva el número; sin él (o con otra cosa) cierra con el genérico, nunca con el marcador", () => {
    const con = clasificarError({ codigo: "SALON_MESA_SUPERPUESTA", parametros: { numero: "3" } });
    expect(con).toMatchObject({ tipo: "PUBLICO", parametros: { numero: "3" } });
    if (con.tipo === "PUBLICO")
      expect(errorPublicoDe(con)).toMatchObject({
        codigo: "SALON_MESA_SUPERPUESTA",
        parametros: { numero: "3" },
      });
    for (const crudo of [
      { codigo: "SALON_MESA_SUPERPUESTA" },
      { codigo: "SALON_MESA_SUPERPUESTA", parametros: { numero: "<b>" } },
      "SALON_MESA_SUPERPUESTA",
    ]) {
      expect(clasificarError(crudo)).toMatchObject({
        tipo: "PUBLICO",
        codigo: "CATALOGO_ACCION_NO_PERMITIDA",
      });
    }
    expect(errorDeCodigo("SALON_MESA_SUPERPUESTA").codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
  });
});
