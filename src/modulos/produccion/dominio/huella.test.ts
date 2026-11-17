import { describe, expect, it } from "vitest";
import {
  huellaDeAbrirOrden,
  huellaDeAnularOrden,
  huellaDeCancelarOrden,
  huellaDeCerrarOrden,
  huellaDelProductoDeLaOrden,
} from "./huella";

describe("huellas de producción", () => {
  it("son sha256 estables y cualquier campo distinto da otra", () => {
    const base = huellaDeCerrarOrden("o1", "9.5", "KILOGRAMO", "2026-12-01", [["harina", "6"]]);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeCerrarOrden("o1", "9.5", "KILOGRAMO", "2026-12-01", [["harina", "6"]])).toBe(
      base,
    );
    for (const otra of [
      huellaDeCerrarOrden("o2", "9.5", "KILOGRAMO", "2026-12-01", [["harina", "6"]]),
      huellaDeCerrarOrden("o1", "9.6", "KILOGRAMO", "2026-12-01", [["harina", "6"]]),
      huellaDeCerrarOrden("o1", "9.5", "GRAMO", "2026-12-01", [["harina", "6"]]),
      huellaDeCerrarOrden("o1", "9.5", "KILOGRAMO", null, [["harina", "6"]]),
      huellaDeCerrarOrden("o1", "9.5", "KILOGRAMO", "2026-12-01", [["harina", "7"]]),
    ])
      expect(otra).not.toBe(base);
  });
  it("cada operación tiene su propia huella aunque el contenido coincida", () => {
    expect(huellaDeAnularOrden("o1", "error")).not.toBe(huellaDeCancelarOrden("o1", "error"));
    expect(huellaDeAnularOrden("o1", "error")).not.toBe(huellaDeAnularOrden("o1", "otro"));
    const a = huellaDeAbrirOrden("o1", "p", "10", "UNIDAD", "d1", "d2");
    expect(a).not.toBe(huellaDeAbrirOrden("o1", "p", "10", "UNIDAD", "d2", "d1"));
    expect(a).toBe(huellaDeAbrirOrden("o1", "p", "10", "UNIDAD", "d1", "d2"));
  });
});

describe("la huella es la de stock con el nombre de la operación y el contenido canónico", () => {
  it("cada comando arma exactamente su contenido", async () => {
    const { huellaDeComando } = await import("../../stock/publico");
    expect(huellaDeCerrarOrden("o1", "9.5", "KILOGRAMO", null, [["h", "1"]])).toBe(
      huellaDeComando("produccion.cerrar_orden", ["o1", "9.5", "KILOGRAMO", null], [["h", "1"]]),
    );
    expect(huellaDeAnularOrden("o1", "m")).toBe(
      huellaDeComando("produccion.anular_orden", ["o1", "m"], []),
    );
    expect(huellaDeCancelarOrden("o1", "m")).toBe(
      huellaDeComando("produccion.cancelar_orden", ["o1", "m"], []),
    );
    expect(huellaDeAbrirOrden("o1", "p", "10", "UNIDAD", "d1", "d2")).toBe(
      huellaDeComando("produccion.abrir_orden", ["o1", "p", "10", "UNIDAD", "d1", "d2"], []),
    );
  });
});

describe("la huella del producto de un cierre", () => {
  it("es la de stock con su nombre y sus cuatro campos: cada uno la cambia y difiere de la del cierre entero", async () => {
    const { huellaDeComando } = await import("../../stock/publico");
    const base = huellaDelProductoDeLaOrden("o1", "9.5", "KILOGRAMO", "2026-12-01");
    expect(base).toBe(
      huellaDeComando(
        "produccion.producto_de_la_orden",
        ["o1", "9.5", "KILOGRAMO", "2026-12-01"],
        [],
      ),
    );
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    for (const otra of [
      huellaDelProductoDeLaOrden("o2", "9.5", "KILOGRAMO", "2026-12-01"),
      huellaDelProductoDeLaOrden("o1", "9.6", "KILOGRAMO", "2026-12-01"),
      huellaDelProductoDeLaOrden("o1", "9.5", "GRAMO", "2026-12-01"),
      huellaDelProductoDeLaOrden("o1", "9.5", "KILOGRAMO", null),
      huellaDeCerrarOrden("o1", "9.5", "KILOGRAMO", "2026-12-01", []),
    ]) {
      expect(otra).not.toBe(base);
    }
  });
});
