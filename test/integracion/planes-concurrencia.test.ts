import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import { codigoAlAzar } from "./marcas-apoyo";
import {
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Lo que la pantalla «Planes» de la consola le pide a los casos de uso cuando dos personas (o dos toques) actúan a la vez sobre el mismo plan: dos ADMIN publicando el mismo borrador, dos guardados
 * desde la misma versión, el mismo pedido llegando dos veces (doble clic, reintento) y dos altas del mismo código. Previene: dos versiones publicadas del mismo borrador, un guardado que pisa el de
 * otra persona y un plan o una constancia duplicados. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "planes de plataforma: dos acciones a la vez, contra Postgres",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
    let casos: CasosDeUsoDeMarcasYPlanes;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entorno = crearEntornoDeMarcasYPlanes(propia.base);
      casos = crearCasosDeMarcasYPlanes(entorno);
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const contar = async (consulta: string, parametros: unknown[]): Promise<number> =>
      Number((await dueno.query<{ n: number }>(consulta, parametros)).rows[0]?.n);
    const planConBorrador = async () => {
      const planId = exito(
        await casos.crearPlan(comoAdminAhora(), {
          claveDeIdempotencia: clave(),
          codigo: codigoAlAzar("c"),
        }),
      ).planId;
      exito(
        await casos.guardarBorradorDePlan(comoAdminAhora(), {
          claveDeIdempotencia: clave(),
          planId,
          versionEsperada: null,
          nombreComercial: "Básico",
          modulos: ["caja"],
          perillas: {},
        }),
      );
      return planId;
    };
    const publicar = (planId: string, claveDeIdempotencia = clave()) =>
      casos.publicarVersionDePlan(comoAdminAhora(), {
        claveDeIdempotencia,
        planId,
        motivo: "lanzamiento",
      });

    it("dos ADMIN publican el mismo borrador a la vez (claves distintas): una sola publica y la otra ve SIN_BORRADOR", async () => {
      const planId = await planConBorrador();
      const resultados = await Promise.all([publicar(planId), publicar(planId)]);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = resultados.find((r) => !r.ok);
      expect(perdedora === undefined ? null : falla(perdedora)).toBe("SIN_BORRADOR");
      expect(
        await contar(
          "select count(*)::int n from version_de_plan where plan_id = $1 and estado = 'PUBLICADA'",
          [planId],
        ),
      ).toBe(1);
      expect(
        await contar(
          "select count(*)::int n from auditoria_plataforma where accion = 'PLAN_VERSION_PUBLICADA' and entidad_id in (select id::text from version_de_plan where plan_id = $1)",
          [planId],
        ),
      ).toBe(1);
    });

    it("el mismo pedido de publicar llegando dos veces a la vez (doble clic): una versión, una constancia y el mismo número", async () => {
      const planId = await planConBorrador();
      const unica = clave();
      const [a, b] = await Promise.all([publicar(planId, unica), publicar(planId, unica)]);
      expect(exito(a)).toEqual(exito(b));
      expect(
        await contar(
          "select count(*)::int n from version_de_plan where plan_id = $1 and estado = 'PUBLICADA'",
          [planId],
        ),
      ).toBe(1);
      expect(
        await contar(
          "select count(*)::int n from auditoria_plataforma where accion = 'PLAN_VERSION_PUBLICADA' and entidad_id in (select id::text from version_de_plan where plan_id = $1)",
          [planId],
        ),
      ).toBe(1);
    });

    it("dos guardados desde la misma versión: uno gana y el otro es VERSION_DESACTUALIZADA (no se pisa el trabajo de nadie)", async () => {
      const planId = await planConBorrador();
      const fila = (
        await dueno.query(
          "select version from version_de_plan where plan_id = $1 and estado = 'BORRADOR'",
          [planId],
        )
      ).rows[0] as { version: number };
      const guardar = (nombre: string) =>
        casos.guardarBorradorDePlan(comoAdminAhora(), {
          claveDeIdempotencia: clave(),
          planId,
          versionEsperada: fila.version,
          nombreComercial: nombre,
          modulos: ["caja"],
          perillas: {},
        });
      const resultados = await Promise.all([guardar("Uno"), guardar("Otro")]);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = resultados.find((r) => !r.ok);
      expect(perdedora === undefined ? null : falla(perdedora)).toBe("VERSION_DESACTUALIZADA");
      const nombre = (
        await dueno.query(
          "select nombre_comercial from version_de_plan where plan_id = $1 and estado = 'BORRADOR'",
          [planId],
        )
      ).rows[0] as { nombre_comercial: string };
      expect(["Uno", "Otro"]).toContain(nombre.nombre_comercial);
    });

    it("el mismo guardado dos veces a la vez: un solo borrador y una sola constancia", async () => {
      const planId = exito(
        await casos.crearPlan(comoAdminAhora(), {
          claveDeIdempotencia: clave(),
          codigo: codigoAlAzar("g"),
        }),
      ).planId;
      const unica = clave();
      const guardar = () =>
        casos.guardarBorradorDePlan(comoAdminAhora(), {
          claveDeIdempotencia: unica,
          planId,
          versionEsperada: null,
          nombreComercial: "Básico",
          modulos: ["caja"],
          perillas: {},
        });
      const [a, b] = await Promise.all([guardar(), guardar()]);
      expect(exito(a)).toEqual(exito(b));
      expect(
        await contar("select count(*)::int n from version_de_plan where plan_id = $1", [planId]),
      ).toBe(1);
      expect(
        await contar(
          "select count(*)::int n from auditoria_plataforma where accion = 'PLAN_BORRADOR_GUARDADO' and entidad_id in (select id::text from version_de_plan where plan_id = $1)",
          [planId],
        ),
      ).toBe(1);
    });

    it("dos altas del mismo código a la vez: un solo plan; la que perdió dice que ya existía y no audita", async () => {
      const codigo = codigoAlAzar("d");
      const alta = () =>
        casos.crearPlan(comoAdminAhora(), { claveDeIdempotencia: clave(), codigo });
      const resultados = (await Promise.all([alta(), alta()])).map((r) => exito(r));
      expect(resultados.map((r) => r.yaExistia).sort()).toEqual([false, true]);
      expect(new Set(resultados.map((r) => r.planId)).size).toBe(1);
      expect(await contar("select count(*)::int n from plan where codigo = $1", [codigo])).toBe(1);
      expect(
        await contar(
          "select count(*)::int n from auditoria_plataforma where accion = 'PLAN_CREADO' and entidad_id = $1",
          [resultados[0]?.planId],
        ),
      ).toBe(1);
    });

    it("repetir cada acción con su clave no escribe nada más", async () => {
      const planId = await planConBorrador();
      const entrada = { claveDeIdempotencia: clave(), planId, motivo: "lanzamiento" };
      exito(await casos.publicarVersionDePlan(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      exito(await casos.publicarVersionDePlan(comoAdminAhora(), entrada));
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });
  },
);
