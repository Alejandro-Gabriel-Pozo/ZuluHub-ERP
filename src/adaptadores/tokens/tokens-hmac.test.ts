import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { invitacionId } from "../../primitivas/identificadores/marca";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  ZULUHUB_SECRETO_INVITACIONES,
  crearTokensHmac,
  leerSecretoDeInvitaciones,
} from "./tokens-hmac";

/** U7: el token se deriva del id; el mismo enlace siempre; sin secreto (o con uno corto) no hay adaptador. */

const SECRETO = Buffer.alloc(32, 7);
const ID = invitacionId("0b4e2f3a-1c5d-4e6f-8a9b-0c1d2e3f4a5b");

describe("leerSecretoDeInvitaciones", () => {
  const HEX_64 = "ab".repeat(32);

  it("el nombre de la variable de entorno es el acordado", () => {
    expect(ZULUHUB_SECRETO_INVITACIONES).toBe("ZULUHUB_SECRETO_INVITACIONES");
  });

  it("acepta hexadecimal de 64 dígitos o más (mayúsculas y espacios en los extremos incluidos)", () => {
    expect(leerSecretoDeInvitaciones(HEX_64).length).toBe(32);
    expect(
      leerSecretoDeInvitaciones(`  ${HEX_64.toUpperCase()}\n`).equals(Buffer.from(HEX_64, "hex")),
    ).toBe(true);
    expect(leerSecretoDeInvitaciones("cd".repeat(48)).length).toBe(48);
  });

  it("falla cerrado si falta", () => {
    for (const falta of [undefined, "", "   "]) {
      expect(() => leerSecretoDeInvitaciones(falta)).toThrow(ErrorDeConfiguracion);
      expect(() => leerSecretoDeInvitaciones(falta)).toThrow(/falta/);
    }
  });

  it("falla cerrado si es corto (menos de 32 bytes)", () => {
    expect(() => leerSecretoDeInvitaciones("ab".repeat(31))).toThrow(/al menos 64 dígitos/);
    expect(() => leerSecretoDeInvitaciones("ab".repeat(32).slice(0, 62))).toThrow(
      ErrorDeConfiguracion,
    );
    // Justo en el límite sí pasa.
    expect(() => leerSecretoDeInvitaciones("ab".repeat(32))).not.toThrow();
  });

  it("falla si no es hexadecimal o tiene una cantidad impar de dígitos", () => {
    expect(() => leerSecretoDeInvitaciones("zz".repeat(32))).toThrow(/no es hexadecimal/);
    expect(() => leerSecretoDeInvitaciones(`${HEX_64}a`)).toThrow(/impar/);
  });

  it("el mensaje de error NUNCA incluye el valor recibido", () => {
    for (const valor of ["zz-secreto-que-no-debe-aparecer", "abc", `${HEX_64}f`]) {
      let mensaje = "";
      try {
        leerSecretoDeInvitaciones(valor);
      } catch (e) {
        mensaje = (e as Error).message;
      }
      expect(mensaje).not.toBe("");
      expect(mensaje).not.toContain(valor);
      expect(mensaje).toContain(ZULUHUB_SECRETO_INVITACIONES);
    }
  });
});

describe("crearTokensHmac", () => {
  it("falla cerrado con un secreto ausente o corto", () => {
    expect(() => crearTokensHmac(Buffer.alloc(31, 1))).toThrow(ErrorDeConfiguracion);
    expect(() => crearTokensHmac(Buffer.alloc(0))).toThrow(ErrorDeConfiguracion);
    expect(() => crearTokensHmac(undefined as unknown as Buffer)).toThrow(ErrorDeConfiguracion);
    expect(() => crearTokensHmac("a".repeat(40) as unknown as Buffer)).toThrow(
      ErrorDeConfiguracion,
    );
    expect(() => crearTokensHmac(Buffer.alloc(32, 1))).not.toThrow();
  });

  it("derivar dos veces el mismo id da el mismo token", () => {
    const tokens = crearTokensHmac(SECRETO);
    expect(tokens.derivar(ID)).toBe(tokens.derivar(ID));
    expect(crearTokensHmac(Buffer.from(SECRETO)).derivar(ID)).toBe(tokens.derivar(ID));
  });

  it("ids distintos dan tokens distintos, y secretos distintos también", () => {
    const tokens = crearTokensHmac(SECRETO);
    const otroId = invitacionId("0b4e2f3a-1c5d-4e6f-8a9b-0c1d2e3f4a5c");
    expect(tokens.derivar(otroId)).not.toBe(tokens.derivar(ID));
    expect(crearTokensHmac(Buffer.alloc(32, 8)).derivar(ID)).not.toBe(tokens.derivar(ID));
  });

  it("el token es HMAC-SHA256 en base64url del id con prefijo de dominio (vector fijo)", () => {
    const esperado = createHmac("sha256", SECRETO)
      .update(`invitacion/v1/${ID}`, "utf8")
      .digest("base64url");
    const token = crearTokensHmac(SECRETO).derivar(ID);
    expect(token).toBe(esperado);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Vector fijado a mano: si cambia el formato, todos los enlaces ya enviados dejarían de valer.
    expect(token).toBe("VTzYQASB0q6IEtxguXA-KMOhy6Mw8GqEC9CDHycP5X4");
  });

  it("hash es sha256 en hexadecimal minúscula del token (como lo guarda la base)", () => {
    const tokens = crearTokensHmac(SECRETO);
    const token = tokens.derivar(ID);
    const hash = tokens.hash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(tokens.hash(token + "x")).not.toBe(hash);
    expect(tokens.hash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("emitir devuelve un id, su token derivado y el hash de ese token", () => {
    const tokens = crearTokensHmac(SECRETO, () => ID);
    const emitido = tokens.emitir();
    expect(emitido.invitacionId).toBe(ID);
    expect(emitido.token).toBe(tokens.derivar(ID));
    expect(emitido.tokenHash).toBe(tokens.hash(emitido.token));
  });

  it("emitir con el generador real da ids y tokens distintos cada vez", () => {
    const tokens = crearTokensHmac(SECRETO);
    const a = tokens.emitir();
    const b = tokens.emitir();
    expect(a.invitacionId).not.toBe(b.invitacionId);
    expect(a.token).not.toBe(b.token);
    expect(a.invitacionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("cambiar el Buffer original después de construir el adaptador no cambia los tokens", () => {
    const secreto = Buffer.alloc(32, 7);
    const tokens = crearTokensHmac(secreto);
    const antes = tokens.derivar(ID);
    secreto.fill(0);
    expect(tokens.derivar(ID)).toBe(antes);
  });
});
