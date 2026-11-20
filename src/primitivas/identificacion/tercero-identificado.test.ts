import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { nombreODenominacionDesdeTexto } from "../texto/nombre-o-razon-social";
import { terceroDesdeEntrada } from "./tercero-identificado";

const UUID = "0b6e1c1a-2f6c-4f5a-9d41-5b1d6c7a8e90";

describe("terceroDesdeEntrada", () => {
  it("devuelve el nombre normalizado", () => {
    expect(terceroDesdeEntrada({ nombre: "  Juan   Pérez " })).toEqual({
      ok: true,
      valor: { tipo: "NOMBRE", nombre: "Juan Pérez" },
    });
  });

  it.each([
    "12345678",
    "30-71234567-1",
    "<b>Juan</b>",
    "Juan​Pérez",
    "Juan\nPérez",
    "a".repeat(201),
  ])("rechaza el nombre %j", (nombre) => {
    expect(terceroDesdeEntrada({ nombre })).toEqual({ ok: false, error: "TERCERO_INVALIDO" });
  });

  it("acepta el largo máximo", () => {
    expect(terceroDesdeEntrada({ nombre: "a".repeat(200) }).ok).toBe(true);
  });

  it.each(["", "   ", "\t\n"])("nombre vacío o solo blancos (%j) = nadie", (nombre) => {
    expect(terceroDesdeEntrada({ nombre })).toEqual({ ok: true, valor: null });
  });

  it("un empleado con uuid válido", () => {
    expect(terceroDesdeEntrada({ personaId: UUID })).toEqual({
      ok: true,
      valor: { tipo: "EMPLEADO", personaId: UUID },
    });
  });

  it.each(["", "no-es-uuid", UUID.toUpperCase(), `${UUID} `])(
    "personaId %j inválido",
    (personaId) => {
      expect(terceroDesdeEntrada({ personaId })).toEqual({ ok: false, error: "TERCERO_INVALIDO" });
    },
  );

  it("nombre y persona a la vez es inválido", () => {
    expect(terceroDesdeEntrada({ nombre: "Juan", personaId: UUID })).toEqual({
      ok: false,
      error: "TERCERO_INVALIDO",
    });
  });

  it("nombre en blanco con persona vale la persona", () => {
    expect(terceroDesdeEntrada({ nombre: "  ", personaId: UUID })).toEqual({
      ok: true,
      valor: { tipo: "EMPLEADO", personaId: UUID },
    });
  });

  it.each([null, {}, { nombre: undefined, personaId: undefined }])(
    "ninguno (%j) = nadie",
    (entrada) => {
      expect(terceroDesdeEntrada(entrada)).toEqual({ ok: true, valor: null });
    },
  );

  it("propiedad: nunca devuelve un nombre que la primitiva del nombre rechazaría", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (texto) => {
        const r = terceroDesdeEntrada({ nombre: texto });
        if (r.ok && r.valor !== null && r.valor.tipo === "NOMBRE") {
          expect(nombreODenominacionDesdeTexto(r.valor.nombre)).toEqual({
            ok: true,
            valor: r.valor.nombre,
          });
        }
        if (!r.ok) expect(texto.trim()).not.toBe("");
      }),
    );
  });
});
