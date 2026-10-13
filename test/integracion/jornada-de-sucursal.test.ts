import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeEmpresas,
  crearConsultasDeEmpresas,
  datosDeJornada,
  type CasosDeUsoDeEmpresas,
  type ConsultasDeEmpresas,
} from "../../src/modulos/empresas/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../src/primitivas/tiempo/fecha-de-negocio";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, sucursalDe } from "./fixtures-identidad";

/**
 * Tramo previo común: la hora de corte de la jornada de la sucursal. `editarSucursal` con
 * `horaDeCorte` (opcional), `datosDeJornada` (puerto de empresas para caja, stock y ventas) y que
 * `fechaDeNegocio` de TypeScript dé lo mismo que la fórmula de la base
 * (`((instante AT TIME ZONE zona) - corte)::date`), que es la que usarán los disparadores de sello.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });
const RONDAS = 8;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;

describe.skipIf(base === null)("jornada de la sucursal: hora de corte y datosDeJornada", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let casos: CasosDeUsoDeEmpresas;
  let consultas: ConsultasDeEmpresas;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12, (tx) => gancho(tx, () => barrera()));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    casos = crearCasosDeUsoDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
    consultas = crearConsultasDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;

  type Escenario = Readonly<{
    empresa: EmpresaId;
    sucursal: SucursalId;
    ctx: ContextoOperativo;
  }>;
  const escenario = async (rol: "GERENTE" | "OPERADOR" = "GERENTE"): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno);
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol);
    return {
      empresa: e.empresa,
      sucursal: sucursalId(await sucursalDe(dueno, e.empresa)),
      ctx: comoEmpresa(e.empresa, personaId(p.id)),
    };
  };
  const corteEnLaBase = async (sucursal: string) =>
    (
      await filas<{ c: string }>("select hora_de_corte::text as c from sucursal where id = $1", [
        sucursal,
      ])
    )[0]?.c;
  const versionEnLaBase = async (sucursal: string) =>
    (await filas<{ v: number }>("select version as v from sucursal where id = $1", [sucursal]))[0]
      ?.v;
  const auditoria = (empresa: string) =>
    filas(
      `select actor_persona_id, entidad_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and accion = 'SUCURSAL_EDITADA' order by id`,
      [empresa],
    );
  const jornadaDe = async (ctx: ContextoOperativo, sucursal: SucursalId) => {
    const r = await entorno.ejecutar({ contexto: ctx }, async (tx) => {
      const datos = await datosDeJornada(tx, sucursal);
      return datos.ok ? ok(datos.valor) : err(datos.error);
    });
    return r;
  };

  describe("editarSucursal con horaDeCorte", () => {
    it("una sucursal nace con corte 00:00; el gerente lo cambia, sube la versión y audita el antes y el después", async () => {
      const e = await escenario();
      expect(await corteEnLaBase(e.sucursal)).toBe("00:00:00");
      const r = await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "04:30",
      });
      expect(r).toEqual({ ok: true, valor: { version: 2 } });
      expect(await corteEnLaBase(e.sucursal)).toBe("04:30:00");
      expect(await auditoria(e.empresa)).toEqual([
        {
          actor_persona_id: e.ctx.personaId,
          entidad_id: e.sucursal,
          antes: { horaDeCorte: "00:00" },
          despues: { horaDeCorte: "04:30" },
        },
      ]);
    });

    it("nombre y corte a la vez: un solo cambio de versión y una sola auditoría con los dos campos", async () => {
      const e = await escenario();
      const r = await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Matriz",
        horaDeCorte: "06:00",
      });
      expect(r).toEqual({ ok: true, valor: { version: 2 } });
      expect(await auditoria(e.empresa)).toMatchObject([
        {
          antes: { nombre: "Casa central", horaDeCorte: "00:00" },
          despues: { nombre: "Matriz", horaDeCorte: "06:00" },
        },
      ]);
    });

    it("sin horaDeCorte no se toca el corte (renombrar conserva el que había)", async () => {
      const e = await escenario();
      await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "03:00",
      });
      const r = await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 2,
        nombre: "Matriz",
      });
      expect(r).toEqual({ ok: true, valor: { version: 3 } });
      expect(await corteEnLaBase(e.sucursal)).toBe("03:00:00");
      // Y esa edición audita solo el nombre.
      expect((await auditoria(e.empresa)).at(-1)).toMatchObject({
        antes: { nombre: "Casa central" },
        despues: { nombre: "Matriz" },
      });
    });

    it("idempotente: repetir la edición ya aplicada devuelve la versión vigente, no escribe ni audita", async () => {
      const e = await escenario();
      const entrada = {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "05:00",
      };
      expect(await casos.editarSucursal(e.ctx, entrada)).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      // La pantalla no supo que ya se aplicó y repite con la versión vieja, y con la nueva.
      expect(await casos.editarSucursal(e.ctx, entrada)).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      expect(await casos.editarSucursal(e.ctx, { ...entrada, versionEsperada: 2 })).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      expect(await versionEnLaBase(e.sucursal)).toBe(2);
      expect(await auditoria(e.empresa)).toHaveLength(1);
    });

    it("volver a 00:00 es un cambio como cualquier otro", async () => {
      const e = await escenario();
      await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "05:00",
      });
      const r = await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 2,
        nombre: "Casa central",
        horaDeCorte: "00:00",
      });
      expect(r).toEqual({ ok: true, valor: { version: 3 } });
      expect(await corteEnLaBase(e.sucursal)).toBe("00:00:00");
    });

    it("con una versión desactualizada da VERSION_DESACTUALIZADA y no cambia el corte", async () => {
      const e = await escenario();
      await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "05:00",
      });
      expect(
        await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Casa central",
          horaDeCorte: "07:00",
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(await corteEnLaBase(e.sucursal)).toBe("05:00:00");
    });

    it.each(["", "4:00", "24:00", "23:60", "04:00:00", "04:30 ", "mediodía"])(
      "un corte inválido (%j) da HORA_DE_CORTE_INVALIDA y no escribe nada",
      async (horaDeCorte) => {
        const e = await escenario();
        expect(
          await casos.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 1,
            nombre: "Casa central",
            horaDeCorte,
          }),
        ).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
        expect(await corteEnLaBase(e.sucursal)).toBe("00:00:00");
        expect(await versionEnLaBase(e.sucursal)).toBe(1);
        expect(await auditoria(e.empresa)).toEqual([]);
      },
    );

    it("el operador no puede (SIN_PERMISO) y el corte no cambia", async () => {
      const e = await escenario("OPERADOR");
      expect(
        await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Casa central",
          horaDeCorte: "04:00",
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await corteEnLaBase(e.sucursal)).toBe("00:00:00");
    });

    it("la sucursal de otra empresa da SUCURSAL_NO_ENCONTRADA y su corte no cambia", async () => {
      const mia = await escenario();
      const ajena = await escenario();
      expect(
        await casos.editarSucursal(mia.ctx, {
          sucursalId: ajena.sucursal,
          versionEsperada: 1,
          nombre: "Casa central",
          horaDeCorte: "04:00",
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      expect(await corteEnLaBase(ajena.sucursal)).toBe("00:00:00");
    });

    it("atomicidad: si la auditoría falla, el corte vuelve a como estaba", async () => {
      const e = await escenario();
      const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
        ...tx,
        auditoria: {
          registrar: () => Promise.reject(new Error("falla forzada de la auditoría")),
        },
      }));
      try {
        const roto = crearCasosDeUsoDeEmpresas({ transacciones: falla, reglas: REGLAS_DE_EMPRESA });
        await expect(
          roto.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 1,
            nombre: "Casa central",
            horaDeCorte: "04:00",
          }),
        ).rejects.toThrow("falla forzada de la auditoría");
        expect(await corteEnLaBase(e.sucursal)).toBe("00:00:00");
        expect(await versionEnLaBase(e.sucursal)).toBe(1);
      } finally {
        await falla.cerrar();
      }
    });

    it("las consultas muestran la hora de corte de cada sucursal", async () => {
      const e = await escenario();
      await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "05:15",
      });
      const ficha = await consultas.fichaDeSucursal(e.ctx, { sucursalId: e.sucursal });
      expect(ficha).toMatchObject({ ok: true, valor: { horaDeCorte: "05:15", version: 2 } });
      const lista = await consultas.listarSucursales(e.ctx, { incluirInactivas: false });
      expect(lista).toMatchObject({ ok: true, valor: [{ id: e.sucursal, horaDeCorte: "05:15" }] });
    });

    it("la base rechaza una hora de corte con segundos o '24:00' aunque el dominio no la frene (red de seguridad)", async () => {
      const e = await escenario();
      const r = await entorno.ejecutar({ contexto: e.ctx }, async (tx) => {
        await tx.sucursales.editar(e.sucursal, 1, { horaDeCorte: "24:00" as never });
        return ok(null);
      });
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "sucursal_hora_de_corte_ck" },
      });
    });
  });

  describe("datosDeJornada", () => {
    it("devuelve la zona de la empresa y el corte de la sucursal, y refleja un cambio de corte de inmediato", async () => {
      const e = await escenario();
      expect(await jornadaDe(e.ctx, e.sucursal)).toEqual({
        ok: true,
        valor: { zonaHoraria: "America/Argentina/Buenos_Aires", horaDeCorte: "00:00" },
      });
      await casos.editarSucursal(e.ctx, {
        sucursalId: e.sucursal,
        versionEsperada: 1,
        nombre: "Casa central",
        horaDeCorte: "06:00",
      });
      await dueno.query("update empresa set zona_horaria = 'America/Montevideo' where id = $1", [
        e.empresa,
      ]);
      expect(await jornadaDe(e.ctx, e.sucursal)).toEqual({
        ok: true,
        valor: { zonaHoraria: "America/Montevideo", horaDeCorte: "06:00" },
      });
    });

    it("cada sucursal tiene su propio corte, con la zona de la misma empresa", async () => {
      const e = await escenario();
      const otra = await casos.crearSucursal(e.ctx, { nombre: "Local 2" });
      if (!otra.ok) throw new Error("no se pudo crear la sucursal");
      await casos.editarSucursal(e.ctx, {
        sucursalId: otra.valor.sucursalId,
        versionEsperada: 1,
        nombre: "Local 2",
        horaDeCorte: "04:00",
      });
      expect(await jornadaDe(e.ctx, e.sucursal)).toMatchObject({
        ok: true,
        valor: { horaDeCorte: "00:00" },
      });
      expect(await jornadaDe(e.ctx, otra.valor.sucursalId)).toMatchObject({
        ok: true,
        valor: { horaDeCorte: "04:00" },
      });
    });

    it("una sucursal que no existe, un texto que no es un id o la de otra empresa dan SUCURSAL_NO_ENCONTRADA", async () => {
      const mia = await escenario();
      const ajena = await escenario();
      const noEncontrada = { ok: false, error: "SUCURSAL_NO_ENCONTRADA" };
      expect(await jornadaDe(mia.ctx, ajena.sucursal)).toEqual(noEncontrada);
      expect(await jornadaDe(mia.ctx, sucursalId("no-es-un-uuid"))).toEqual(noEncontrada);
      expect(await jornadaDe(mia.ctx, sucursalId("11111111-1111-4111-8111-111111111111"))).toEqual(
        noEncontrada,
      );
    });

    it("lee en la transacción en curso: ve el cambio de corte que esa misma transacción acaba de hacer", async () => {
      const e = await escenario();
      const r = await entorno.ejecutar({ contexto: e.ctx }, async (tx) => {
        const antes = await datosDeJornada(tx, e.sucursal);
        await tx.sucursales.editar(e.sucursal, 1, { horaDeCorte: "02:00" as never });
        const despues = await datosDeJornada(tx, e.sucursal);
        return ok({ antes, despues });
      });
      expect(r).toMatchObject({
        ok: true,
        valor: {
          antes: { ok: true, valor: { horaDeCorte: "00:00" } },
          despues: { ok: true, valor: { horaDeCorte: "02:00" } },
        },
      });
    });
  });

  describe("la fecha de negocio de TypeScript da lo mismo que la fórmula de la base", () => {
    it("en miles de instantes, zonas (con medias horas y horario de verano) y cortes, incluidos los bordes del corte", async () => {
      const zonas = [
        "America/Argentina/Buenos_Aires",
        "UTC",
        "Asia/Kolkata",
        "Pacific/Auckland",
        "America/New_York",
        "Europe/Madrid",
      ];
      const cortes = ["00:00", "00:01", "03:30", "04:00", "05:45", "12:00", "23:59"];
      // Generador congruencial fijo: la misma tanda en cada corrida (sin azar).
      let estado = 20_261_013;
      const siguiente = (tope: number) => {
        estado = (estado * 1_103_515_245 + 12_345) % 2_147_483_648;
        return estado % tope;
      };
      const instantes: Date[] = [];
      const zs: string[] = [];
      const cs: string[] = [];
      const inicio = Date.parse("2020-01-01T00:00:00Z");
      const rango = Date.parse("2031-01-01T00:00:00Z") - inicio;
      for (let i = 0; i < 3_000; i += 1) {
        instantes.push(new Date(inicio + siguiente(rango)));
        zs.push(zonas[siguiente(zonas.length)] as string);
        cs.push(cortes[siguiente(cortes.length)] as string);
      }
      // Los bordes: el minuto exacto del corte, uno antes y uno después, en cada zona y corte.
      for (const z of zonas) {
        for (const c of cortes) {
          const [h, m] = c.split(":").map(Number) as [number, number];
          for (const delta of [-1, 0, 1]) {
            // El instante UTC que en esa zona es «2026-10-13 <corte> + delta minutos» (se busca por
            // aproximación: se parte de UTC y se corrige con el desfase que reporta Intl).
            const aprox = Date.UTC(2026, 9, 13, h, m + delta);
            const partes = new Intl.DateTimeFormat("en-US", {
              timeZone: z,
              hourCycle: "h23",
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "numeric",
            }).formatToParts(new Date(aprox));
            const n = (t: string) => Number(partes.find((p) => p.type === t)?.value);
            const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
            instantes.push(new Date(aprox - (local - aprox)));
            zs.push(z);
            cs.push(c);
          }
        }
      }
      const enBase = await filas<{ i: number; f: string }>(
        `select t.i::int as i, ((t.instante AT TIME ZONE t.zona) - t.corte::time::interval)::date::text as f
           from unnest($1::timestamptz[], $2::text[], $3::text[]) with ordinality as t(instante, zona, corte, i)
          order by t.i`,
        [instantes.map((d) => d.toISOString()), zs, cs],
      );
      expect(enBase).toHaveLength(instantes.length);
      const distintos: string[] = [];
      for (const [indice, fila] of enBase.entries()) {
        const ts = fechaDeNegocio(
          instantes[indice] as Date,
          zs[indice] as string,
          cs[indice] as string,
        );
        if (!ts.ok || ts.valor !== fila.f) {
          distintos.push(
            `${instantes[indice]?.toISOString()} ${zs[indice]} corte ${cs[indice]}: TS ${JSON.stringify(ts)} vs base ${fila.f}`,
          );
        }
      }
      expect(distintos).toEqual([]);
    });
  });

  describe("concurrencia", () => {
    const ronda = (participantes: number) => {
      barrera = crearBarrera(participantes);
      gancho = (tx, esperar) => {
        let primera = true;
        const original = tx.autorizacion;
        return {
          ...tx,
          autorizacion: {
            ...original,
            delActor: async (contexto) => {
              const r = await original.delActor(contexto);
              if (primera) {
                primera = false;
                await esperar();
              }
              return r;
            },
          },
        };
      };
    };

    it("J1: dos ediciones del corte con la misma versión y valores distintos: gana una, la otra da VERSION_DESACTUALIZADA", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        ronda(2);
        const base = { sucursalId: e.sucursal, versionEsperada: 1, nombre: "Casa central" };
        const [x, y] = await Promise.all([
          casos.editarSucursal(e.ctx, { ...base, horaDeCorte: "04:00" }),
          casos.editarSucursal(e.ctx, { ...base, horaDeCorte: "05:00" }),
        ]);
        expect([x.ok, y.ok].sort(), `ronda ${n}`).toEqual([false, true]);
        expect(x.ok ? y : x, `ronda ${n}`).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
        expect(await corteEnLaBase(e.sucursal), `ronda ${n}`).toBe(x.ok ? "04:00:00" : "05:00:00");
        expect(await versionEnLaBase(e.sucursal)).toBe(2);
        expect(await auditoria(e.empresa)).toHaveLength(1);
      }
    });

    it("J2: dos ediciones al mismo corte: las dos terminan bien y se escribe una vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        ronda(2);
        const entrada = {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Casa central",
          horaDeCorte: "06:00",
        };
        const [x, y] = await Promise.all([
          casos.editarSucursal(e.ctx, entrada),
          casos.editarSucursal(e.ctx, entrada),
        ]);
        expect([x, y], `ronda ${n}`).toEqual([
          { ok: true, valor: { version: 2 } },
          { ok: true, valor: { version: 2 } },
        ]);
        expect(await versionEnLaBase(e.sucursal)).toBe(2);
        expect(await auditoria(e.empresa)).toHaveLength(1);
      }
    });

    it("J3: cambiar el corte a la vez que alguien lo lee: la lectura ve el corte viejo o el nuevo (nunca un error ni un valor mezclado) y después rige el nuevo", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        ronda(2);
        const [edicion, lectura] = await Promise.all([
          casos.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 1,
            nombre: "Casa central",
            horaDeCorte: "04:00",
          }),
          entorno.ejecutar({ contexto: e.ctx }, async (tx) => {
            await tx.autorizacion.delActor(e.ctx);
            const datos = await datosDeJornada(tx, e.sucursal);
            return datos.ok ? ok(datos.valor) : err(datos.error);
          }),
        ]);
        expect(edicion, `ronda ${n}`).toEqual({ ok: true, valor: { version: 2 } });
        expect(lectura.ok, `ronda ${n}`).toBe(true);
        if (lectura.ok) {
          expect(lectura.valor.zonaHoraria).toBe("America/Argentina/Buenos_Aires");
          expect(["00:00", "04:00"]).toContain(lectura.valor.horaDeCorte);
        }
        expect(await jornadaDe(e.ctx, e.sucursal), `ronda ${n}`).toMatchObject({
          ok: true,
          valor: { horaDeCorte: "04:00" },
        });
      }
    });
  });
});
