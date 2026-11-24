import { describe, expect, it } from "vitest";
import {
  CODIGOS_PUBLICOS,
  errorDeCodigo,
  errorPublicoDe,
  clasificarError,
} from "../../src/capacidades/experiencia/respuesta";
import {
  CLAVES_DE_ERRORES_DE_USUARIOS,
  type CodigoDeUsuarios,
} from "../../src/capacidades/experiencia/respuesta-de-usuarios";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";

/**
 * Los códigos públicos de «Usuarios»: todo código de la familia está en la tabla única con su texto, y el de la lista es el genérico aprobado, sin distinguir la causa.
 * Que TODO error de las dos consultas tenga código se prueba en `src/composicion/errores-de-usuarios.test.ts`.
 */
describe("códigos públicos de «Usuarios»", () => {
  it("cada código de la familia está en la tabla única, con su clave y su texto", () => {
    for (const [codigo, clave] of Object.entries(CLAVES_DE_ERRORES_DE_USUARIOS)) {
      expect(CODIGOS_PUBLICOS).toHaveProperty(codigo);
      expect(CODIGOS_PUBLICOS[codigo as CodigoDeUsuarios].clave).toBe(clave);
      expect(texto({}, clave).length).toBeGreaterThan(0);
    }
  });

  it("USUARIOS_NO_PERMITIDO dice «Esta acción no está permitida» como aviso, sin código HTTP de sesión", () => {
    const e = errorDeCodigo("USUARIOS_NO_PERMITIDO");
    expect(e).toEqual({
      codigo: "USUARIOS_NO_PERMITIDO",
      clave: "usuarios.error.accion_no_permitida",
      presentacion: "AVISO",
    });
    expect(texto({}, e.clave)).toBe("Esta acción no está permitida");
  });

  it("el traductor único reconoce el código del módulo y no lo vuelve un fallo inesperado", () => {
    const clasificado = clasificarError({ codigo: "USUARIOS_NO_PERMITIDO" });
    expect(clasificado.tipo).toBe("PUBLICO");
    if (clasificado.tipo === "PUBLICO") {
      expect(errorPublicoDe(clasificado).codigo).toBe("USUARIOS_NO_PERMITIDO");
    }
  });
});
