import { describe, expect, it } from "vitest";
import {
  MODULOS_DE_PRUEBA,
  PERILLAS_DE_PRUEBA,
  encendida,
  apagada,
  limite,
} from "../../../test/utilidades/planes";
import type { ContenidoParaComparar } from "../../capacidades/planes/diferencia";
import type { ValorDePerilla } from "../../capacidades/planes/valores";
import { sentidoDeCambiarDeVersion } from "./sentido-del-cambio";

const AHORA = new Date("2026-11-20T15:00:00Z");
const version = (
  modulos: readonly string[],
  perillas: Record<string, ValorDePerilla> = {},
): ContenidoParaComparar => ({ modulos, perillas });
const sentido = (actual: ContenidoParaComparar | null, destino: ContenidoParaComparar) =>
  sentidoDeCambiarDeVersion({
    actual,
    destino,
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
    ahora: AHORA,
  });

/** Una sola regla de suba o baja para el servidor y para lo que muestra la consola (S-1: lo mixto es BAJA). */
describe("sentidoDeCambiarDeVersion", () => {
  it("sin versión que rija no hay nada que quitar: SUBA", () => {
    expect(sentido(null, version(["caja"]))).toBe("SUBA");
  });

  it("pasar a una versión igual, o que solo suma, es SUBA", () => {
    expect(sentido(version(["caja"]), version(["caja"]))).toBe("SUBA");
    expect(sentido(version(["caja"]), version(["caja", "ventas"]))).toBe("SUBA");
  });

  it("quitar un módulo es BAJA", () => {
    expect(sentido(version(["caja", "ventas"]), version(["caja"]))).toBe("BAJA");
  });

  it("un cambio mixto (suma un módulo y baja un límite) es BAJA", () => {
    const antes = version(["caja"], { cajas_por_sucursal: limite(5) });
    expect(sentido(antes, version(["caja", "ventas"], { cajas_por_sucursal: limite(2) }))).toBe(
      "BAJA",
    );
    expect(sentido(antes, version(["caja"], { cajas_por_sucursal: limite(9) }))).toBe("SUBA");
  });

  it("el resultado no depende del reloj que se le pasa", () => {
    const a = version(["caja", "ventas"]);
    const b = version(["caja"]);
    const otro = sentidoDeCambiarDeVersion({
      actual: a,
      destino: b,
      catalogoDeModulos: MODULOS_DE_PRUEBA,
      catalogoDePerillas: PERILLAS_DE_PRUEBA,
      ahora: new Date("2030-01-01T00:00:00Z"),
    });
    expect(otro).toBe(sentido(a, b));
  });

  it("apagar un interruptor es BAJA y encenderlo es SUBA", () => {
    const encendido = version(["caja"], { con_sello: encendida });
    const apagado = version(["caja"], { con_sello: apagada });
    expect(sentido(encendido, apagado)).toBe("BAJA");
    expect(sentido(apagado, encendido)).toBe("SUBA");
  });
});
