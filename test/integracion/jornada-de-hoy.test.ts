import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  armarCierre,
  crearJornada,
  crearMundoDeCierre,
  otraSucursal,
  type Mundo,
  type OpcionesDeMundo,
} from "./cierre-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { ahoraDeLaCorrida } from "./reloj-de-la-corrida";

/**
 * X1 del mostrador mínimo: `jornadaDeHoy` contra una base real, con el contexto firmado de cada rol (el dueño de la base solo arma el
 * escenario y mira). Cubre autorización por rol y por módulo, alcance de sucursal, aislamiento entre empresas, la fecha de negocio en la
 * zona de Argentina (instantes fijos en los bordes; el reloj de la corrida, sin cruzar la medianoche, para el «hoy» a secas), lectura pura
 * (idempotente: no crea la jornada ni escribe) y lecturas simultáneas. La cuenta de la fecha se prueba además sin base en
 * `src/modulos/cierre/consultas/jornada-de-hoy.test.ts`.
 */

const base = inject("baseDePruebas");
const LIMITE_EN_MS = 60_000;

/** El día de Argentina (UTC-3, sin horario de verano) de un instante, calculado por fuera del código bajo prueba. */
const diaDeArgentina = (instante: Date): string =>
  new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

describe.skipIf(base === null)(
  "jornadaDeHoy contra una base real",
  { timeout: LIMITE_EN_MS },
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let cierre: ReturnType<typeof armarCierre>;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 8);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      cierre = armarCierre(entorno, []);
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    const mundo = (opciones: OpcionesDeMundo = {}) => crearMundoDeCierre(entorno, dueno, opciones);
    const en = (m: Mundo, instante: Date): ContextoOperativo => ({ ...m.ctx(), ahora: instante });
    const pedir = (m: Mundo, instante: Date = ahoraDeLaCorrida(), sucursal: string = m.sucursal) =>
      cierre.consultas.jornadaDeHoy(en(m, instante), { sucursalId: sucursal });
    const jornadas = async (m: Mundo) =>
      Number(
        (
          await dueno.query<{ n: string }>(
            "select count(*) as n from jornada_de_sucursal where empresa_id = $1",
            [m.empresa],
          )
        ).rows[0]?.n,
      );

    it("hoy es el día de Argentina: sin actividad todavía es SIN_ACTIVIDAD y no se crea ninguna jornada", async () => {
      const m = await mundo();
      const ahora = ahoraDeLaCorrida();
      const esperado = {
        ok: true,
        valor: { fechaDeNegocio: diaDeArgentina(ahora), estado: "SIN_ACTIVIDAD" },
      };
      expect(await pedir(m, ahora)).toEqual(esperado);
      expect(await pedir(m, ahora)).toEqual(esperado);
      expect(await jornadas(m)).toBe(0);
    });

    it("con la jornada de hoy abierta, en auditoría y cerrada devuelve cada estado; solo mira la fecha de hoy", async () => {
      const m = await mundo();
      const ahora = ahoraDeLaCorrida();
      const hoy = diaDeArgentina(ahora);
      const ayer = diaDeArgentina(new Date(ahora.getTime() - 86_400_000));
      await crearJornada(dueno, m, ayer);
      // La de ayer existe, la de hoy no: hoy sigue sin actividad.
      expect(await pedir(m, ahora)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: hoy, estado: "SIN_ACTIVIDAD" },
      });
      await crearJornada(dueno, m, hoy);
      expect(await pedir(m, ahora)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: hoy, estado: "ABIERTA" },
      });
      const entrada = { sucursalId: m.sucursal, fechaDeNegocio: hoy };
      const iniciada = await cierre.casos.iniciarAuditoria(m.ctx(), entrada);
      expect(iniciada.ok, JSON.stringify(iniciada)).toBe(true);
      expect(await pedir(m, ahora)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: hoy, estado: "EN_AUDITORIA" },
      });
      const cerrada = await cierre.casos.cerrarJornada(m.ctx(), {
        ...entrada,
        huellaVista: (
          (await cierre.consultas.controlesDeLaJornada(m.ctx(), entrada)) as {
            valor: { huella: string };
          }
        ).valor.huella,
        reconocimientos: [],
        observacion: null,
      });
      expect(cerrada.ok, JSON.stringify(cerrada)).toBe(true);
      expect(await pedir(m, ahora)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: hoy, estado: "CERRADA" },
      });
    });

    it("el borde de la medianoche de Argentina (03:00 UTC) cambia la fecha y con ella el estado", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, "2026-11-09");
      const antes = new Date("2026-11-10T02:59:59Z");
      const despues = new Date("2026-11-10T03:00:00Z");
      expect(await pedir(m, antes)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: "2026-11-09", estado: "ABIERTA" },
      });
      expect(await pedir(m, despues)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: "2026-11-10", estado: "SIN_ACTIVIDAD" },
      });
    });

    it("la hora de corte de la sucursal se lee ahora, sin caché: un corte cambiado antes de pedir ya rige", async () => {
      const m = await mundo();
      const instante = new Date("2026-11-10T05:30:00Z"); // 02:30 en Argentina
      expect(await pedir(m, instante)).toMatchObject({ valor: { fechaDeNegocio: "2026-11-10" } });
      await dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [m.sucursal]);
      expect(await pedir(m, instante)).toMatchObject({ valor: { fechaDeNegocio: "2026-11-09" } });
    });

    it("la zona de la empresa decide el día: la misma hora UTC da otro día con otra zona", async () => {
      const m = await mundo();
      const instante = new Date("2026-11-10T02:00:00Z"); // 23:00 del 9 en Argentina; 11:00 del 10 en Tokio
      expect(await pedir(m, instante)).toMatchObject({ valor: { fechaDeNegocio: "2026-11-09" } });
      await dueno.query("update empresa set zona_horaria = 'Asia/Tokyo' where id = $1", [
        m.empresa,
      ]);
      expect(await pedir(m, instante)).toMatchObject({ valor: { fechaDeNegocio: "2026-11-10" } });
    });

    it("autorización: gerente, administrador y operador asignado pueden; el operador sin asignación no", async () => {
      for (const rol of ["GERENTE", "ADMINISTRADOR"] as const) {
        const m = await mundo({ rol });
        expect((await pedir(m)).ok, rol).toBe(true);
      }
      const asignado = await mundo({ rol: "OPERADOR", asignarALaSucursal: true });
      expect((await pedir(asignado)).ok).toBe(true);
      const sinAsignar = await mundo({ rol: "OPERADOR" });
      expect(await pedir(sinAsignar)).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    });

    it("autorización: sin persona o sin el módulo de cierre activado no hay nada", async () => {
      const m = await mundo();
      const sinPersona: ContextoOperativo = { ...m.ctx(), personaId: null };
      expect(
        await cierre.consultas.jornadaDeHoy(sinPersona, { sucursalId: m.sucursal }),
      ).toMatchObject({ ok: false });
      const sinModulo = await mundo({ plan: ["facturacion"], activados: ["facturacion"] });
      expect(await pedir(sinModulo)).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
    });

    it("aislamiento: la sucursal de otra empresa no se ve, ni su fecha ni su estado, aunque tenga jornada; el gerente de una no ve la otra", async () => {
      const a = await mundo();
      const b = await mundo();
      const ahora = ahoraDeLaCorrida();
      await crearJornada(dueno, b, diaDeArgentina(ahora));
      const r = await pedir(a, ahora, b.sucursal);
      expect(r).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      expect(JSON.stringify(r)).not.toContain(b.sucursal);
      // Y la de b sigue viendo la suya.
      expect(await pedir(b, ahora)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: diaDeArgentina(ahora), estado: "ABIERTA" },
      });
      // Una segunda sucursal de la misma empresa sí se puede pedir, con su propia jornada.
      const otra = await otraSucursal(dueno, a.empresa, "Otra");
      expect(await pedir(a, ahora, otra)).toEqual({
        ok: true,
        valor: { fechaDeNegocio: diaDeArgentina(ahora), estado: "SIN_ACTIVIDAD" },
      });
    });

    it("entrada: lo que no es un uuid o no existe se rechaza igual, sin pistas", async () => {
      const m = await mundo();
      for (const mala of ["", "no-es-uuid", "00000000-0000-4000-8000-000000000000"]) {
        expect(await pedir(m, ahoraDeLaCorrida(), mala), mala).toEqual({
          ok: false,
          error: "JORNADA_NO_ENCONTRADA",
        });
      }
    });

    it("concurrencia: pedirla muchas veces a la vez, incluso mientras se crea la jornada, no rompe ni duplica nada", async () => {
      const m = await mundo();
      const ahora = ahoraDeLaCorrida();
      const hoy = diaDeArgentina(ahora);
      const lecturas = Array.from({ length: 6 }, () => pedir(m, ahora));
      const creaciones = [crearJornada(dueno, m, hoy), crearJornada(dueno, m, hoy)];
      const resultados = await Promise.all([...lecturas, ...creaciones]);
      for (const r of resultados.slice(0, 6)) {
        expect(r).toMatchObject({ ok: true, valor: { fechaDeNegocio: hoy } });
        expect(["SIN_ACTIVIDAD", "ABIERTA"]).toContain(
          (r as { valor: { estado: string } }).valor.estado,
        );
      }
      expect(await jornadas(m)).toBe(1);
      expect(await pedir(m, ahora)).toMatchObject({ valor: { estado: "ABIERTA" } });
    });
  },
);
