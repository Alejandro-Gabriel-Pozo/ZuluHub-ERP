import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { ConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import {
  clave,
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeMarcasYPlanes,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

vi.mock("server-only", () => ({}));

/** Lo que la consola ve de «quién pide»: el rol, y el acceso armado con los casos y consultas REALES (contra Postgres) ligados al actor. */
const sesion = vi.hoisted<{ acceso: unknown; rol: "ADMIN" | "SOPORTE" }>(() => ({
  acceso: null,
  rol: "ADMIN",
}));
vi.mock("../../apps/plataforma/servidor/acceso", () => ({
  exigirAcceso: () => Promise.resolve(sesion.acceso),
}));

import { definirPoliticaDeConsola } from "../../apps/plataforma/servidor/acciones-politica";
import { politicaDeCambioDePlan } from "../../apps/plataforma/servidor/politica";

/**
 * La acción «definir política» y la lectura de la consola de plataforma contra Postgres real: es OTRA puerta (la del navegador) sobre los casos de H-14a, que ya se prueban a nivel del caso en
 * `politica-de-cambio-casos-de-uso.test.ts` y `politica-de-cambio-concurrencia.test.ts`. Acá: el mismo pedido llegando dos veces (clic doble, reintento), dos personas definiendo desde la misma versión,
 * un rol sin permiso y una entrada inválida, siempre sin dejar versiones ni constancias de más. Base propia. La política es de toda la plataforma: no hay datos de un cliente que aislar.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "política de cambio de plan: la acción de la consola, contra Postgres",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
    let casos: CasosDeUsoDeMarcasYPlanes;
    let consultas: ConsultasDeMarcasYPlanes;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entorno = crearEntornoDeMarcasYPlanes(propia.base, 8);
      casos = crearCasosDeMarcasYPlanes(entorno);
      consultas = crearConsultasDeMarcasYPlanesDePrueba(entorno);
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const contexto = (): ContextoDePlataforma =>
      sesion.rol === "ADMIN" ? comoAdminAhora() : comoSoporteAhora();
    beforeEach(() => {
      sesion.rol = "ADMIN";
      sesion.acceso = {
        admin: { rol: sesion.rol },
        casos: {
          definirPoliticaDeCambioDePlan: (entrada: never) =>
            casos.definirPoliticaDeCambioDePlan(contexto(), entrada),
        },
        consultas: {
          verPoliticaDeCambioDePlan: () => consultas.verPoliticaDeCambioDePlan(contexto()),
        },
      };
    });
    /** Cambia quién pide (la acción lee el rol del acceso y los casos el actor del contexto). */
    const comoRol = (rol: "ADMIN" | "SOPORTE") => {
      sesion.rol = rol;
      (sesion.acceso as { admin: { rol: string } }).admin.rol = rol;
    };

    const versiones = () =>
      cuenta(dueno, "select max(version) as n from politica_de_cambio_de_plan");
    const constancias = (version: number) =>
      cuenta(
        dueno,
        "select count(*) as n from auditoria_plataforma where accion = 'POLITICA_DE_PLAN_DEFINIDA' and entidad_id = $1",
        [String(version)],
      );
    const pedido = (versionEsperada: number, extra: Record<string, unknown> = {}) => ({
      claveDeIdempotencia: crypto.randomUUID(),
      versionEsperada,
      diasDeAnticipacionDeSuba: 3,
      diasDeAnticipacionDeBaja: 10,
      diasDeArrepentimiento: 15,
      motivo: "Acuerdo con el dueño",
      ...extra,
    });

    it("guarda una versión nueva con una sola constancia y la lectura la devuelve primero, con el rol que puede definir", async () => {
      const antes = await versiones();
      const r = await definirPoliticaDeConsola(pedido(antes));
      expect(r).toEqual({ ok: true, dato: { version: antes + 1 } });
      expect(await constancias(antes + 1)).toBe(1);
      const lectura = await politicaDeCambioDePlan();
      expect(lectura).toMatchObject({
        ok: true,
        puedeDefinir: true,
        vigente: { version: antes + 1, suba: 3, baja: 10, arrepentimiento: 15 },
      });
      expect(lectura.ok ? lectura.historial.map((v) => v.version) : []).toEqual(
        Array.from({ length: antes + 1 }, (_, i) => antes + 1 - i),
      );
    });

    it("idempotencia: el mismo pedido dos veces (reintento) deja UNA versión y UNA constancia, y devuelve lo mismo", async () => {
      const antes = await versiones();
      const unico = pedido(antes);
      const primera = await definirPoliticaDeConsola(unico);
      const segunda = await definirPoliticaDeConsola(unico);
      expect(primera).toEqual({ ok: true, dato: { version: antes + 1 } });
      expect(segunda).toEqual(primera);
      expect(await versiones()).toBe(antes + 1);
      expect(await constancias(antes + 1)).toBe(1);
    });

    it("idempotencia: el mismo pedido llegando a la vez (clic doble) deja UNA versión y UNA constancia", async () => {
      const antes = await versiones();
      const unico = pedido(antes);
      const [a, b, c] = await Promise.all([
        definirPoliticaDeConsola(unico),
        definirPoliticaDeConsola(unico),
        definirPoliticaDeConsola(unico),
      ]);
      expect(a).toEqual({ ok: true, dato: { version: antes + 1 } });
      expect(b).toEqual(a);
      expect(c).toEqual(a);
      expect(await versiones()).toBe(antes + 1);
      expect(await constancias(antes + 1)).toBe(1);
    });

    it("concurrencia: dos personas definen a la vez desde la MISMA versión (claves distintas): una gana y la otra ve el aviso de que cambió", async () => {
      const antes = await versiones();
      const resultados = await Promise.all([
        definirPoliticaDeConsola(pedido(antes, { motivo: "Primera" })),
        definirPoliticaDeConsola(pedido(antes, { motivo: "Segunda" })),
      ]);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = resultados.find((r) => !r.ok);
      expect(perdedora).toMatchObject({
        ok: false,
        error: {
          tipo: "PANTALLA_VIEJA",
          texto: "Otra persona cambió la política mientras tanto. Volvé a cargarla.",
        },
      });
      expect(await versiones()).toBe(antes + 1);
      expect(await constancias(antes + 1)).toBe(1);
    });

    it("concurrencia: seis a la vez desde la misma versión dejan exactamente una nueva", async () => {
      const antes = await versiones();
      const resultados = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          definirPoliticaDeConsola(pedido(antes, { motivo: `Intento ${String(i)}` })),
        ),
      );
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(await versiones()).toBe(antes + 1);
    });

    it("tras perder, repetir con la versión nueva y otra clave es otro intento válido (se ve la que ganó y se define encima)", async () => {
      const antes = await versiones();
      await definirPoliticaDeConsola(pedido(antes));
      const perdido = await definirPoliticaDeConsola(pedido(antes));
      expect(perdido).toMatchObject({ ok: false, error: { tipo: "PANTALLA_VIEJA" } });
      const lectura = await politicaDeCambioDePlan();
      const vista = lectura.ok ? lectura.vigente.version : -1;
      expect(await definirPoliticaDeConsola(pedido(vista))).toEqual({
        ok: true,
        dato: { version: vista + 1 },
      });
    });

    it("autorización: un SOPORTE no define (se oculta la acción), no escribe nada, y su lectura no ofrece definir", async () => {
      comoRol("SOPORTE");
      const antes = await huellaDeEscrituras(dueno);
      const version = await versiones();
      const r = await definirPoliticaDeConsola(pedido(version));
      expect(r).toEqual({ ok: false, error: { tipo: "OCULTAR_ACCION" } });
      expect(await versiones()).toBe(version);
      expect(await constancias(version + 1)).toBe(0);
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(await politicaDeCambioDePlan()).toMatchObject({ ok: true, puedeDefinir: false });
    });

    it.each([
      ["días fuera del tope", { diasDeAnticipacionDeSuba: 366 }, "DIAS"],
      ["días negativos", { diasDeAnticipacionDeBaja: -1 }, "DIAS"],
      ["motivo vacío", { motivo: "   " }, "MOTIVO"],
      ["motivo de 501", { motivo: "a".repeat(501) }, "MOTIVO"],
    ])(
      "validación del servidor: %s se rechaza con su texto y sin escribir",
      async (_n, extra, que) => {
        const version = await versiones();
        const r = await definirPoliticaDeConsola(pedido(version, extra));
        expect(r).toMatchObject({
          ok: false,
          error:
            que === "DIAS"
              ? { tipo: "GENERAL", texto: "Ingresá un número entero de días entre 0 y 365." }
              : { tipo: "CAMPO", campo: "motivo" },
        });
        expect(await versiones()).toBe(version);
      },
    );

    it("una entrada con forma inválida (clave que no es UUID, versión 0) ni llega a los casos", async () => {
      const version = await versiones();
      for (const mala of [{ claveDeIdempotencia: clave() }, { versionEsperada: 0 }]) {
        expect(await definirPoliticaDeConsola(pedido(version, mala))).toMatchObject({
          ok: false,
          error: { tipo: "GENERAL" },
        });
      }
      expect(await versiones()).toBe(version);
    });
  },
);
