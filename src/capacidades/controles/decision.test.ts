import { describe, expect, it } from "vitest";
import { campoConPosibleSecreto } from "../../puertos/sin-secretos";
import { decidirControl, registroDeExcepcion } from "./decision";
import { NIVELES_DE_CONTROL } from "./nivel";

type Clave = "caja.cierre_con_diferencia" | "stock.existencia_negativa";
const CIERRE: Clave = "caja.cierre_con_diferencia";
const STOCK: Clave = "stock.existencia_negativa";

describe("decidirControl", () => {
  it("PERMITIR sigue y deja la excepción, sin pedir confirmación", () => {
    expect(decidirControl<Clave>(CIERRE, "PERMITIR", [])).toEqual({
      ok: true,
      valor: { control: CIERRE, nivel: "PERMITIR", confirmado: false },
    });
  });

  it("PERMITIR registra la confirmación si la persona la mandó igual (la pantalla pudo quedar vieja)", () => {
    expect(decidirControl<Clave>(CIERRE, "PERMITIR", [CIERRE])).toEqual({
      ok: true,
      valor: { control: CIERRE, nivel: "PERMITIR", confirmado: true },
    });
  });

  it("AVISAR sin confirmación pide confirmación y nombra el control", () => {
    expect(decidirControl<Clave>(CIERRE, "AVISAR", [])).toEqual({
      ok: false,
      error: { codigo: "CONTROL_REQUIERE_CONFIRMACION", control: CIERRE },
    });
  });

  it("AVISAR con la confirmación de OTRO control sigue pidiendo la de este", () => {
    expect(decidirControl<Clave>(CIERRE, "AVISAR", [STOCK])).toEqual({
      ok: false,
      error: { codigo: "CONTROL_REQUIERE_CONFIRMACION", control: CIERRE },
    });
  });

  it("AVISAR con su confirmación sigue y la deja registrada", () => {
    expect(decidirControl<Clave>(CIERRE, "AVISAR", [STOCK, CIERRE])).toEqual({
      ok: true,
      valor: { control: CIERRE, nivel: "AVISAR", confirmado: true },
    });
  });

  it("no existe un resultado de bloqueo: ningún nivel devuelve CONTROL_BLOQUEA", () => {
    for (const nivel of NIVELES_DE_CONTROL) {
      for (const confirmaciones of [[], [STOCK]] as const) {
        const r = decidirControl<Clave>(STOCK, nivel, confirmaciones);
        expect(r.ok || r.error.codigo === "CONTROL_REQUIERE_CONFIRMACION").toBe(true);
      }
    }
  });

  it("ninguna decisión modifica las confirmaciones recibidas", () => {
    const confirmaciones: readonly Clave[] = [CIERRE];
    decidirControl<Clave>(CIERRE, "AVISAR", confirmaciones);
    expect(confirmaciones).toEqual([CIERRE]);
  });
});

describe("registro de auditoría de un control", () => {
  const documento = { entidad: "sesion_caja", entidadId: "11111111-1111-4111-8111-111111111111" };

  it("la excepción lleva la acción, el documento, el control, el nivel vigente y la confirmación", () => {
    expect(
      registroDeExcepcion({ control: CIERRE, nivel: "AVISAR", confirmado: true }, documento),
    ).toEqual({
      accion: "CONTROL_EXCEPCION",
      entidad: "sesion_caja",
      entidadId: "11111111-1111-4111-8111-111111111111",
      despues: { control: CIERRE, nivel: "AVISAR", avisoAceptado: true },
    });
    expect(
      registroDeExcepcion({ control: STOCK, nivel: "PERMITIR", confirmado: false }, documento)
        .despues,
    ).toEqual({ control: STOCK, nivel: "PERMITIR", avisoAceptado: false });
  });

  it("ningún campo del registro parece un secreto (la auditoría los rechaza por nombre)", () => {
    const excepcion = registroDeExcepcion(
      { control: CIERRE, nivel: "AVISAR", confirmado: true },
      documento,
    );
    expect(campoConPosibleSecreto(excepcion.despues)).toBeNull();
  });
});
