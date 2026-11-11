import { describe, expect, it } from "vitest";
import {
  decidirCambiarSalida,
  estadoDeLineaDeComanda,
  nombreDeImpresora,
  puedeCobrarse,
  rotuloDeEnvio,
  seleccionarParaElEnvio,
  type LineaDeComanda,
} from "./envio";

const l = (lineaId: string, extra: Partial<LineaDeComanda> = {}): LineaDeComanda => ({
  lineaId,
  vigente: true,
  envioId: null,
  salida: "AHORA",
  ...extra,
});

describe("estado de la línea de comanda", () => {
  it("se deriva del envío y de la salida", () => {
    expect(estadoDeLineaDeComanda({ envioId: null, salida: "AHORA" })).toBe("PARA_ENVIAR");
    expect(estadoDeLineaDeComanda({ envioId: null, salida: "DESPUES" })).toBe("ESPERA");
    expect(estadoDeLineaDeComanda({ envioId: "e", salida: "DESPUES" })).toBe("ENVIADA");
    expect(estadoDeLineaDeComanda({ envioId: "e", salida: "AHORA" })).toBe("ENVIADA");
  });
});

describe("puedeCobrarse", () => {
  it("con platos sin enviar o esperando no se cobra", () => {
    expect(puedeCobrarse([l("a", { envioId: "e" }), l("b")])).toEqual({
      ok: false,
      error: "HAY_PLATOS_SIN_ENVIAR",
    });
    expect(puedeCobrarse([l("a", { salida: "DESPUES" })])).toEqual({
      ok: false,
      error: "HAY_PLATOS_SIN_ENVIAR",
    });
  });
  it("las anuladas no cuentan; todo enviado (o cuenta vacía) se cobra", () => {
    expect(puedeCobrarse([l("a", { envioId: "e" }), l("b", { vigente: false })]).ok).toBe(true);
    expect(puedeCobrarse([]).ok).toBe(true);
  });
});

describe("decidirCambiarSalida", () => {
  it("solo mientras no se envió y siga vigente", () => {
    expect(decidirCambiarSalida(l("a")).ok).toBe(true);
    expect(decidirCambiarSalida(l("a", { envioId: "e" }))).toEqual({
      ok: false,
      error: "LINEA_YA_ENVIADA",
    });
    expect(decidirCambiarSalida(l("a", { vigente: false }))).toEqual({
      ok: false,
      error: "LINEA_NO_VIGENTE",
    });
  });
});

describe("seleccionarParaElEnvio", () => {
  const lineas = [
    l("ahora"),
    l("despues", { salida: "DESPUES" }),
    l("enviada", { envioId: "e" }),
    l("quitada", { vigente: false }),
  ];
  it("un envío toma lo que sale ahora y deja el resto esperando en el papel", () => {
    expect(seleccionarParaElEnvio("ENVIO", lineas)).toEqual({
      salen: ["ahora"],
      esperan: ["despues"],
      ignoradas: [],
    });
  });
  it("«pedir que salga» toma lo que espera: todo, o solo lo pedido, ignorando lo demás", () => {
    expect(seleccionarParaElEnvio("SALIDA_PEDIDA", lineas, "TODAS")).toEqual({
      salen: ["despues"],
      esperan: [],
      ignoradas: [],
    });
    expect(
      seleccionarParaElEnvio("SALIDA_PEDIDA", lineas, ["despues", "enviada", "quitada", "despues"]),
    ).toEqual({
      salen: ["despues"],
      esperan: [],
      ignoradas: ["enviada", "quitada"],
    });
  });
  it("sin nada pendiente no sale nada", () => {
    expect(seleccionarParaElEnvio("ENVIO", [l("e", { envioId: "x" })])).toEqual({
      salen: [],
      esperan: [],
      ignoradas: [],
    });
  });
});

describe("textos cortos", () => {
  it("el rótulo admite «Mesa 5» y rechaza HTML y lo muy largo", () => {
    expect(rotuloDeEnvio("Mesa 5")).toEqual({ ok: true, valor: "Mesa 5" });
    expect(rotuloDeEnvio("<b>x</b>")).toEqual({ ok: false, error: "ROTULO_INVALIDO" });
    expect(rotuloDeEnvio("")).toEqual({ ok: false, error: "ROTULO_INVALIDO" });
    expect(rotuloDeEnvio("a".repeat(41)).ok).toBe(false);
    expect(rotuloDeEnvio("a".repeat(40)).ok).toBe(true);
  });
  it("el nombre de impresora lleva al menos una letra y hasta 40", () => {
    expect(nombreDeImpresora("Cocina 1")).toEqual({ ok: true, valor: "Cocina 1" });
    expect(nombreDeImpresora("123")).toEqual({ ok: false, error: "NOMBRE_DE_IMPRESORA_INVALIDO" });
    expect(nombreDeImpresora("a".repeat(41)).ok).toBe(false);
  });
});
