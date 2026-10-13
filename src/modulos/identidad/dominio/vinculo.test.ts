import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  personaId,
  usuarioAuthId,
  type UsuarioAuthId,
} from "../../../primitivas/identificadores/marca";
import "../../../../test/propiedades/configuracion";
import { emailDesdeTexto } from "../../../primitivas/contacto/email";
import type { PersonaConUsuario } from "./membresia";
import { decidirVinculo } from "./vinculo";

const EMAIL = (() => {
  const r = emailDesdeTexto("ana@prueba.test");
  if (!r.ok) throw new Error("email de prueba inválido");
  return r.valor;
})();
const ANA = usuarioAuthId("11111111-1111-4111-8111-111111111111");
const OTRO = usuarioAuthId("22222222-2222-4222-8222-222222222222");

const persona = (usuarioAuth: UsuarioAuthId | null, activoGlobal = true): PersonaConUsuario => ({
  id: personaId("p-1"),
  email: EMAIL,
  activoGlobal,
  usuarioAuth,
});

describe("decidirVinculo: qué hacer con el vínculo persona <-> usuario al aceptar una invitación", () => {
  it("sin persona todavía (se va a crear) hay que vincular", () => {
    expect(decidirVinculo(null, ANA)).toEqual({ ok: true, valor: "VINCULAR" });
  });

  it("una persona sin usuario se vincula con el que acepta", () => {
    expect(decidirVinculo(persona(null), ANA)).toEqual({ ok: true, valor: "VINCULAR" });
  });

  it("una persona ya vinculada con ESTE usuario: ya está, no se escribe (idempotente)", () => {
    expect(decidirVinculo(persona(ANA), ANA)).toEqual({ ok: true, valor: "YA_VINCULADA" });
  });

  it("una persona vinculada con OTRO usuario se rechaza: el vínculo nunca se pisa", () => {
    expect(decidirVinculo(persona(OTRO), ANA)).toEqual({
      ok: false,
      error: "PERSONA_DE_OTRO_USUARIO",
    });
  });

  it("la suspensión de la persona no es asunto del vínculo (la decide la aceptación, antes)", () => {
    expect(decidirVinculo(persona(null, false), ANA)).toEqual({ ok: true, valor: "VINCULAR" });
    expect(decidirVinculo(persona(OTRO, false), ANA)).toEqual({
      ok: false,
      error: "PERSONA_DE_OTRO_USUARIO",
    });
  });

  it("propiedad: rechaza exactamente cuando hay un usuario vinculado y es distinto; si no, ok", () => {
    const usuario = fc.uuid().map((u) => usuarioAuthId(u));
    fc.assert(
      fc.property(fc.option(usuario, { nil: null }), usuario, (vinculado, quien) => {
        const r = decidirVinculo(persona(vinculado), quien);
        if (vinculado === null) expect(r).toEqual({ ok: true, valor: "VINCULAR" });
        else if (vinculado === quien) expect(r).toEqual({ ok: true, valor: "YA_VINCULADA" });
        else expect(r).toEqual({ ok: false, error: "PERSONA_DE_OTRO_USUARIO" });
      }),
    );
  });
});
