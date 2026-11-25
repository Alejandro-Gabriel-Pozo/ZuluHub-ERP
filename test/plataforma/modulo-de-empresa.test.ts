import { describe, expect, it } from "vitest";
import { accionDelModulo } from "../../apps/plataforma/logica/modulo-de-empresa";

const FILA = { obligatorio: false, disponible: true, habilitadoPorElPlan: true, activado: false };

describe("accionDelModulo (qué se ofrece en la fila)", () => {
  it.each([
    ["obligatorio: nada", { obligatorio: true, activado: true }, null],
    ["en desarrollo: nada", { disponible: false, habilitadoPorElPlan: false }, null],
    ["en desarrollo aunque el plan lo incluya: nada", { disponible: false }, null],
    ["no activado e incluido: Activar", {}, "ACTIVAR"],
    ["no activado y no incluido: nada", { habilitadoPorElPlan: false }, null],
    ["activado (activo): Desactivar", { activado: true }, "DESACTIVAR"],
    [
      "activado pero ya fuera del plan (solo lectura): Desactivar",
      { activado: true, habilitadoPorElPlan: false },
      "DESACTIVAR",
    ],
  ])("%s", (_nombre, cambios, esperado) => {
    expect(accionDelModulo({ ...FILA, ...cambios })).toBe(esperado);
  });
});
