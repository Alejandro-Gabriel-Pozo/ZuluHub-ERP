import { describe, expect, it } from "vitest";
import {
  ESTADOS_DEL_FILTRO_DE_ORDENES,
  entradaDeMotivoDeOrden,
  entradaDeOrden,
  leerLaEntradaDeLaListaDeOrdenes,
} from "./entradas-de-produccion";

const ID = "11111111-1111-4111-8111-111111111111";

describe("el filtro de estado de la lista de órdenes", () => {
  it("vacío es «Todas»: sin filtro", () => {
    expect(leerLaEntradaDeLaListaDeOrdenes({ estado: "" })).toEqual({});
  });

  it.each(ESTADOS_DEL_FILTRO_DE_ORDENES)("%s pasa como filtro", (estado) => {
    expect(leerLaEntradaDeLaListaDeOrdenes({ estado })).toEqual({ estado });
  });

  it.each(["CERRADA", "abierta", "ABIERTA ", "TODAS", "ABIERTA' OR 1=1", "toString", "__proto__"])(
    "%j no es una opción declarada: nada puede coincidir (nunca se ensancha el filtro)",
    (estado) => {
      expect(leerLaEntradaDeLaListaDeOrdenes({ estado })).toBeNull();
    },
  );
});

describe("la orden de una acción", () => {
  it("un id con la forma de un UUID pasa", () => {
    expect(entradaDeOrden({ ordenId: ID })).toEqual({ ok: true, valor: { ordenId: ID } });
  });

  it.each([{}, { ordenId: "" }, { ordenId: "no-es-un-id" }, { ordenId: 1 }, null, "x"])(
    "%j no tiene la forma: dato inválido",
    (crudo) => {
      const r = entradaDeOrden(crudo);
      expect(r.ok).toBe(false);
    },
  );

  it("solo se toma lo declarado: lo que de más mande el navegador no pasa", () => {
    expect(entradaDeOrden({ ordenId: ID, empresaId: "otra" })).toEqual({
      ok: true,
      valor: { ordenId: ID },
    });
  });
});

describe("cancelar o anular: el id y el motivo", () => {
  it("el id y el texto del motivo pasan; el largo y los caracteres los decide el caso de uso", () => {
    expect(entradaDeMotivoDeOrden({ ordenId: ID, motivo: "Se rompió el horno" })).toEqual({
      ok: true,
      valor: { ordenId: ID, motivo: "Se rompió el horno" },
    });
    expect(entradaDeMotivoDeOrden({ ordenId: ID, motivo: "" })).toEqual({
      ok: true,
      valor: { ordenId: ID, motivo: "" },
    });
  });

  it.each([
    { ordenId: ID },
    { motivo: "x" },
    { ordenId: ID, motivo: 3 },
    { ordenId: ID, motivo: "x".repeat(1001) },
    { ordenId: "no-es-un-id", motivo: "x" },
  ])("%j no tiene la forma: dato inválido", (crudo) => {
    expect(entradaDeMotivoDeOrden(crudo).ok).toBe(false);
  });

  it("solo se toma lo declarado", () => {
    expect(entradaDeMotivoDeOrden({ ordenId: ID, motivo: "x", personaId: "otra" })).toEqual({
      ok: true,
      valor: { ordenId: ID, motivo: "x" },
    });
  });
});
