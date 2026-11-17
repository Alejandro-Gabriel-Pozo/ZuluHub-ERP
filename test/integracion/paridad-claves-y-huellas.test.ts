import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { huellaDeCampos } from "../../src/modulos/caja/dominio/huella";
import { exigirClave } from "../../src/modulos/caja/dominio/idempotencia-de-operacion";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { aceptaLaBase, paridadDeAceptacion } from "./paridad-comportamiento";

/**
 * P5b de la comprobación primitivas ↔ base: CLAVES DE IDEMPOTENCIA y HUELLAS de caja. La clave (`^[A-Za-z0-9_-]{16,128}$`) se compara con `exigirClave`, la función de caja que la decide, sondando los dos
 * bordes del largo y un carácter fuera del conjunto. La huella (sha256 en hexadecimal minúscula) se compara con lo que PRODUCE `huellaDeCampos`: la base tiene que aceptar la huella real y rechazar la misma
 * huella en mayúsculas, un carácter menos y un carácter más (las sondas salen de la huella real, no de literales). Quedan fuera, sin función de dominio exportada: las claves de compras, comandas, ticket, salón y
 * stock (cada módulo repite la regex en una constante privada: hallazgo de «una regla, un lugar»).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const claveValida = (texto: string): boolean => exigirClave(texto).ok;
const SONDAS_DE_CLAVE = [
  "a".repeat(15),
  "a".repeat(16),
  "Ab_-" + "9".repeat(12),
  "a".repeat(128),
  "a".repeat(129),
  "a".repeat(15) + "!",
  "a".repeat(15) + " ",
];

describe.skipIf(base === null)("paridad dominio ↔ base: claves y huellas de caja", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let c: pg.Client;
  beforeAll(async () => {
    aparte = await crearBaseAparte(base as BaseDePruebas);
    c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
    await aparte.destruir();
  });

  it("la clave de idempotencia de caja: la base acepta y rechaza lo mismo que exigirClave", async () => {
    await paridadDeAceptacion(
      c,
      "declaracion_de_total",
      "declaracion_de_total_clave_ck",
      "clave_idempotencia",
      SONDAS_DE_CLAVE,
      claveValida,
    );
    await paridadDeAceptacion(
      c,
      "correccion_de_medio",
      "correccion_de_medio_clave_ck",
      "clave_idempotencia",
      SONDAS_DE_CLAVE,
      claveValida,
    );
    await paridadDeAceptacion(
      c,
      "conforme_de_jornada",
      "conforme_de_jornada_clave_ck",
      "clave_idempotencia",
      SONDAS_DE_CLAVE,
      claveValida,
    );
  });

  it("la huella: la base acepta la que produce el dominio y rechaza esa misma en mayúsculas, más corta o más larga", async () => {
    const real = huellaDeCampos(["caja.paridad", "x", null, 1]);
    const sondas = [real, real.toUpperCase(), real.slice(0, -1), `${real}0`];
    const esperado = [true, false, false, false];
    expect(
      await aceptaLaBase(
        c,
        "declaracion_de_total",
        "declaracion_de_total_huella_ck",
        "huella",
        sondas,
      ),
    ).toEqual(esperado);
    expect(
      await aceptaLaBase(
        c,
        "correccion_de_medio",
        "correccion_de_medio_huella_ck",
        "huella",
        sondas,
      ),
    ).toEqual(esperado);
    expect(
      await aceptaLaBase(
        c,
        "conforme_de_jornada",
        "conforme_de_jornada_huella_ck",
        "huella",
        sondas,
      ),
    ).toEqual(esperado);
    expect(
      await aceptaLaBase(c, "movimiento_caja", "movimiento_caja_huella_ck", "huella", sondas),
    ).toEqual(esperado);
    expect(await aceptaLaBase(c, "sesion_caja", "sesion_caja_huella_ck", "huella", sondas)).toEqual(
      esperado,
    );
  });
});
