import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AHORA_DE_PRUEBA } from "./entorno";
import { EMITIDA_EN, VENCE_EN, ventanaDeInvitacion } from "./fixtures-identidad";

/**
 * Las fechas de las invitaciones de prueba no pueden envejecer. Dos contratos:
 *  (1) la ventana FIJA (`EMITIDA_EN`, `VENCE_EN`) rodea al `ahora` inyectado de las pruebas, y la ventana
 *      RELATIVA (`ventanaDeInvitacion`) rodea al instante que se le da, sea cual sea;
 *  (2) ninguna prueba que corre con el reloj REAL (`() => new Date()`) usa la ventana fija: con el paso de
 *      los días quedaría vencida y la aceptación fallaría con `INVITACION_VENCIDA`.
 */

const DIA = 86_400_000;

/**
 * Un archivo inyecta el reloj REAL como `ahora` (`() => new Date()`) e importa la ventana fija de las
 * invitaciones. (`Date.now()` solo no alcanza: firmar un contexto con la hora real es lo correcto.)
 */
function mezclaRelojRealConVentanaFija(fuente: string): boolean {
  const relojReal = /=>\s*new\s+Date\s*\(\s*\)/.test(fuente);
  const importaLaFija =
    /import\s*\{[^}]*\b(EMITIDA_EN|VENCE_EN)\b[^}]*\}\s*from\s*"\.\/fixtures-identidad"/.test(
      fuente,
    );
  return relojReal && importaLaFija;
}

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivosDe(ruta) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

describe("las fechas de las invitaciones de prueba", () => {
  it("la ventana fija rodea al ahora inyectado: emitida antes, vence después", () => {
    expect(EMITIDA_EN.getTime()).toBeLessThan(AHORA_DE_PRUEBA.getTime());
    expect(VENCE_EN.getTime()).toBeGreaterThan(AHORA_DE_PRUEBA.getTime());
    expect(EMITIDA_EN.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(VENCE_EN.toISOString()).toBe("2026-10-17T12:00:00.000Z");
  });

  it.each([0, 1_000, Date.parse("2026-10-19T12:00:00Z"), Date.parse("2031-03-04T05:06:07Z")])(
    "la ventana relativa a %d rodea a ese instante: emitida hace un minuto, vence en siete días",
    (ahora) => {
      const v = ventanaDeInvitacion(ahora);
      expect(ahora - v.emitidaEn.getTime()).toBe(60_000);
      expect(v.venceEn.getTime() - ahora).toBe(7 * DIA);
    },
  );

  it("ninguna prueba con reloj real usa la ventana fija (EMITIDA_EN, VENCE_EN)", () => {
    const culpables = archivosDe(join(import.meta.dirname, ".."))
      .filter((ruta) => !ruta.endsWith("fixtures-identidad.test.ts"))
      .filter((ruta) => mezclaRelojRealConVentanaFija(readFileSync(ruta, "utf8")));
    expect(culpables).toEqual([]);
  });

  describe("el detector (violaciones inyectadas)", () => {
    const IMPORTA = 'import { VENCE_EN, crearInvitacionDeBase } from "./fixtures-identidad";\n';
    it("detecta reloj real + ventana fija importada", () => {
      expect(
        mezclaRelojRealConVentanaFija(`${IMPORTA}const deps = { ahora: () => new Date() };\n`),
      ).toBe(true);
      expect(
        mezclaRelojRealConVentanaFija(
          `${IMPORTA}const ahora = () => new Date( );\nuse(VENCE_EN);\n`,
        ),
      ).toBe(true);
    });
    it("no marca reloj inyectado con la ventana fija, ni reloj real con la ventana relativa", () => {
      expect(mezclaRelojRealConVentanaFija(`${IMPORTA}const ahora = AHORA_DE_PRUEBA;\n`)).toBe(
        false,
      );
      expect(
        mezclaRelojRealConVentanaFija(
          'import { ventanaDeInvitacion } from "./fixtures-identidad";\nconst ahora = () => new Date();\n',
        ),
      ).toBe(false);
      // Firmar con la hora real (`Date.now()`) no es inyectar el reloj: no se marca.
      expect(mezclaRelojRealConVentanaFija(`${IMPORTA}const x = Date.now();\n`)).toBe(false);
    });
  });
});
