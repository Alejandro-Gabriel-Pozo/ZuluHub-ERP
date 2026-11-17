import { describe, expect, it } from "vitest";
import { CATALOGO_DE_PERILLAS } from "../../../capacidades/planes/perillas";
import { NIVELES_DE_COMPRA, PERILLA_DEL_NIVEL } from "../dominio/niveles";

describe("las perillas de los niveles de compra", () => {
  it("cada nombre es una perilla declarada del módulo compras (configurarCompras lo da por cierto) y N4 requiere N3", () => {
    for (const nivel of NIVELES_DE_COMPRA) {
      const nombre = PERILLA_DEL_NIVEL[nivel];
      if (nombre === null) continue;
      expect(Object.hasOwn(CATALOGO_DE_PERILLAS, nombre), nivel).toBe(true);
      const definicion = (
        CATALOGO_DE_PERILLAS as Record<string, { modulo: string; base: unknown }>
      )[nombre];
      expect(definicion?.modulo).toBe("compras");
      expect(definicion?.base).toEqual({ encendida: false });
    }
    expect(CATALOGO_DE_PERILLAS.conciliacion_de_tres_vias.requiere).toBe("recepcion_separada");
  });
});
