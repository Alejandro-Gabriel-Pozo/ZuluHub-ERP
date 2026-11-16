import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_CLIENTES } from "./respuesta-de-clientes";

/**
 * Los códigos públicos del directorio: cada uno con SU texto del catálogo (aprobado en `directorio.html`, 09/11/2026) y mostrado como un aviso. Previene: que un código del
 * directorio salga con el texto de otro o sin texto.
 */
describe("códigos públicos del directorio de clientes y proveedores", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_CLIENTES).toEqual({
      CLIENTES_FALTA_EL_NOMBRE: "clientes.error.falta_el_nombre",
      CLIENTES_CUIT_INVALIDO: "clientes.error.cuit_invalido",
      CLIENTES_DNI_INVALIDO: "clientes.error.dni_invalido",
      CLIENTES_EMPRESA_SOLO_CUIT: "clientes.error.empresa_solo_cuit_o_extranjero",
      CLIENTES_DOCUMENTO_REPETIDO: "clientes.error.documento_ya_registrado",
      CLIENTES_DOCUMENTO_DE_DESACTIVADA: "clientes.error.parte_inactiva_con_ese_documento",
      CLIENTES_EMAIL_INVALIDO: "clientes.error.email_invalido",
      CLIENTES_TELEFONO_INVALIDO: "clientes.error.telefono_invalido",
      CLIENTES_ACCION_NO_PERMITIDA: "clientes.error.sin_permiso",
    });
    const texto = (c: keyof typeof CLAVES_DE_ERRORES_DE_CLIENTES) =>
      CATALOGO_DE_TEXTOS[CLAVES_DE_ERRORES_DE_CLIENTES[c]].porDefecto;
    expect(texto("CLIENTES_FALTA_EL_NOMBRE")).toBe("Falta el nombre");
    expect(texto("CLIENTES_CUIT_INVALIDO")).toBe("El CUIT no es válido");
    expect(texto("CLIENTES_DNI_INVALIDO")).toBe("El DNI no es válido");
    expect(texto("CLIENTES_EMPRESA_SOLO_CUIT")).toBe(
      "Una empresa solo admite CUIT o documento extranjero",
    );
    expect(texto("CLIENTES_DOCUMENTO_REPETIDO")).toBe(
      "Ya existe una persona o empresa con ese documento",
    );
    expect(texto("CLIENTES_DOCUMENTO_DE_DESACTIVADA")).toBe("Ya existe, pero está desactivada");
    expect(texto("CLIENTES_EMAIL_INVALIDO")).toBe("El email no es válido");
    expect(texto("CLIENTES_TELEFONO_INVALIDO")).toBe("El teléfono no es válido");
    expect(texto("CLIENTES_ACCION_NO_PERMITIDA")).toBe("Esta acción no está permitida");
  });

  it.each(Object.entries(CLAVES_DE_ERRORES_DE_CLIENTES))(
    "%s está en la tabla pública, como aviso de estado 422 y con su clave",
    (codigo, clave) => {
      const c = codigo as keyof typeof CLAVES_DE_ERRORES_DE_CLIENTES;
      expect(CODIGOS_PUBLICOS[c]).toEqual({ clave, presentacion: "AVISO", estadoHttp: 422 });
      expect(errorDeCodigo(c)).toEqual({ codigo, clave, presentacion: "AVISO" });
    },
  );
});
