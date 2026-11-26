import { describe, expect, it } from "vitest";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import { decidirAsignacionDeRol, type DestinoDeRol } from "./asignacion-de-rol";
import type { Membresia } from "./membresia";

const persona = (rol: Membresia["rol"], rolPropioId: string | null = null): Membresia => ({
  empresaId: empresaId("00000000-0000-4000-8000-000000000001"),
  personaId: personaId("00000000-0000-4000-8000-000000000002"),
  rol,
  rolPropioId,
  activo: true,
  version: 1,
});
const base = (rol: "ADMINISTRADOR" | "OPERADOR"): DestinoDeRol => ({ tipo: "BASE", rol });
const propio: DestinoDeRol = { tipo: "PROPIO", rolId: "r-1" };
const activo = { id: "r-1", activo: true };
const decidir = (
  objetivo: Membresia | null,
  destino: DestinoDeRol,
  rolPropio = null as typeof activo | null,
) => decidirAsignacionDeRol({ objetivo, destino, rolPropio });

describe("decidirAsignacionDeRol", () => {
  it("sin membresía no hay a quién; al gerente no se lo toca, con cualquier destino", () => {
    expect(decidir(null, base("OPERADOR"))).toEqual({
      ok: false,
      error: "MEMBRESIA_NO_ENCONTRADA",
    });
    for (const destino of [base("OPERADOR"), propio]) {
      expect(decidir(persona("GERENTE"), destino)).toEqual({ ok: false, error: "ES_EL_GERENTE" });
    }
  });

  it("a un rol base: otro asigna, el mismo es inocuo (también desde un rol propio)", () => {
    expect(decidir(persona("OPERADOR"), base("ADMINISTRADOR"))).toEqual({
      ok: true,
      valor: "ASIGNAR",
    });
    expect(decidir(persona("OPERADOR"), base("OPERADOR"))).toEqual({
      ok: true,
      valor: "YA_TENIA_ESE_ROL",
    });
    expect(decidir(persona("PROPIO", "r-1"), base("OPERADOR"))).toEqual({
      ok: true,
      valor: "ASIGNAR",
    });
  });

  it("a un rol propio: debe existir y estar activo; el mismo es inocuo, otro asigna; manda el rol de la membresía", () => {
    const op = persona("OPERADOR");
    expect(decidir(op, propio)).toEqual({ ok: false, error: "ROL_NO_ENCONTRADO" });
    expect(decidir(op, propio, { id: "r-1", activo: false })).toEqual({
      ok: false,
      error: "ROL_ARCHIVADO",
    });
    expect(decidir(persona("PROPIO", "r-1"), propio, { id: "r-1", activo: false })).toEqual({
      ok: false,
      error: "ROL_ARCHIVADO",
    });
    expect(decidir(op, propio, activo)).toEqual({ ok: true, valor: "ASIGNAR" });
    expect(decidir(persona("PROPIO", "r-2"), propio, activo)).toEqual({
      ok: true,
      valor: "ASIGNAR",
    });
    expect(decidir(persona("PROPIO", "r-1"), propio, activo)).toEqual({
      ok: true,
      valor: "YA_TENIA_ESE_ROL",
    });
    expect(decidir(persona("OPERADOR", "r-1"), propio, activo)).toEqual({
      ok: true,
      valor: "ASIGNAR",
    });
  });
});
