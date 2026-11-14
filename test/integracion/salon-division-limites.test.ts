import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { MAXIMO_DE_PARTES_EN_LA_BASE } from "../../src/primitivas/cuentas/limites-de-division";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";

/**
 * Límites de dividir la cuenta (dueño, 14/11/2026): la base copia el MAYOR de los dos límites de `limites-de-division.ts` (migración 0052) y esta
 * prueba falla si el número de la base y el de la constante difieren. Previene: el servidor acepta una cuenta que la base rechaza a mitad de la transacción.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)(
  "salón: los límites de dividir en la base copian la constante",
  () => {
    let m: MundoDeSalon;
    beforeAll(async () => {
      if (base === null) return;
      m = await montarSalon(base);
    });
    afterAll(async () => {
      await m.cerrar();
    });

    const definicion = async (restriccion: string): Promise<string> => {
      const filas = await m.filas<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1",
        [restriccion],
      );
      expect(filas).toHaveLength(1);
      return filas[0]?.d ?? "";
    };
    const topeDe = (texto: string): number => {
      const mayor = /<= (\d+)\)/.exec(texto);
      expect(mayor, texto).not.toBeNull();
      return Number(mayor?.[1]);
    };

    it("el tope de partes de la división y el del número de parte son exactamente el de la constante", async () => {
      expect(topeDe(await definicion("division_partes_ck"))).toBe(MAXIMO_DE_PARTES_EN_LA_BASE);
      expect(topeDe(await definicion("parte_de_division_numero_ck"))).toBe(
        MAXIMO_DE_PARTES_EN_LA_BASE,
      );
    });

    it("el mínimo de una división sigue siendo 2 y el de una parte, 1 (la migración solo amplía el tope)", async () => {
      expect(await definicion("division_partes_ck")).toContain(">= 2");
      expect(await definicion("parte_de_division_numero_ck")).toContain(">= 1");
    });
  },
);
