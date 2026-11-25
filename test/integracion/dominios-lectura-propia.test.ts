import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { crearLecturaDeHostsPropios, type HostsPropiosDb } from "../../src/modulos/marcas/publico";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import {
  comoAdminDePlataforma as comoAdmin,
  crearCasosDeDominios,
  crearEntornoDeDominios,
} from "./dominios-apoyo";
import {
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearDominio, crearDominioDeEmpresa, crearMarca, hostAlAzar } from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * 0095 contra Postgres real con los roles reales (P2 del plan de dominio propio): la aplicación lee los dominios ACTIVOS de SU empresa y nada más (ni los de otra, ni los pendientes,
 * verificados o retirados, ni columnas no otorgadas; sin contexto o con la firma inválida, ninguno), el rol público no cambia y un host vigente por (empresa, superficie) se impone en la base y
 * en el caso de uso, también con dos pedidos a la vez. Base propia.
 */

const base = inject("baseDePruebas");

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)(
  "dominios de empresa: lectura propia y un host por superficie (0095)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: TransaccionesDePostgres<TxDePrueba>;
    let entornoDeDominios: ReturnType<typeof crearEntornoDeDominios>;
    let casos: ReturnType<typeof crearCasosDeDominios>;
    let a = "";
    let b = "";
    const h = {
      cartaA: { id: "", host: "" },
      appPendienteA: { id: "", host: "" },
      cartaRetiradaA: { id: "", host: "" },
      cartaB: { id: "", host: "" },
      deMarca: { id: "", host: "" },
    };

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entorno = crearEntornoDePrueba(propia.base);
      entornoDeDominios = crearEntornoDeDominios(propia.base, 6);
      casos = crearCasosDeDominios(entornoDeDominios);
      a = (await crearEmpresaActiva(entorno)).empresa;
      b = (await crearEmpresaActiva(entorno)).empresa;
      h.cartaRetiradaA = await crearDominioDeEmpresa(dueno, a, {
        superficie: "CARTA",
        estado: "RETIRADO",
      });
      h.cartaA = await crearDominioDeEmpresa(dueno, a, { superficie: "CARTA", estado: "ACTIVO" });
      h.appPendienteA = await crearDominioDeEmpresa(dueno, a, {
        superficie: "APP",
        estado: "PENDIENTE_VERIFICACION",
      });
      h.cartaB = await crearDominioDeEmpresa(dueno, b, { superficie: "CARTA", estado: "ACTIVO" });
      h.deMarca = await crearDominio(dueno, await crearMarca(dueno), { estado: "ACTIVO" });
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await entornoDeDominios.cerrar();
      await propia.destruir();
    });

    const hostsDeEmpresas = () => [
      h.cartaA.host,
      h.appPendienteA.host,
      h.cartaRetiradaA.host,
      h.cartaB.host,
    ];

    /** Lo que la aplicación ve de `dominio` con el contexto firmado de una empresa, limitado a los hosts de empresa de la prueba. */
    async function lecturaDeLaApp(empresa: string): Promise<string[]> {
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(empresa as never) },
        async ({ db }) => {
          const filas = await sql<{ host: string }>`select host from dominio`.execute(db);
          return { ok: true as const, valor: filas.rows.map((f) => f.host) };
        },
      );
      return exito(r).filter((x) => hostsDeEmpresas().includes(x));
    }

    describe("el lector del host propio (carta en línea)", () => {
      /** El lector real, con el rol de la app y el contexto firmado de la empresa. */
      async function hostActivo(empresa: string, superficie: "APP" | "CARTA") {
        const r = await entorno.ejecutar(
          { contexto: comoEmpresa(empresa as never) },
          async ({ db }) => {
            const lector = crearLecturaDeHostsPropios(db.withTables<HostsPropiosDb>());
            return { ok: true as const, valor: await lector.activoDe(superficie) };
          },
        );
        return exito(r);
      }

      it("devuelve el host ACTIVO de la superficie y ninguno si solo hay pendientes o retirados", async () => {
        expect(await hostActivo(a, "CARTA")).toBe(h.cartaA.host);
        expect(await hostActivo(a, "APP")).toBeNull();
      });

      it("cada empresa lee el suyo y nunca el de la otra (lo decide la base, no la consulta)", async () => {
        expect(await hostActivo(b, "CARTA")).toBe(h.cartaB.host);
        expect(await hostActivo(a, "CARTA")).not.toBe(h.cartaB.host);
      });
    });

    describe("la política dominio_app_leer_propio", () => {
      it("la empresa A ve solo sus hosts ACTIVOS: no los pendientes ni los retirados suyos, ni los de B", async () => {
        expect(await lecturaDeLaApp(a)).toEqual([h.cartaA.host]);
      });

      it("la empresa B ve solo el suyo, nunca los de A", async () => {
        expect(await lecturaDeLaApp(b)).toEqual([h.cartaB.host]);
      });

      it("una empresa sin dominios propios no ve ninguno de empresa", async () => {
        const c = (await crearEmpresaActiva(entorno)).empresa;
        expect(await lecturaDeLaApp(c)).toEqual([]);
      });

      it("sin contexto y con la firma inválida no se ve ningún host de empresa", async () => {
        for (const token of [null, "token-que-no-es-una-firma", "x.y.z"]) {
          const c = new pg.Client({ connectionString: propia.base.app });
          await c.connect();
          try {
            await c.query("begin");
            if (token !== null) await c.query("select set_config('app.ctx', $1, true)", [token]);
            const r = await c.query<{ host: string }>("select host from dominio");
            expect(
              r.rows.map((f) => f.host).filter((x) => hostsDeEmpresas().includes(x)),
              String(token),
            ).toEqual([]);
            await c.query("rollback");
          } finally {
            await c.end();
          }
        }
      });

      it("no se ve ninguna columna que no esté otorgada (titular, verificado_en, motivo, registrado_por): 42501", async () => {
        for (const columna of [
          "titular",
          "verificado_en",
          "motivo",
          "registrado_por",
          "duenio_empresa_id",
          "estado",
        ]) {
          const c = new pg.Client({ connectionString: propia.base.app });
          await c.connect();
          try {
            await expect(c.query(`select ${columna} from dominio`), columna).rejects.toMatchObject({
              code: "42501",
            });
          } finally {
            await c.end();
          }
        }
      });

      it("el rol público no cambia: sigue viendo todo ACTIVO (y solo eso) y no ve nada de más", async () => {
        const c = new pg.Client({ connectionString: propia.base.publico });
        await c.connect();
        try {
          const r = await c.query<{ host: string }>("select host from dominio");
          const vistos = r.rows.map((f) => f.host).filter((x) => hostsDeEmpresas().includes(x));
          expect(vistos.sort()).toEqual([h.cartaA.host, h.cartaB.host].sort());
        } finally {
          await c.end();
        }
      });
    });

    describe("el índice dominio_empresa_superficie_uk", () => {
      const insertar = (empresa: string, superficie: string, host: string) =>
        dueno.query(
          "insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por) values ($1, $2, $3, 'CLIENTE', 'prueba')",
          [host, superficie, empresa],
        );

      it("un segundo host vigente de la misma superficie falla; otra superficie entra", async () => {
        const e = (await crearEmpresaActiva(entorno)).empresa;
        await insertar(e, "CARTA", hostAlAzar());
        await expect(insertar(e, "CARTA", hostAlAzar())).rejects.toMatchObject({
          code: "23505",
          constraint: "dominio_empresa_superficie_uk",
        });
        await insertar(e, "APP", hostAlAzar());
      });

      it("retirar el primero libera el lugar", async () => {
        const e = (await crearEmpresaActiva(entorno)).empresa;
        const primero = await crearDominioDeEmpresa(dueno, e, {
          superficie: "APP",
          estado: "ACTIVO",
        });
        await expect(insertar(e, "APP", hostAlAzar())).rejects.toMatchObject({
          constraint: "dominio_empresa_superficie_uk",
        });
        await dueno.query(
          "update dominio set estado = 'RETIRADO', motivo = 'se fue' where id = $1",
          [primero.id],
        );
        await insertar(e, "APP", hostAlAzar());
      });

      it("dos empresas distintas pueden tener cada una el suyo de la misma superficie", () => {
        expect(h.cartaA.id).not.toBe(h.cartaB.id);
      });

      it("si se repite el MISMO host gana dominio_host_uk (es el primero en el orden de creación)", async () => {
        await expect(insertar(a, "CARTA", h.cartaA.host)).rejects.toMatchObject({
          code: "23505",
          constraint: "dominio_host_uk",
        });
      });

      it("no toca a los dominios de una marca (otro conjunto de filas)", async () => {
        const marca = await crearMarca(dueno);
        await crearDominio(dueno, marca, { superficie: "APP", estado: "ACTIVO" });
        await crearDominio(dueno, marca, { superficie: "APP", estado: "ACTIVO" });
      });
    });

    describe("el caso de uso de alta", () => {
      const alta = (empresaId: string, host: string, superficie: "APP" | "CARTA" = "CARTA") =>
        casos.agregarDominio(comoAdmin(), {
          claveDeIdempotencia: claveAlAzar(),
          host,
          superficie,
          titular: "CLIENTE",
          esCanonico: false,
          duenio: { tipo: "EMPRESA", empresaId },
        });

      it("concurrencia: dos hosts distintos de la misma empresa y superficie a la vez dejan UNO y el otro recibe el error de negocio", async () => {
        const e = (await crearEmpresaActiva(entorno)).empresa;
        const [x, y] = await Promise.all([alta(e, hostAlAzar()), alta(e, hostAlAzar())]);
        expect([x.ok, y.ok].sort()).toEqual([false, true]);
        expect(x.ok ? y : x).toEqual({
          ok: false,
          error: "EMPRESA_YA_TIENE_HOST_DE_ESA_SUPERFICIE",
        });
        const filas = await dueno.query(
          "select count(*)::int as n from dominio where duenio_empresa_id = $1 and estado <> 'RETIRADO'",
          [e],
        );
        expect((filas.rows[0] as { n: number }).n).toBe(1);
      });

      it("dos empresas distintas piden el mismo host a la vez: gana una y la otra recibe HOST_DUPLICADO", async () => {
        const e1 = (await crearEmpresaActiva(entorno)).empresa;
        const e2 = (await crearEmpresaActiva(entorno)).empresa;
        const host = hostAlAzar();
        const [x, y] = await Promise.all([alta(e1, host), alta(e2, host)]);
        expect([x.ok, y.ok].sort()).toEqual([false, true]);
        expect(x.ok ? y : x).toEqual({ ok: false, error: "HOST_DUPLICADO" });
      });

      it("repetir el alta con la misma clave no registra otro ni falla por el índice", async () => {
        const e = (await crearEmpresaActiva(entorno)).empresa;
        const pedido = {
          claveDeIdempotencia: claveAlAzar(),
          host: hostAlAzar(),
          superficie: "APP" as const,
          titular: "CLIENTE" as const,
          esCanonico: false,
          duenio: { tipo: "EMPRESA" as const, empresaId: e },
        };
        const primero = exito(await casos.agregarDominio(comoAdmin(), pedido));
        const segundo = exito(await casos.agregarDominio(comoAdmin(), pedido));
        expect(segundo).toMatchObject({ dominioId: primero.dominioId, yaExistia: true });
      });

      it("el mismo host repetido por la misma empresa con otra clave sigue siendo HOST_DUPLICADO (no el error nuevo)", async () => {
        const r = await alta(a, h.cartaA.host);
        expect(r).toEqual({ ok: false, error: "HOST_DUPLICADO" });
      });
    });
  },
);
