import { describe, expect, it } from "vitest";
import { huellaDeAnulacion } from "./huella-de-anulacion";

const base = {
  ticketId: "t",
  ejemplarBaseId: "b",
  ejemplarNuevoId: "n",
  motivo: "Error del cajero",
};

describe("huella de una anulación", () => {
  it("es un sha256 en hexadecimal y es estable", () => {
    expect(huellaDeAnulacion(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeAnulacion({ ...base })).toBe(huellaDeAnulacion(base));
  });
  it("cualquier cambio del pedido cambia la huella", () => {
    const h = huellaDeAnulacion(base);
    expect(huellaDeAnulacion({ ...base, ticketId: "x" })).not.toBe(h);
    expect(huellaDeAnulacion({ ...base, ejemplarBaseId: "x" })).not.toBe(h);
    expect(huellaDeAnulacion({ ...base, ejemplarNuevoId: "x" })).not.toBe(h);
    expect(huellaDeAnulacion({ ...base, motivo: "x" })).not.toBe(h);
  });
  it("no confunde campos contiguos (cada uno es un elemento aparte)", () => {
    expect(
      huellaDeAnulacion({ ticketId: "ab", ejemplarBaseId: "c", ejemplarNuevoId: "n", motivo: "m" }),
    ).not.toBe(
      huellaDeAnulacion({ ticketId: "a", ejemplarBaseId: "bc", ejemplarNuevoId: "n", motivo: "m" }),
    );
  });
});
