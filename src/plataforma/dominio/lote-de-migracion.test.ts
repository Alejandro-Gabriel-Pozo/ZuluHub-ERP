import { describe, expect, it } from "vitest";
import {
  LIMITE_DE_TENANTS_POR_LOTE,
  claveDeIdempotenciaDelTenantDelLote,
  validarLote,
} from "./lote-de-migracion";
import { claveDeIdempotenciaValida } from "./soporte/consulta";

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = (n: number, numeroEsperado: number | null = 1) => ({
  tenantId: uuid(n),
  numeroEsperado,
});

describe("validarLote: la clave del lote", () => {
  it.each(["a", "lote-1", "ABC-123", "-", "0", "x".repeat(64)])("acepta %s", (clave) => {
    expect(validarLote(clave, [tenant(1)]).ok).toBe(true);
  });

  it.each([
    ["vacía", ""],
    ["de 65 caracteres", "x".repeat(65)],
    ["con guion bajo (es el separador de la clave de cada tenant)", "lote_1"],
    ["con espacio", "lote 1"],
    ["con punto", "lote.1"],
    ["con eñe", "añoñe"],
    ["con salto de línea al final", "lote\n"],
    ["con salto de línea al principio", "\nlote"],
  ])("rechaza una clave %s", (_nombre, clave) => {
    expect(validarLote(clave, [tenant(1)])).toEqual({
      ok: false,
      error: "CLAVE_DE_LOTE_INVALIDA",
    });
  });
});

describe("validarLote: los tenants", () => {
  it("un lote vacío es LOTE_VACIO", () => {
    expect(validarLote("lote-1", [])).toEqual({ ok: false, error: "LOTE_VACIO" });
  });

  it("un tenant solo vale; 200 valen; 201 es LOTE_DEMASIADO_GRANDE", () => {
    expect(LIMITE_DE_TENANTS_POR_LOTE).toBe(200);
    expect(validarLote("lote-1", [tenant(1)]).ok).toBe(true);
    const doscientos = Array.from({ length: 200 }, (_, i) => tenant(i + 1));
    const r = validarLote("lote-1", doscientos);
    expect(r.ok && r.valor).toHaveLength(200);
    expect(validarLote("lote-1", [...doscientos, tenant(201)])).toEqual({
      ok: false,
      error: "LOTE_DEMASIADO_GRANDE",
    });
  });

  it("el primer problema gana: clave, vacío, tamaño, id y repetido, en ese orden", () => {
    expect(validarLote("mala_clave", [])).toEqual({ ok: false, error: "CLAVE_DE_LOTE_INVALIDA" });
    const enormeConIdMalo = Array.from({ length: 201 }, () => ({
      tenantId: "x",
      numeroEsperado: 1,
    }));
    expect(validarLote("lote-1", enormeConIdMalo)).toEqual({
      ok: false,
      error: "LOTE_DEMASIADO_GRANDE",
    });
    expect(
      validarLote("lote-1", [{ tenantId: "x", numeroEsperado: 1 }, tenant(1), tenant(1)]),
    ).toEqual({ ok: false, error: "ID_INVALIDO" });
  });

  it("devuelve a los tenants con el id en minúsculas, en el orden dado y con su numeroEsperado", () => {
    const r = validarLote("lote-1", [
      {
        tenantId: uuid(3)
          .toUpperCase()
          .replace("00000000-0000-4000-8000-", "AAAAAAAA-0000-4000-8000-"),
        numeroEsperado: null,
      },
      tenant(2, 7),
      tenant(1, 1),
    ]);
    expect(r).toEqual({
      ok: true,
      valor: [
        { tenantId: "aaaaaaaa-0000-4000-8000-000000000003", numeroEsperado: null },
        { tenantId: uuid(2), numeroEsperado: 7 },
        { tenantId: uuid(1), numeroEsperado: 1 },
      ],
    });
  });

  it("un id que no es un uuid es ID_INVALIDO", () => {
    for (const tenantId of [
      "",
      "no-es-uuid",
      "00000000-0000-4000-8000-00000000000",
      `${uuid(1)} `,
    ]) {
      expect(validarLote("lote-1", [{ tenantId, numeroEsperado: 1 }]), tenantId).toEqual({
        ok: false,
        error: "ID_INVALIDO",
      });
    }
  });

  it("el mismo tenant dos veces es TENANT_REPETIDO_EN_EL_LOTE, aunque venga escrito en mayúsculas", () => {
    expect(validarLote("lote-1", [tenant(1, 1), tenant(2), tenant(1, 2)])).toEqual({
      ok: false,
      error: "TENANT_REPETIDO_EN_EL_LOTE",
    });
    expect(
      validarLote("lote-1", [
        { tenantId: "AAAAAAAA-0000-4000-8000-000000000001", numeroEsperado: 1 },
        { tenantId: "aaaaaaaa-0000-4000-8000-000000000001", numeroEsperado: 1 },
      ]),
    ).toEqual({ ok: false, error: "TENANT_REPETIDO_EN_EL_LOTE" });
  });
});

describe("claveDeIdempotenciaDelTenantDelLote", () => {
  it("es lote_<clave>_<tenant>", () => {
    expect(claveDeIdempotenciaDelTenantDelLote("lote-1", uuid(5))).toBe(`lote_lote-1_${uuid(5)}`);
  });

  it("con la clave de lote más corta y la más larga siempre es una clave de idempotencia válida", () => {
    for (const clave of ["a", "x".repeat(64)]) {
      const armada = claveDeIdempotenciaDelTenantDelLote(clave, uuid(1));
      expect(claveDeIdempotenciaValida(armada), armada).toBe(true);
    }
    expect(claveDeIdempotenciaDelTenantDelLote("x".repeat(64), uuid(1))).toHaveLength(106);
    expect(claveDeIdempotenciaDelTenantDelLote("a", uuid(1))).toHaveLength(43);
  });

  it("dos lotes distintos o dos tenants distintos nunca arman la misma clave", () => {
    const claves = new Set([
      claveDeIdempotenciaDelTenantDelLote("a", uuid(1)),
      claveDeIdempotenciaDelTenantDelLote("b", uuid(1)),
      claveDeIdempotenciaDelTenantDelLote("a", uuid(2)),
    ]);
    expect(claves.size).toBe(3);
  });
});
