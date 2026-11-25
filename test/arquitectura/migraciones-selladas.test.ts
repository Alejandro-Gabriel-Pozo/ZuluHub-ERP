import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checksumDeMigracion, PATRON_DE_ARCHIVO } from "../../src/adaptadores/postgres/migraciones";
import { problemasDeSellos, type ArchivosDeMigraciones } from "./migraciones-selladas-apoyo";

/**
 * Sellos de migraciones (T8 de H4b): `migraciones/selladas.json` fija el checksum de cada migración ya aplicada; esta prueba falla si el
 * archivo cambia, si falta o si una migración nueva se cuela con un número que ya quedó atrás. La 0094 queda SIN sellar hasta su primer
 * apply en cualquier base (`npm run sellar:migraciones -- 0094_permisos_configurables.sql`, el mismo día; ver PRIMER-DESPLIEGUE.md).
 * Cada regla trae su violación inyectada.
 */
const CARPETA = join(import.meta.dirname, "../../migraciones");
const sellos = JSON.parse(readFileSync(join(CARPETA, "selladas.json"), "utf8")) as Record<
  string,
  unknown
>;
const hoy: ArchivosDeMigraciones = new Map(
  readdirSync(CARPETA)
    .filter((nombre) => PATRON_DE_ARCHIVO.test(nombre))
    .map((nombre) => [nombre, checksumDeMigracion(readFileSync(join(CARPETA, nombre), "utf8"))]),
);
const HASH = "a".repeat(64);

describe("sellos de migraciones", () => {
  it("las migraciones selladas del repositorio no se editaron y no hay huecos", () => {
    expect(problemasDeSellos(sellos, hoy)).toEqual([]);
  });

  it("están selladas de la 0001 a la 0093 y la 0094 sigue sin sellar hasta su primer apply", () => {
    const nombres = Object.keys(sellos).sort();
    expect(nombres[0]).toBe("0001_base.sql");
    expect(nombres.at(-1)).toBe("0093_correccion_de_compra_ampliada.sql");
    expect(nombres).not.toContain("0094_permisos_configurables.sql");
    const hasta0093 = [...hoy.keys()].filter((n) => n.slice(0, 4) <= "0093");
    expect(nombres).toEqual(hasta0093.sort());
  });

  it("violación inyectada: un hash distinto (se editó después de sellada)", () => {
    const nombre = "0001_base.sql";
    const editado = new Map(hoy).set(nombre, HASH);
    expect(problemasDeSellos(sellos, editado)).toEqual([
      expect.stringContaining(`${nombre}: se editó después de sellada`),
    ]);
  });

  it("violación inyectada: un sellado que no existe (se borró o se renombró)", () => {
    const sin = new Map(hoy);
    sin.delete("0002_identidad.sql");
    expect(problemasDeSellos(sellos, sin)).toEqual([
      expect.stringContaining("0002_identidad.sql: está sellada pero no existe"),
    ]);
  });

  it("violación inyectada: un sello con nombre fuera de migraciones/", () => {
    const afuera = { ...sellos, "../src/x.sql": HASH };
    expect(problemasDeSellos(afuera, hoy)).toEqual([
      expect.stringContaining("../src/x.sql: está sellada pero no existe"),
    ]);
  });

  it("violación inyectada: un sello que no es un SHA-256", () => {
    for (const malo of ["abc", 7, null, "A".repeat(64)]) {
      const roto = { ...sellos, "0001_base.sql": malo };
      expect(problemasDeSellos(roto, hoy)).toEqual([
        expect.stringContaining("0001_base.sql: el sello no es un SHA-256"),
      ]);
    }
  });

  it("violación inyectada: una migración sin sellar con número menor que una sellada", () => {
    const nombre = Object.keys(sellos).find((n) => n.startsWith("0050")) as string;
    const incompletos = Object.fromEntries(Object.entries(sellos).filter(([n]) => n !== nombre));
    expect(problemasDeSellos(incompletos, hoy)).toEqual([
      expect.stringContaining(`${nombre}: no está sellada pero hay una sellada con número mayor`),
    ]);
  });

  it("una migración nueva con número mayor que todas las selladas es válida (la 0094 de hoy)", () => {
    const conNueva = new Map(hoy).set("0095_nueva.sql", HASH);
    expect(problemasDeSellos(sellos, conNueva)).toEqual([]);
  });

  it("sin sellos no hay nada que comprobar", () => {
    expect(problemasDeSellos({}, hoy)).toEqual([]);
  });
});
