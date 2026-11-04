import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  EMPRESAS_POR_PASADA_DE_RECONCILIACION,
  armarTrabajos,
} from "../../src/composicion/trabajos";
import { LIMITE_DE_TRABAJOS_POR_PASADA } from "../../src/composicion/rutas-de-sistema";
import { crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { randomUUID } from "node:crypto";

/**
 * El productor de la reconciliación con MÁS empresas que las que entran en una pasada del cron: cada pasada encola a lo
 * sumo `EMPRESAS_POR_PASADA_DE_RECONCILIACION` (no más de lo que el despacho de esa misma pasada procesa) y las pasadas
 * sucesivas las recorren a todas, sin dejar a ninguna afuera ni encolar dos veces la misma en la hora. Va en su archivo
 * (con su propia base) porque deja muchas empresas con reconciliación pendiente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

describe.skipIf(base === null)("reconciliación: más empresas que las de una pasada", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let conexiones: Conexiones;
  let dueno: pg.Client;
  const empresas: string[] = [];
  /** Más de dos pasadas completas y un resto, sea cual sea el tope. */
  const CANTIDAD = EMPRESAS_POR_PASADA_DE_RECONCILIACION * 2 + 20;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    for (let i = 0; i < CANTIDAD; i++) {
      const e = await crearEmpresaActiva(entorno);
      await dueno.query(
        `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
         values ($1, 'fiscal.validar_comprobante', $2::jsonb, $3)`,
        [
          e.empresa,
          JSON.stringify({ comprobanteId: randomUUID() }),
          `fiscal.validar:${randomUUID()}:1`,
        ],
      );
      empresas.push(e.empresa);
    }
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
      PEDERNAL_DB_TRABAJOS: propia.base.trabajos,
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: () => undefined });
  }, 300_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await conexiones.transaccionesDeTrabajos().cerrar();
    await entorno.cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const reconciliadas = async () =>
    (
      await dueno.query<{ empresa_id: string; n: string }>(
        "select empresa_id, count(*) as n from trabajo where tipo = 'fiscal.reconciliar' group by empresa_id",
      )
    ).rows;

  it("el tope de encolado no pasa lo que el despacho de la misma pasada procesa", () => {
    expect(EMPRESAS_POR_PASADA_DE_RECONCILIACION).toBeLessThanOrEqual(
      LIMITE_DE_TRABAJOS_POR_PASADA,
    );
  });

  it("cada pasada encola a lo sumo el tope y las sucesivas cubren a todas, una sola vez por hora", async () => {
    const trabajos = armarTrabajos(conexiones);
    const ahora = new Date();
    const tope = EMPRESAS_POR_PASADA_DE_RECONCILIACION;
    let acumuladas = 0;
    for (let pasada = 1; pasada <= 3; pasada++) {
      const resumen = await trabajos.encolarReconciliaciones(ahora);
      expect(resumen.empresas).toBe(tope);
      expect(resumen.encoladas).toBe(Math.min(tope, CANTIDAD - acumuladas));
      acumuladas += resumen.encoladas;
      expect((await reconciliadas()).length).toBe(acumuladas);
    }
    // Tres pasadas ya alcanzaron: todas tienen su reconciliación, y una sola.
    expect(acumuladas).toBe(CANTIDAD);
    const filas = await reconciliadas();
    expect(filas.map((f) => f.empresa_id).sort()).toEqual([...empresas].sort());
    expect(filas.every((f) => f.n === "1")).toBe(true);
    // Una cuarta pasada en la misma hora no encola nada nuevo.
    const cuarta = await trabajos.encolarReconciliaciones(ahora);
    expect(cuarta.encoladas).toBe(0);
    expect((await reconciliadas()).length).toBe(CANTIDAD);
  });
});
