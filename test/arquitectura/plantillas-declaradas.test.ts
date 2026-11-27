import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declaracionDesdeTexto } from "../../src/capacidades/roles/sincronizar-plantillas";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { textoDeLaDeclaracion } from "../../scripts/semilla-de-plantillas";

/**
 * `migraciones/plantillas-declaradas.json` es lo que el ejecutor de migraciones lee para sincronizar las plantillas: tiene que ser, siempre,
 * lo que el código declara hoy (`PERMISOS_DE_EMPRESA`). Se regenera con `npm run semilla:plantillas -- --declaracion`. Previene: una acción
 * nueva que el código declara y nunca llega a las plantillas porque nadie regeneró el archivo (el ejecutor no puede importar el código).
 */
const ARCHIVO = join(import.meta.dirname, "../../migraciones/plantillas-declaradas.json");
const actual = readFileSync(ARCHIVO, "utf8");

describe("declaración de plantillas", () => {
  it("es exactamente lo que el código declara hoy", () => {
    expect(actual).toBe(textoDeLaDeclaracion());
  });

  it("el ejecutor la puede leer y trae cada acción del catálogo con sus roles", () => {
    const lectura = declaracionDesdeTexto(actual);
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(Object.keys(lectura.declaracion).sort()).toEqual(
      Object.keys(PERMISOS_DE_EMPRESA).sort(),
    );
    for (const [accion, roles] of Object.entries(lectura.declaracion)) {
      const delCodigo = PERMISOS_DE_EMPRESA[accion as keyof typeof PERMISOS_DE_EMPRESA];
      expect([accion, [...roles].sort()]).toEqual([accion, [...delCodigo].sort()]);
    }
  });

  it("violación inyectada: una acción que el código declara y el archivo no tiene se detecta", () => {
    const sinUna = actual.replace(/ {4}"[a-z_]+\.[a-z_]+": \[[^\]]*\],\n/, "");
    expect(sinUna).not.toBe(actual);
    expect(sinUna).not.toBe(textoDeLaDeclaracion());
  });

  it("violación inyectada: un rol de más en una acción se detecta", () => {
    const conDeMas = actual.replace('["GERENTE"]', '["GERENTE", "OPERADOR"]');
    expect(conDeMas).not.toBe(textoDeLaDeclaracion());
  });
});
