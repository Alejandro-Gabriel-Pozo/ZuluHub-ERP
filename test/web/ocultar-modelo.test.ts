import { describe, expect, it } from "vitest";
import { armarLaVisibilidad } from "../../apps/web/ui/plantillas/catalogo/modelo-de-visibilidad-de-producto";

const TODO = { local: true, empresa: true };

describe("armarLaVisibilidad", () => {
  it("visible en todos lados: «Ocultar» (local) y «Ocultar en toda la empresa», sin aviso", () => {
    expect(armarLaVisibilidad({ local: false, empresa: false }, TODO)).toEqual([
      { alcance: "LOCAL", oculto: false, aviso: null, boton: "Ocultar", puede: true },
      {
        alcance: "EMPRESA",
        oculto: false,
        aviso: null,
        boton: "Ocultar en toda la empresa",
        puede: true,
      },
    ]);
  });

  it("oculto en el local: «Oculto» y «Volver a mostrar»; la empresa sigue como estaba", () => {
    const [local, empresa] = armarLaVisibilidad({ local: true, empresa: false }, TODO);
    expect(local).toEqual({
      alcance: "LOCAL",
      oculto: true,
      aviso: "Oculto",
      boton: "Volver a mostrar",
      puede: true,
    });
    expect(empresa?.aviso).toBeNull();
  });

  it("oculto en toda la empresa: «Oculto en toda la empresa» y «Volver a mostrar»", () => {
    const filas = armarLaVisibilidad({ local: false, empresa: true }, TODO);
    expect(filas[1]).toEqual({
      alcance: "EMPRESA",
      oculto: true,
      aviso: "Oculto en toda la empresa",
      boton: "Volver a mostrar",
      puede: true,
    });
  });

  it("sin local con el que trabajar no hay fila de «este local» (nunca se asume «todas»)", () => {
    const filas = armarLaVisibilidad({ local: null, empresa: false }, TODO);
    expect(filas.map((f) => f.alcance)).toEqual(["EMPRESA"]);
  });

  it("sin permiso el botón sale apagado, no desaparece (el operador no oculta en toda la empresa)", () => {
    const filas = armarLaVisibilidad(
      { local: false, empresa: true },
      { local: true, empresa: false },
    );
    expect(filas.map((f) => f.puede)).toEqual([true, false]);
    expect(
      armarLaVisibilidad({ local: false, empresa: false }, { local: false, empresa: false }).map(
        (f) => f.puede,
      ),
    ).toEqual([false, false]);
  });
});
