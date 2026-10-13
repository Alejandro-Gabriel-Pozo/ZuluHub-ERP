import { describe, expect, it } from "vitest";
import type {
  EntradaDeCrearSucursal,
  EntradaDeDesactivarSucursal,
  EntradaDeEditarSucursal,
  EntradaDeReactivarSucursal,
} from "./publico";
import {
  formaDeCambiarEstadoDeSucursal,
  formaDeCrearSucursal,
  formaDeEditarSucursal,
} from "./formas";

const ID = "44444444-4444-4444-8444-444444444444";

describe("formaDeCrearSucursal", () => {
  it("devuelve la entrada del caso de uso, con el nombre tal cual (sin recortar)", () => {
    const r = formaDeCrearSucursal.safeParse({ nombre: "  Centro  " });
    expect(r.success).toBe(true);
    if (r.success) {
      const entrada: EntradaDeCrearSucursal = r.data;
      expect(entrada).toEqual({ nombre: "  Centro  " });
    }
  });

  it("acepta el nombre vacío: decidir si sirve es del dominio, no de la forma", () => {
    expect(formaDeCrearSucursal.safeParse({ nombre: "" }).success).toBe(true);
  });

  it.each([
    ["falta el nombre", {}],
    ["el nombre no es texto", { nombre: 5 }],
    ["el nombre es null", { nombre: null }],
    ["no es un objeto", "Centro"],
    ["es null", null],
  ])("rechaza: %s", (_nombre, entrada) => {
    expect(formaDeCrearSucursal.safeParse(entrada).success).toBe(false);
  });

  it("descarta lo que no declara: el navegador no puede mandar la empresa", () => {
    const r = formaDeCrearSucursal.parse({ nombre: "Centro", empresaId: "otra", rol: "ADMIN" });
    expect(r).toEqual({ nombre: "Centro" });
  });
});

describe("formaDeEditarSucursal", () => {
  it("devuelve la entrada del caso de uso", () => {
    const r = formaDeEditarSucursal.safeParse({
      sucursalId: ID,
      versionEsperada: "3",
      nombre: "Sur",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const entrada: EntradaDeEditarSucursal = r.data;
      expect(entrada).toEqual({ sucursalId: ID, versionEsperada: 3, nombre: "Sur" });
    }
  });

  it("acepta la versión como entero numérico o como dígitos", () => {
    const base = { sucursalId: ID, nombre: "Sur" };
    expect(formaDeEditarSucursal.parse({ ...base, versionEsperada: 7 }).versionEsperada).toBe(7);
    expect(formaDeEditarSucursal.parse({ ...base, versionEsperada: "7" }).versionEsperada).toBe(7);
    expect(formaDeEditarSucursal.parse({ ...base, versionEsperada: "1" }).versionEsperada).toBe(1);
    expect(
      formaDeEditarSucursal.parse({ ...base, versionEsperada: "2147483647" }).versionEsperada,
    ).toBe(2_147_483_647);
  });

  it.each([
    ["cero", 0],
    ["cero como texto", "0"],
    ["negativa", -1],
    ["negativa como texto", "-1"],
    ["decimal", 1.5],
    ["decimal como texto", "3.5"],
    ["notación científica", "1e3"],
    ["texto vacío", ""],
    ["blancos", " "],
    ["con blancos alrededor", " 3 "],
    ["más grande que un entero de la base", 2_147_483_648],
    ["demasiados dígitos", "12345678901"],
    ["un dígito de más que un entero de la base como texto", "2147483648"],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["un booleano", true],
    ["null", null],
    ["texto cualquiera", "tres"],
  ])("rechaza la versión: %s", (_nombre, versionEsperada) => {
    expect(
      formaDeEditarSucursal.safeParse({ sucursalId: ID, versionEsperada, nombre: "Sur" }).success,
    ).toBe(false);
  });

  it("recorta los blancos del identificador, pero no del nombre", () => {
    const r = formaDeEditarSucursal.parse({
      sucursalId: ` ${ID} `,
      versionEsperada: 1,
      nombre: " Sur ",
    });
    expect(r.sucursalId).toBe(ID);
    expect(r.nombre).toBe(" Sur ");
  });

  it.each([
    ["sin sucursal", { versionEsperada: 1, nombre: "Sur" }],
    ["sucursal vacía", { sucursalId: "  ", versionEsperada: 1, nombre: "Sur" }],
    ["sucursal que no es texto", { sucursalId: 7, versionEsperada: 1, nombre: "Sur" }],
    ["sin versión", { sucursalId: ID, nombre: "Sur" }],
    ["sin nombre", { sucursalId: ID, versionEsperada: 1 }],
  ])("rechaza: %s", (_nombre, entrada) => {
    expect(formaDeEditarSucursal.safeParse(entrada).success).toBe(false);
  });
});

describe("formaDeCambiarEstadoDeSucursal", () => {
  it("devuelve la entrada de desactivar y de reactivar", () => {
    const r = formaDeCambiarEstadoDeSucursal.safeParse({ sucursalId: ID });
    expect(r.success).toBe(true);
    if (r.success) {
      const desactivar: EntradaDeDesactivarSucursal = r.data;
      const reactivar: EntradaDeReactivarSucursal = r.data;
      expect(desactivar).toEqual({ sucursalId: ID });
      expect(reactivar).toEqual({ sucursalId: ID });
    }
  });

  it("rechaza una sucursal vacía o ausente, y descarta lo que sobra", () => {
    expect(formaDeCambiarEstadoDeSucursal.safeParse({}).success).toBe(false);
    expect(formaDeCambiarEstadoDeSucursal.safeParse({ sucursalId: "" }).success).toBe(false);
    expect(formaDeCambiarEstadoDeSucursal.parse({ sucursalId: ID, empresaId: "otra" })).toEqual({
      sucursalId: ID,
    });
  });
});
