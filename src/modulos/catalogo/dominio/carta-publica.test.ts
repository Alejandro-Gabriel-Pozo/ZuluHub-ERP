import { describe, expect, it } from "vitest";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { ocultoPor } from "./carta-publica";

const S1 = sucursalId("00000000-0000-4000-8000-000000000001");
const S2 = sucursalId("00000000-0000-4000-8000-000000000002");
const empresa = (oculto: boolean) => ({ sucursalId: null, oculto });
const local = (sucursal: typeof S1, oculto: boolean) => ({ sucursalId: sucursal, oculto });

describe("ocultoPor: la única regla de lectura del botón «Ocultar»", () => {
  it("sin filas está visible", () => {
    expect(ocultoPor([], S1)).toBeNull();
  });

  it("oculto en el local si el local lo oculta; visible si volvió a mostrarse", () => {
    expect(ocultoPor([local(S1, true)], S1)).toBe("SUCURSAL");
    expect(ocultoPor([local(S1, false)], S1)).toBeNull();
  });

  it("oculto en toda la empresa se ve en cualquier local, y un local no puede «mostrar» lo que la empresa oculta", () => {
    expect(ocultoPor([empresa(true)], S1)).toBe("EMPRESA");
    expect(ocultoPor([empresa(true), local(S1, false)], S1)).toBe("EMPRESA");
    expect(ocultoPor([empresa(true), local(S1, true)], S1)).toBe("EMPRESA");
    expect(ocultoPor([empresa(false), local(S1, true)], S1)).toBe("SUCURSAL");
  });

  it("la fila de otro local no cuenta, aunque llegue; la de la empresa vuelta a mostrar tampoco", () => {
    expect(ocultoPor([local(S2, true)], S1)).toBeNull();
    expect(ocultoPor([empresa(false), local(S2, true)], S1)).toBeNull();
    expect(ocultoPor([local(S2, true), local(S1, true)], S1)).toBe("SUCURSAL");
  });
});
