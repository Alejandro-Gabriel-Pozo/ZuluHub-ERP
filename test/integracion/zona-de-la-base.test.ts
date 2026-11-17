import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { crearBaseAparte } from "./entorno";
import { VARIABLE_DE_LA_ZONA_DE_LA_BASE, zonaDeLaBaseDePruebas } from "./opciones-de-base";

/**
 * La sesión de la base de pruebas tiene la zona horaria pedida (Argentina por defecto). Previene: tres noches de CI en rojo por mezclar el día de Argentina
 * con el de la base (un `::date` sobre un `timestamptz` daba el día de UTC): con la zona de la sesión fijada, el día que ve la base y el de negocio coinciden.
 * Las pruebas no usan el reloj: el instante es fijo, así el resultado es el mismo a cualquier hora.
 */
const base = inject("baseDePruebas");
const ZONA = zonaDeLaBaseDePruebas(process.env[VARIABLE_DE_LA_ZONA_DE_LA_BASE]);
// 02:30 UTC del 16/11/2026 = 23:30 del 15/11 en Buenos Aires.
const INSTANTE = "2026-11-16T02:30:00Z";
const DIA_ESPERADO = ZONA === "UTC" ? "2026-11-16" : "2026-11-15";

async function ver(url: string): Promise<{ zona: string; dia: string; diaEnUtc: string }> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const r = await cliente.query<{ zona: string; dia: string; dia_en_utc: string }>(
      `select current_setting('TimeZone') as zona,
              ($1::timestamptz)::date::text as dia,
              (($1::timestamptz) at time zone 'UTC')::date::text as dia_en_utc`,
      [INSTANTE],
    );
    const fila = r.rows[0];
    if (fila === undefined) throw new Error("la consulta no devolvió fila");
    return { zona: fila.zona, dia: fila.dia, diaEnUtc: fila.dia_en_utc };
  } finally {
    await cliente.end();
  }
}

describe.skipIf(base === null)("la sesión de la base de pruebas tiene la zona pedida", () => {
  it.each(["dueno", "app", "publico"] as const)(
    "base compartida, rol %s: la zona de la sesión es la pedida y `::date` da el día de esa zona",
    async (rol) => {
      if (base === null) return;
      const visto = await ver(base[rol]);
      expect(visto.zona).toBe(ZONA);
      expect(visto.dia).toBe(DIA_ESPERADO);
      // Con la zona dicha a mano no hay diferencia: el código de producción no depende de la zona de la sesión.
      expect(visto.diaEnUtc).toBe("2026-11-16");
    },
  );

  it("una base aparte (`crearBaseAparte`) también nace con la zona pedida", async () => {
    if (base === null) return;
    const propia = await crearBaseAparte(base, { migrar: false });
    try {
      const visto = await ver(propia.base.dueno);
      expect(visto.zona).toBe(ZONA);
      expect(visto.dia).toBe(DIA_ESPERADO);
    } finally {
      await propia.destruir();
    }
  });
});
