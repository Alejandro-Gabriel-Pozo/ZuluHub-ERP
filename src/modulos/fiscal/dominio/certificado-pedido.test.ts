import { describe, expect, it } from "vitest";
import { cuitDesdeTexto } from "../../../primitivas/identificacion-fiscal/cuit";
import { armarPedidoDeCertificado, numeroDeSerieDeCuit } from "./certificado-pedido";
import { emisorId } from "./identificadores";

const ID = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";
const EMISOR = emisorId("emisor-1");
const entrada = (cambios: Partial<Parameters<typeof armarPedidoDeCertificado>[0]> = {}) => ({
  id: ID,
  emisorId: EMISOR,
  ambiente: "HOMOLOGACION" as const,
  alias: "zuluhub2026",
  cuitTitular: "20123456786",
  organizacion: "Cooperativa Pampa SA",
  ...cambios,
});

describe("armarPedidoDeCertificado", () => {
  it("un pedido bien formado se arma con el CUIT canónico y la organización sin blancos", () => {
    const r = armarPedidoDeCertificado(
      entrada({ cuitTitular: "20-12345678-6", organizacion: "  Cooperativa Pampa SA \n" }),
    );
    expect(r).toEqual({
      ok: true,
      valor: {
        id: ID,
        emisorId: EMISOR,
        ambiente: "HOMOLOGACION",
        alias: "zuluhub2026",
        cuitTitular: "20123456786",
        organizacion: "Cooperativa Pampa SA",
      },
    });
  });

  describe("el id es un uuid en minúscula", () => {
    it.each([
      ["vacío", ""],
      ["sin guiones", "0b3a0c5e8f7d4c1b9a2e1d2c3b4a5f60"],
      ["en mayúscula", ID.toUpperCase()],
      ["con basura antes", `x${ID}`],
      ["con basura después", `${ID}x`],
      ["con un salto de línea al final", `${ID}\n`],
      ["con un dígito de más", `${ID}0`],
      ["con un carácter no hexadecimal", `${ID.slice(0, -1)}g`],
    ])("%s → ID_INVALIDO", (_nombre, id) => {
      expect(armarPedidoDeCertificado(entrada({ id }))).toEqual({
        ok: false,
        error: "ID_INVALIDO",
      });
    });
  });

  describe("el alias son 1 a 30 letras o dígitos", () => {
    it.each([
      ["una letra", "a"],
      ["30 caracteres", "a".repeat(30)],
      ["mayúsculas y dígitos", "ZuluHub2026"],
    ])("acepta %s", (_nombre, alias) => {
      expect(armarPedidoDeCertificado(entrada({ alias })).ok).toBe(true);
    });

    it.each([
      ["vacío", ""],
      ["31 caracteres", "a".repeat(31)],
      ["con espacio", "zulu hub"],
      ["con guion", "zulu-hub"],
      ["con ñ", "año"],
      ["con salto de línea al final", "zuluhub\n"],
      ["con espacio al principio", " zuluhub"],
    ])("rechaza %s", (_nombre, alias) => {
      expect(armarPedidoDeCertificado(entrada({ alias }))).toEqual({
        ok: false,
        error: "ALIAS_INVALIDO",
      });
    });
  });

  describe("el CUIT tiene que ser válido", () => {
    it.each([
      ["con dígito verificador malo", "20123456787"],
      ["corto", "2012345678"],
      ["con letras", "2012345678a"],
      ["vacío", ""],
    ])("%s → CUIT_INVALIDO", (_nombre, cuitTitular) => {
      expect(armarPedidoDeCertificado(entrada({ cuitTitular }))).toEqual({
        ok: false,
        error: "CUIT_INVALIDO",
      });
    });
  });

  describe("la organización son 1 a 64 caracteres sin controles (después de recortar)", () => {
    it.each([
      ["una letra", "A"],
      ["64 caracteres", "A".repeat(64)],
      ["64 caracteres con blancos alrededor", `  ${"A".repeat(64)}  `],
      [
        "con acentos, símbolos y letras que un patrón sin `u` rechazaría",
        "Pañalera Cañuelas S.R.L. & Cía. «Ñandú»",
      ],
      ["64 caracteres que ocupan dos unidades cada uno", "🌱".repeat(64)],
    ])("acepta %s", (_nombre, organizacion) => {
      expect(armarPedidoDeCertificado(entrada({ organizacion })).ok).toBe(true);
    });

    it.each([
      ["vacía", ""],
      ["solo blancos", "   "],
      ["65 caracteres", "A".repeat(65)],
      ["65 caracteres de dos unidades", "🌱".repeat(65)],
      ["con un tabulador adentro", "Coop\tPampa"],
      ["con un salto de línea adentro", "Coop\nPampa"],
      ["con un carácter nulo", "Coop\u0000Pampa"],
    ])("rechaza %s", (_nombre, organizacion) => {
      expect(armarPedidoDeCertificado(entrada({ organizacion }))).toEqual({
        ok: false,
        error: "ORGANIZACION_INVALIDA",
      });
    });
  });

  it("con varios defectos manda el primero: id, alias, CUIT, organización", () => {
    const todoMal = { id: "x", alias: "", cuitTitular: "1", organizacion: "" };
    expect(armarPedidoDeCertificado(entrada(todoMal))).toEqual({ ok: false, error: "ID_INVALIDO" });
    expect(armarPedidoDeCertificado(entrada({ ...todoMal, id: ID }))).toEqual({
      ok: false,
      error: "ALIAS_INVALIDO",
    });
    expect(armarPedidoDeCertificado(entrada({ ...todoMal, id: ID, alias: "a" }))).toEqual({
      ok: false,
      error: "CUIT_INVALIDO",
    });
  });
});

describe("numeroDeSerieDeCuit", () => {
  it("es CUIT y los 11 dígitos, como lo pide ARCA", () => {
    const cuit = cuitDesdeTexto("20-12345678-6");
    if (!cuit.ok) throw new Error("CUIT de prueba inválido");
    expect(numeroDeSerieDeCuit(cuit.valor)).toBe("CUIT 20123456786");
  });
});
