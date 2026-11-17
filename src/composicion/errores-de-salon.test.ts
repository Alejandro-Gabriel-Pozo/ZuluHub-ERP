import { describe, expect, it } from "vitest";
import { traducirErrorDeSalon } from "./errores-de-salon";

const GENERICO = { codigo: "CATALOGO_ACCION_NO_PERMITIDA" };

describe("traducirErrorDeSalon", () => {
  it("solo cuatro errores tienen texto propio", () => {
    expect(traducirErrorDeSalon("NUMERO_DE_MESA_INVALIDO")).toEqual({
      codigo: "SALON_NUMERO_DE_MESA_INVALIDO",
    });
    expect(traducirErrorDeSalon("NUMERO_DE_MESA_EN_USO")).toEqual({
      codigo: "SALON_NUMERO_DE_MESA_EN_USO",
    });
    expect(traducirErrorDeSalon("MESA_FUERA_DEL_SALON")).toEqual({
      codigo: "SALON_MESA_FUERA_DEL_SALON",
    });
    expect(traducirErrorDeSalon({ error: "MESA_SUPERPUESTA", numeros: [3, 5] })).toEqual({
      codigo: "SALON_MESA_SUPERPUESTA",
      parametros: { numero: "3" },
    });
  });

  it("una superposición sin número válido, o dos altas que se pisaron a la vez, salen con el genérico", () => {
    for (const numeros of [undefined, [], ["3"], [0], [-1], [1.5]]) {
      expect(traducirErrorDeSalon({ error: "MESA_SUPERPUESTA", numeros })).toEqual(GENERICO);
    }
    expect(traducirErrorDeSalon("MESA_SUPERPUESTA_AL_GUARDAR")).toEqual(GENERICO);
  });

  it("lo demás es el genérico; los motivos del guard y el defecto de la base pasan sin cambios", () => {
    for (const e of [
      "VERSION_DESACTUALIZADA",
      "MESA_CON_CUENTA",
      "MESA_NO_ENCONTRADA",
      "FORMA_INVALIDA",
      "toString",
    ]) {
      expect(traducirErrorDeSalon(e)).toEqual(GENERICO);
    }
    expect(traducirErrorDeSalon({ error: "OTRO_NOMBRE" })).toEqual(GENERICO);
    expect(traducirErrorDeSalon("SIN_PERMISO")).toBe("SIN_PERMISO");
    expect(traducirErrorDeSalon("MODULO_EN_DESARROLLO")).toBe("MODULO_EN_DESARROLLO");
    const defecto = { tipo: "RESTRICCION_DESCONOCIDA" };
    expect(traducirErrorDeSalon(defecto)).toBe(defecto);
    expect(traducirErrorDeSalon("ERROR_DE_LA_BASE_NO_TRADUCIDO")).toBe(
      "ERROR_DE_LA_BASE_NO_TRADUCIDO",
    );
  });
});
