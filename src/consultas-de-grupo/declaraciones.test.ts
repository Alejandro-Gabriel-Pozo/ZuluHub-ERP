import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_GRUPO } from "../capacidades/permisos/grupo";
import { DECLARACIONES_DE_CONSULTAS_DE_GRUPO } from "./declaraciones";

/**
 * Los cruces del catálogo comercial (ADR-003, X1 y X4) para el catálogo de GRUPO: el de empresa los
 * comprueba `test/arquitectura/catalogo-modulos.test.ts`. Acá el catálogo es de un solo módulo.
 */
describe("el catálogo de grupo y las consultas de grupo se corresponden (X1, X4)", () => {
  const exigidas = Object.values(DECLARACIONES_DE_CONSULTAS_DE_GRUPO).map((d) => d.accion);
  const declaradas = Object.values(CATALOGO_DE_GRUPO).flatMap((m) => Object.keys(m.acciones));

  it("X1: toda acción del catálogo la exige alguna consulta, y toda consulta exige una acción del catálogo", () => {
    expect([...exigidas].sort()).toEqual([...declaradas].sort());
  });

  it("X1: el módulo dueño de esas acciones figura implementado por la carpeta consultas-de-grupo", () => {
    expect(CATALOGO_DE_GRUPO.grupo.implementadoPor).toEqual(["consultas-de-grupo"]);
  });

  it("X4: la carpeta que lo implementa existe en src/", () => {
    for (const carpeta of CATALOGO_DE_GRUPO.grupo.implementadoPor) {
      const ruta = fileURLToPath(new URL(`../${carpeta}`, import.meta.url));
      expect(existsSync(ruta) && statSync(ruta).isDirectory(), carpeta).toBe(true);
    }
  });

  it("el módulo es obligatorio y está disponible, y no requiere nada", () => {
    expect(CATALOGO_DE_GRUPO.grupo.obligatorio).toBe(true);
    expect(CATALOGO_DE_GRUPO.grupo.estado).toBe("disponible");
    expect(CATALOGO_DE_GRUPO.grupo.requiere).toEqual([]);
  });
});
