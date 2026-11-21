import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearRepositorioDeMovimientosDeDinero,
  huellaDelMovimientoDeDinero,
  type CajaDb,
  type RepositorioDeMovimientosDeDinero,
} from "../../src/modulos/caja/publico";
import { crearTransacciones, type SinTablas } from "../../src/adaptadores/postgres/transacciones";
import { importeATexto, importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { ok } from "../../src/primitivas/resultado/resultado";
import { sucursalId, type PersonaId } from "../../src/primitivas/identificadores/marca";
import type { Kysely } from "kysely";
import {
  CATEGORIAS_DE_SALIDA,
  LARGO_MAXIMO_DE_LA_REFERENCIA,
  LARGO_MAXIMO_DEL_CONCEPTO,
  ORIGEN_DEL_MOVIMIENTO_DE_DINERO,
  conceptoDesdeTexto,
  motivoObligatorio,
  referenciaDesdeTexto,
} from "../../src/modulos/caja/publico";
import { nombreODenominacionDesdeTexto } from "../../src/primitivas/texto/nombre-o-razon-social";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBarrera, crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { nombreUnico, sufijoUnico } from "./unicos";
import { acepta, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  HUELLA,
  abrirSesion,
  cerrarSesion,
  claveNueva,
  cobrar,
  crearCaja,
  crearEscenario,
  filaDeCobro,
  movimiento,
  textoDe,
  type Escenario,
  type TipoDeMedio,
} from "./caja-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * Migración M-1 (0091): el acto «movimiento de dinero». SQL directo con el rol de la aplicación, sobre una base propia con todas las
 * migraciones. Cada caso corre en una transacción que se deshace (`conAppDe`), salvo los de concurrencia y reversión, que confirman datos de
 * verdad. Previene: una salida sin su egreso, un ingreso que no cuadra con sus cobros, una devolución que supera lo cobrado, un egreso por
 * transferencia sin acto, y que una reversión borre actos o egresos sin avisar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ORIGEN = ORIGEN_DEL_MOVIMIENTO_DE_DINERO;
const AHORA = "2026-11-09T22:00:00Z";
const MIGRACION = "0091_movimiento_de_dinero.sql";
const REVERSION = "reversiones/0091_revertir_movimiento_de_dinero.sql";
const AISLAMIENTOS = ["read committed", "serializable"] as const;
type Aislamiento = (typeof AISLAMIENTOS)[number];

type Acto = Partial<{
  sentido: "ENTRADA" | "SALIDA";
  importe: string;
  categoria: string | null;
  concepto: string | null;
  motivo: string | null;
  terceroNombre: string | null;
  terceroPersonaId: string | null;
  referencia: string | null;
  devuelveA: string | null;
  movimientoId: string | null;
  clave: string;
  moneda: string;
}>;

describe.skipIf(base === null)("migración 0091: movimiento de dinero (SQL directo)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let esc: Escenario;
  let otra: Mundo;
  let escOtra: Escenario;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    esc = await crearEscenario(dueno, m);
    otra = await crearMundo(dueno);
    escOtra = await crearEscenario(dueno, otra);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const b = () => propia.base;

  // ---------------------------------------------------------------------------------------------
  // Apoyo
  // ---------------------------------------------------------------------------------------------
  const insertarActo = (
    s: SesionDePrueba,
    sesion: string,
    a: Acto,
    mundo: Mundo = m,
  ): Promise<Intento> =>
    s.intentar(
      `insert into movimiento_de_dinero (empresa_id, sucursal_id, sesion_id, sentido, importe, moneda, categoria, concepto, motivo,
                                         tercero_nombre, tercero_persona_id, referencia, devuelve_a, movimiento_id, clave, huella,
                                         registrado_por, registrado_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
      [
        mundo.empresa,
        mundo.sucursal,
        sesion,
        a.sentido ?? "ENTRADA",
        a.importe ?? "100.00",
        a.moneda ?? "ARS",
        a.categoria ?? null,
        a.concepto ?? null,
        a.motivo ?? null,
        a.terceroNombre ?? null,
        a.terceroPersonaId ?? null,
        a.referencia ?? null,
        a.devuelveA ?? null,
        a.movimientoId ?? null,
        a.clave ?? claveNueva(),
        HUELLA,
        mundo.persona,
        AHORA,
      ],
    );

  /** El cobro de una entrada de dinero: movimiento COBRO + su fila de `cobro` con el origen del acto. */
  const cobroDeCaja = async (
    s: SesionDePrueba,
    escenario: Escenario,
    sesion: string,
    acto: string,
    medio: TipoDeMedio,
    importe: string,
    orden: number,
  ): Promise<string> => {
    const id = textoDe(
      await movimiento(s, escenario, sesion, { clase: "COBRO", medio, importe }),
      "id",
    );
    acepta(await filaDeCobro(s, escenario, id, { id: acto, orden, tipo: ORIGEN }));
    return id;
  };

  /** Una entrada completa: el acto y sus cobros (uno por parte). */
  const entradaDeCaja = async (
    s: SesionDePrueba,
    sesion: string,
    partes: ReadonlyArray<readonly [TipoDeMedio, string]>,
    extra: Acto = {},
    mundo: Mundo = m,
    escenario: Escenario = esc,
  ): Promise<{ acto: string; cobros: string[] }> => {
    const total = partes.reduce((t, [, i]) => t + Math.round(Number(i) * 100), 0) / 100;
    const acto = textoDe(
      await insertarActo(
        s,
        sesion,
        { sentido: "ENTRADA", importe: total.toFixed(2), ...extra },
        mundo,
      ),
      "id",
    );
    const cobros: string[] = [];
    let orden = 1;
    for (const [medio, i] of partes) {
      cobros.push(await cobroDeCaja(s, escenario, sesion, acto, medio, i, orden++));
    }
    return { acto, cobros };
  };

  /** Una salida completa: el egreso manual (con el medio) y el acto. */
  const salida = async (
    s: SesionDePrueba,
    sesion: string,
    medio: TipoDeMedio,
    importe: string,
    extra: Acto = {},
  ): Promise<{ egreso: string; acto: Intento }> => {
    const egreso = textoDe(
      await movimiento(s, esc, sesion, {
        clase: "EGRESO_MANUAL",
        medio,
        importe: `-${importe}`,
        motivo: "Retiro de prueba",
      }),
      "id",
    );
    const acto = await insertarActo(s, sesion, {
      sentido: "SALIDA",
      importe,
      categoria: "GASTO_MENOR",
      motivo: "Retiro de prueba",
      movimientoId: egreso,
      ...extra,
    });
    return { egreso, acto };
  };

  /** Una sesión de caja abierta y confirmada en una caja nueva del mundo dado. */
  const sesionNueva = async (mundo: Mundo = m, escenario: Escenario = esc): Promise<string> => {
    const caja = await crearCaja(dueno, mundo, nombreUnico("Caja"));
    let sesion = "";
    await conAppDe(b(), mundo, async (s) => {
      sesion = (await abrirSesion(s, escenario, { caja })).sesion;
      expect((await s.confirmar()).ok).toBe(true);
    });
    return sesion;
  };

  const rechazo = (r: Intento, restriccion: string): void => {
    expect(r.ok, JSON.stringify(r)).toBe(false);
    if (!r.ok) expect(r.restriccion, `${r.codigo}: ${r.mensaje}`).toBe(restriccion);
  };
  const diferidas = (s: SesionDePrueba): Promise<Intento> =>
    s.directo("set constraints all immediate");

  const abrirTx = (aislamiento: Aislamiento, mundo: Mundo = m): Promise<SesionDePrueba> =>
    SesionDePrueba.abrir(
      b(),
      "pedernal_app",
      comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
      aislamiento,
    );

  /**
   * Una transacción de la aplicación con su reintento ante 40001 (como los casos de uso): devuelve «ok» o «motivo:restricción».
   * La barrera solo vale en el primer intento.
   */
  const conReintento = async (
    aislamiento: Aislamiento,
    trabajo: (s: SesionDePrueba, primerIntento: boolean) => Promise<Intento | null>,
  ): Promise<string> => {
    for (let intento = 1; ; intento++) {
      const s = await abrirTx(aislamiento);
      try {
        const r = (await trabajo(s, intento === 1)) ?? (await s.confirmar());
        if (r.ok) return "ok";
        if (r.codigo === "40001" && intento < 3) continue;
        return r.restriccion ?? r.codigo;
      } finally {
        await s.cerrar();
      }
    }
  };

  const cuenta = async (texto: string, parametros: unknown[] = []): Promise<number> =>
    Number((await dueno.query<{ n: string }>(texto, parametros)).rows[0]?.n);

  // ---------------------------------------------------------------------------------------------
  describe("estructura y privilegios (7.1)", () => {
    const ROLES = [
      "pedernal_app",
      "pedernal_grupo",
      "pedernal_trabajos",
      "pedernal_plataforma",
      "pedernal_autenticacion",
      "pedernal_publico",
      "pedernal_captacion",
    ];

    it("RLS activa y forzada; la aplicación solo inserta y lee; nadie actualiza, borra ni vacía", async () => {
      const { rows } = await dueno.query<{ activa: boolean; forzada: boolean }>(
        "select relrowsecurity as activa, relforcerowsecurity as forzada from pg_class where oid = 'public.movimiento_de_dinero'::regclass",
      );
      expect(rows[0]).toEqual({ activa: true, forzada: true });
      for (const rol of ROLES) {
        for (const privilegio of ["UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          const { rows: r } = await dueno.query<{ t: boolean }>(
            "select has_table_privilege($1, 'public.movimiento_de_dinero', $2) as t",
            [rol, privilegio],
          );
          expect(r[0]?.t, `${rol} ${privilegio}`).toBe(false);
        }
        for (const privilegio of ["UPDATE", "REFERENCES"]) {
          const { rows: r } = await dueno.query<{ c: boolean }>(
            "select has_any_column_privilege($1, 'public.movimiento_de_dinero', $2) as c",
            [rol, privilegio],
          );
          expect(r[0]?.c, `${rol} ${privilegio} por columna`).toBe(false);
        }
        const { rows: lee } = await dueno.query<{ s: boolean; i: boolean }>(
          "select has_any_column_privilege($1, 'public.movimiento_de_dinero', 'SELECT') as s, has_any_column_privilege($1, 'public.movimiento_de_dinero', 'INSERT') as i",
          [rol],
        );
        expect(lee[0], rol).toEqual(
          rol === "pedernal_app" ? { s: true, i: true } : { s: false, i: false },
        );
      }
    });

    it("ni el dueño de la base actualiza, borra ni vacía (disparadores de solo inserción)", async () => {
      const sesion = await sesionNueva();
      let acto = "";
      await conAppDe(b(), m, async (s) => {
        acto = textoDe(await insertarActo(s, sesion, { importe: "5.00" }), "id");
        expect(acto).not.toBe("");
        await cobroDeCaja(s, esc, sesion, acto, "EFECTIVO", "5.00", 1);
        expect((await s.confirmar()).ok).toBe(true);
      });
      for (const sentencia of [
        "update movimiento_de_dinero set importe = 6 where id = $1",
        "delete from movimiento_de_dinero where id = $1",
      ]) {
        await expect(dueno.query(sentencia, [acto])).rejects.toThrow();
      }
      await expect(dueno.query("truncate movimiento_de_dinero")).rejects.toThrow();
    });

    it("toda función nueva fija su search_path, ninguna es SECURITY DEFINER ni ejecutable por PUBLIC; la aplicación solo llama a las dos del tope", async () => {
      const { rows } = await dueno.query<{
        proname: string;
        fijo: boolean;
        definer: boolean;
        publica: boolean;
        app: boolean;
      }>(
        `select p.proname,
                coalesce('search_path=pg_catalog, public, pg_temp' = any (p.proconfig), false) as fijo,
                p.prosecdef as definer,
                (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) as publica,
                has_function_privilege('pedernal_app', p.oid, 'EXECUTE') as app
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('movimiento_de_dinero_bloquear_entrada', 'movimiento_de_dinero_devolvible',
                              'movimiento_de_dinero_validar_alta', 'movimiento_de_dinero_verificar_cuadre',
                              'movimiento_caja_verificar_egreso_con_acto', 'movimiento_caja_validar_alta')`,
      );
      expect(rows).toHaveLength(6);
      for (const f of rows) {
        expect(f, f.proname).toMatchObject({ fijo: true, definer: false, publica: false });
      }
      const conAcceso = rows
        .filter((f) => f.app)
        .map((f) => f.proname)
        .sort();
      expect(conAcceso).toEqual([
        "movimiento_de_dinero_bloquear_entrada",
        "movimiento_de_dinero_devolvible",
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("forma por sentido y listas (7.2)", () => {
    const sesionDeLaForma = async (): Promise<string> => sesionNueva();

    it("una entrada no admite categoría, motivo, referencia, egreso, devuelve_a ni empleado", async () => {
      const sesion = await sesionDeLaForma();
      await conAppDe(b(), m, async (s) => {
        const otroActo = textoDe(await insertarActo(s, sesion, { importe: "1.00" }), "id");
        for (const columna of [
          { categoria: "GASTO_MENOR" },
          { motivo: "Algo" },
          { referencia: "R1" },
          { movimientoId: randomUUID() },
          { devuelveA: otroActo },
          { terceroPersonaId: m.persona },
        ] as Acto[]) {
          const r = await insertarActo(s, sesion, { sentido: "ENTRADA", ...columna });
          // `devuelve_a` sin categoría también rompe `devolucion_ck`: la base elige una de las dos, las dos son la regla.
          expect(r.ok).toBe(false);
          if (!r.ok)
            expect([
              "movimiento_de_dinero_forma_ck",
              "movimiento_de_dinero_devolucion_ck",
            ]).toContain(r.restriccion);
        }
      });
    });

    it("una salida exige categoría, motivo y egreso, y no lleva concepto", async () => {
      const sesion = await sesionDeLaForma();
      await conAppDe(b(), m, async (s) => {
        const e = textoDe(
          await movimiento(s, esc, sesion, {
            clase: "EGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "-3.00",
            motivo: "Prueba",
          }),
          "id",
        );
        const salidaCon = (extra: Acto) =>
          insertarActo(s, sesion, {
            sentido: "SALIDA",
            importe: "3.00",
            categoria: "GASTO_MENOR",
            motivo: "Prueba",
            movimientoId: e,
            ...extra,
          });
        rechazo(await salidaCon({ categoria: null }), "movimiento_de_dinero_forma_ck");
        rechazo(await salidaCon({ motivo: null }), "movimiento_de_dinero_forma_ck");
        rechazo(await salidaCon({ concepto: "Algo" }), "movimiento_de_dinero_forma_ck");
        // Sin egreso, el disparador de alta responde antes que el CHECK: la salida sin egreso nunca entra.
        rechazo(await salidaCon({ movimientoId: null }), "movimiento_de_dinero_egreso_invalido");
      });
    });

    it("categoría fuera de la lista; devuelve_a sin la categoría y la categoría sin devuelve_a; tercero con nombre y empleado a la vez", async () => {
      const sesion = await sesionDeLaForma();
      await conAppDe(b(), m, async (s) => {
        const { acto } = await entradaDeCaja(s, sesion, [["EFECTIVO", "50.00"]]);
        const e = textoDe(
          await movimiento(s, esc, sesion, {
            clase: "EGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "-3.00",
            motivo: "Prueba",
          }),
          "id",
        );
        const salidaCon = (extra: Acto) =>
          insertarActo(s, sesion, {
            sentido: "SALIDA",
            importe: "3.00",
            categoria: "GASTO_MENOR",
            motivo: "Prueba",
            movimientoId: e,
            ...extra,
          });
        rechazo(await salidaCon({ categoria: "REGALO" }), "movimiento_de_dinero_categoria_ck");
        rechazo(await salidaCon({ devuelveA: acto }), "movimiento_de_dinero_devolucion_ck");
        rechazo(
          await salidaCon({ categoria: "DEVOLUCION_DE_UN_COBRO", devuelveA: null }),
          "movimiento_de_dinero_devuelve_a_invalida",
        );
        rechazo(
          await salidaCon({ terceroNombre: "Ana Pérez", terceroPersonaId: m.persona }),
          "movimiento_de_dinero_tercero_ck",
        );
      });
    });

    it("importe de 0, negativo o por encima del tope; moneda que no es ARS; clave y huella con otra forma", async () => {
      const sesion = await sesionDeLaForma();
      await conAppDe(b(), m, async (s) => {
        rechazo(
          await insertarActo(s, sesion, { importe: "0.00" }),
          "movimiento_de_dinero_importe_ck",
        );
        rechazo(
          await insertarActo(s, sesion, { importe: "-1.00" }),
          "movimiento_de_dinero_importe_ck",
        );
        rechazo(
          await insertarActo(s, sesion, { importe: "1000000000.00" }),
          "movimiento_de_dinero_importe_ck",
        );
        rechazo(await insertarActo(s, sesion, { moneda: "USD" }), "movimiento_de_dinero_moneda_ck");
        rechazo(await insertarActo(s, sesion, { clave: "corta" }), "movimiento_de_dinero_clave_ck");
        const otroSentido = await insertarActo(s, sesion, { sentido: "OTRO" as "ENTRADA" });
        expect(otroSentido.ok).toBe(false);
        if (!otroSentido.ok)
          expect(["movimiento_de_dinero_forma_ck", "movimiento_de_dinero_sentido_ck"]).toContain(
            otroSentido.restriccion,
          );
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("entrada: el cuadre al confirmar (7.4)", () => {
    it("cobros que suman justo lo que dice el acto confirman, con varios medios", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        await entradaDeCaja(
          s,
          sesion,
          [
            ["EFECTIVO", "60.00"],
            ["TARJETA_DEBITO", "40.00"],
          ],
          { concepto: "Seña de mesa" },
        );
        acepta(await diferidas(s));
      });
    });

    it("cobros que suman de menos, de más, ninguno, o con un origen sin acto → se rechaza al confirmar y no queda nada", async () => {
      const sesion = await sesionNueva();
      const antes = await cuenta("select count(*) as n from movimiento_de_dinero");
      const movimientosAntes = await cuenta(
        "select count(*) as n from movimiento_caja where sesion_id = $1",
        [sesion],
      );
      for (const parte of ["30.00", "130.00", null]) {
        const s = await abrirTx("read committed");
        try {
          const acto = textoDe(await insertarActo(s, sesion, { importe: "100.00" }), "id");
          if (parte !== null) await cobroDeCaja(s, esc, sesion, acto, "EFECTIVO", parte, 1);
          rechazo(await s.confirmar(), "movimiento_de_dinero_no_cuadra");
        } finally {
          await s.cerrar();
        }
      }
      // Un cobro con el origen del acto pero sin acto.
      const s = await abrirTx("read committed");
      try {
        await cobroDeCaja(s, esc, sesion, randomUUID(), "EFECTIVO", "10.00", 1);
        rechazo(await s.confirmar(), "movimiento_de_dinero_no_cuadra");
      } finally {
        await s.cerrar();
      }
      expect(await cuenta("select count(*) as n from movimiento_de_dinero")).toBe(antes);
      expect(
        await cuenta("select count(*) as n from movimiento_caja where sesion_id = $1", [sesion]),
      ).toBe(movimientosAntes);
    });

    it("no se agregan cobros de más a una entrada ya confirmada", async () => {
      const sesion = await sesionNueva();
      let acto = "";
      await conAppDe(b(), m, async (s) => {
        acto = (await entradaDeCaja(s, sesion, [["EFECTIVO", "20.00"]])).acto;
        expect((await s.confirmar()).ok).toBe(true);
      });
      await conAppDe(b(), m, async (s) => {
        await cobroDeCaja(s, esc, sesion, acto, "EFECTIVO", "5.00", 2);
        rechazo(await s.confirmar(), "movimiento_de_dinero_no_cuadra");
      });
    });

    it("los cobros del acto son de la sesión del acto", async () => {
      const sesionA = await sesionNueva();
      const sesionB = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const acto = textoDe(await insertarActo(s, sesionA, { importe: "10.00" }), "id");
        await cobroDeCaja(s, esc, sesionB, acto, "EFECTIVO", "10.00", 1);
        rechazo(await s.confirmar(), "movimiento_de_dinero_no_cuadra");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("salida: el egreso, el medio y la caja abierta (7.3)", () => {
    it("efectivo con acto entra; transferencia y tarjeta con acto entran; sin acto, fallan al confirmar", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        acepta((await salida(s, sesion, "EFECTIVO", "10.00")).acto);
        acepta((await salida(s, sesion, "TRANSFERENCIA", "20.00")).acto);
        acepta((await salida(s, sesion, "TARJETA_DEBITO", "5.00")).acto);
        acepta(await diferidas(s));
      });
      for (const medio of ["TRANSFERENCIA", "TARJETA_CREDITO"] as const) {
        await conAppDe(b(), m, async (s) => {
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "EGRESO_MANUAL",
              medio,
              importe: "-5.00",
              motivo: "Sin acto",
            }),
          );
          rechazo(await diferidas(s), "egreso_no_efectivo_sin_acto");
        });
      }
      // Un egreso en efectivo sin acto sigue como hasta hoy (los casos de uso viejos).
      await conAppDe(b(), m, async (s) => {
        acepta(
          await movimiento(s, esc, sesion, {
            clase: "EGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "-5.00",
            motivo: "Viejo",
          }),
        );
        acepta(await diferidas(s));
      });
    });

    it("el fondo y el ingreso manual por otro medio siguen rechazados (movimiento_caja_solo_efectivo)", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        rechazo(
          await movimiento(s, esc, sesion, {
            clase: "INGRESO_MANUAL",
            medio: "TRANSFERENCIA",
            importe: "5.00",
            motivo: "x",
          }),
          "movimiento_caja_solo_efectivo",
        );
        rechazo(
          await movimiento(s, esc, sesion, {
            clase: "FONDO_INICIAL",
            medio: "TARJETA_DEBITO",
            importe: "5.00",
            sinClave: true,
          }),
          "movimiento_caja_solo_efectivo",
        );
      });
    });

    it("un egreso por transferencia no baja el efectivo esperado de la sesión", async () => {
      const sesion = await sesionNueva();
      const efectivoAntes = await cuenta(
        "select coalesce(sum(m.importe), 0) as n from movimiento_caja m join medio_de_pago d on d.id = m.medio_de_pago_id where m.sesion_id = $1 and d.tipo = 'EFECTIVO'",
        [sesion],
      );
      await conAppDe(b(), m, async (s) => {
        acepta((await salida(s, sesion, "TRANSFERENCIA", "20.00")).acto);
        expect((await s.confirmar()).ok).toBe(true);
      });
      expect(
        await cuenta(
          "select coalesce(sum(m.importe), 0) as n from movimiento_caja m join medio_de_pago d on d.id = m.medio_de_pago_id where m.sesion_id = $1 and d.tipo = 'EFECTIVO'",
          [sesion],
        ),
      ).toBe(efectivoAntes);
    });

    it("el egreso de otra sesión, de otra clase o de otro importe → rechazo", async () => {
      const sesion = await sesionNueva();
      const otraSesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const deOtra = textoDe(
          await movimiento(s, esc, otraSesion, {
            clase: "EGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "-3.00",
            motivo: "Otra",
          }),
          "id",
        );
        const ingreso = textoDe(
          await movimiento(s, esc, sesion, {
            clase: "INGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "3.00",
            motivo: "Ingreso",
          }),
          "id",
        );
        const egreso = textoDe(
          await movimiento(s, esc, sesion, {
            clase: "EGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "-3.00",
            motivo: "Egreso",
          }),
          "id",
        );
        const intento = (movimientoId: string, importe = "3.00") =>
          insertarActo(s, sesion, {
            sentido: "SALIDA",
            importe,
            categoria: "GASTO_MENOR",
            motivo: "x",
            movimientoId,
          });
        rechazo(await intento(deOtra), "movimiento_de_dinero_egreso_invalido");
        rechazo(await intento(ingreso), "movimiento_de_dinero_egreso_invalido");
        rechazo(await intento(egreso, "3.01"), "movimiento_de_dinero_egreso_invalido");
        acepta(await intento(egreso));
        // Un egreso tiene a lo sumo UN acto.
        rechazo(await intento(egreso), "movimiento_de_dinero_movimiento_uk");
      });
    });

    it("sesión cerrada, medio de otra empresa y medio desactivado → rechazo", async () => {
      // Sesión cerrada: el egreso se hizo antes y la sesión se cierra en la misma transacción.
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const e = textoDe(
          await movimiento(s, esc, sesion, {
            clase: "EGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "-3.00",
            motivo: "Cierra",
          }),
          "id",
        );
        await cerrarSesion(s, esc, sesion);
        rechazo(
          await insertarActo(s, sesion, {
            sentido: "SALIDA",
            importe: "3.00",
            categoria: "GASTO_MENOR",
            motivo: "x",
            movimientoId: e,
          }),
          "movimiento_de_dinero_sesion_no_abierta",
        );
        rechazo(
          await insertarActo(s, sesion, { importe: "3.00" }),
          "movimiento_de_dinero_sesion_no_abierta",
        );
      });
      // Un egreso por el medio de otra empresa no existe en esta.
      const sesion2 = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        rechazo(
          await s.intentar(
            `insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, motivo, registrado_en, registrado_por, clave_idempotencia, huella)
             values ($1, $2, 'EGRESO_MANUAL', $3, -3, 'Ajeno', $4, $5, $6, $7)`,
            [
              m.empresa,
              sesion2,
              escOtra.medios.TRANSFERENCIA,
              AHORA,
              m.persona,
              claveNueva(),
              HUELLA,
            ],
          ),
          "movimiento_caja_medio_inexistente",
        );
      });
      // Un medio desactivado (empresa propia, para no tocar el escenario de las otras pruebas).
      const m3 = await crearMundo(dueno);
      const esc3 = await crearEscenario(dueno, m3);
      const sesion3 = await sesionNueva(m3, esc3);
      await dueno.query("update medio_de_pago set activo = false where id = $1", [
        esc3.medios.TRANSFERENCIA,
      ]);
      await conAppDe(b(), m3, async (s) => {
        rechazo(
          await movimiento(s, esc3, sesion3, {
            clase: "EGRESO_MANUAL",
            medio: "TRANSFERENCIA",
            importe: "-3.00",
            motivo: "Inactivo",
          }),
          "movimiento_caja_medio_inactivo",
        );
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("devoluciones: el tope y la anulación (7.5 y 7.6)", () => {
    it("la devolución no supera lo cobrado menos lo anulado, y no se anula un cobro ya devuelto", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const { acto, cobros } = await entradaDeCaja(s, sesion, [["EFECTIVO", "100.00"]]);
        const devolver = (medio: TipoDeMedio, importe: string) =>
          salida(s, sesion, medio, importe, {
            categoria: "DEVOLUCION_DE_UN_COBRO",
            devuelveA: acto,
          });
        acepta((await devolver("TRANSFERENCIA", "70.00")).acto);
        rechazo((await devolver("EFECTIVO", "30.01")).acto, "devolucion_supera_lo_cobrado");
        acepta((await devolver("EFECTIVO", "30.00")).acto);
        rechazo(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-100.00",
            motivo: "Anula",
            anulaA: cobros[0] as string,
          }),
          "movimiento_caja_anulacion_con_devolucion",
        );
        acepta(await diferidas(s));
      });
    });

    it("una devolución anulada el mismo día libera su parte del tope; una entrada anulada no admite devoluciones", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const { acto, cobros } = await entradaDeCaja(s, sesion, [["EFECTIVO", "100.00"]]);
        const primera = await salida(s, sesion, "EFECTIVO", "100.00", {
          categoria: "DEVOLUCION_DE_UN_COBRO",
          devuelveA: acto,
        });
        acepta(primera.acto);
        rechazo(
          (
            await salida(s, sesion, "EFECTIVO", "1.00", {
              categoria: "DEVOLUCION_DE_UN_COBRO",
              devuelveA: acto,
            })
          ).acto,
          "devolucion_supera_lo_cobrado",
        );
        // Se anula la devolución (espejo de su egreso) y vuelve a haber tope.
        acepta(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "100.00",
            motivo: "Anula",
            anulaA: primera.egreso,
          }),
        );
        // Ahora se anula el cobro entero: la entrada queda sin nada devolvible.
        acepta(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-100.00",
            motivo: "Anula",
            anulaA: cobros[0] as string,
          }),
        );
        rechazo(
          (
            await salida(s, sesion, "EFECTIVO", "1.00", {
              categoria: "DEVOLUCION_DE_UN_COBRO",
              devuelveA: acto,
            })
          ).acto,
          "devolucion_supera_lo_cobrado",
        );
        acepta(await diferidas(s));
      });
    });

    it("la devolución es de una ENTRADA de la misma empresa y sucursal; no de otra salida", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const otraSalida = await salida(s, sesion, "EFECTIVO", "5.00");
        acepta(otraSalida.acto);
        rechazo(
          (
            await salida(s, sesion, "EFECTIVO", "1.00", {
              categoria: "DEVOLUCION_DE_UN_COBRO",
              devuelveA: textoDe(otraSalida.acto, "id"),
            })
          ).acto,
          "movimiento_de_dinero_devuelve_a_invalida",
        );
      });
    });

    it("se anula en la misma sesión un COBRO de origen caja.movimiento_de_dinero; no uno de ventas; en otra sesión sigue rechazado", async () => {
      const sesion = await sesionNueva();
      const otraSesion = await sesionNueva();
      let cobroConfirmado = "";
      await conAppDe(b(), m, async (s) => {
        const { cobros } = await entradaDeCaja(s, sesion, [["EFECTIVO", "50.00"]]);
        cobroConfirmado = cobros[0] as string;
        expect((await s.confirmar()).ok).toBe(true);
      });
      await conAppDe(b(), m, async (s) => {
        // En otra sesión: el espejo tiene que ser de la MISMA sesión.
        const r = await movimiento(s, esc, otraSesion, {
          clase: "ANULACION",
          medio: "EFECTIVO",
          importe: "-50.00",
          motivo: "Otra",
          anulaA: cobroConfirmado,
        });
        expect(r.ok).toBe(false);
        acepta(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-50.00",
            motivo: "Anula",
            anulaA: cobroConfirmado,
          }),
        );
        // Una anulación solo una vez.
        rechazo(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-50.00",
            motivo: "Otra vez",
            anulaA: cobroConfirmado,
          }),
          "movimiento_caja_anula_uk",
        );
        const deVentas = await cobrar(s, esc, sesion, { medio: "EFECTIVO", importe: "7.00" });
        rechazo(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-7.00",
            motivo: "Anula",
            anulaA: deVentas,
          }),
          "movimiento_caja_anulacion_con_origen",
        );
        // El espejo tiene que ser exacto también para un cobro del acto.
        const { cobros } = await entradaDeCaja(s, sesion, [["EFECTIVO", "20.00"]]);
        rechazo(
          await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-19.00",
            motivo: "Mal",
            anulaA: cobros[0] as string,
          }),
          "movimiento_caja_anulacion_invalida",
        );
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("aislamiento por empresa (7.7)", () => {
    it("con el contexto de la empresa A no se inserta ni se ve un acto de B, ni se devuelve a una entrada de otra empresa", async () => {
      const sesion = await sesionNueva();
      const sesionDeOtra = await sesionNueva(otra, escOtra);
      let actoDeB = "";
      await conAppDe(b(), otra, async (s) => {
        actoDeB = (await entradaDeCaja(s, sesionDeOtra, [["EFECTIVO", "40.00"]], {}, otra, escOtra))
          .acto;
        expect((await s.confirmar()).ok).toBe(true);
      });
      await conAppDe(b(), m, async (s) => {
        const visibles = await s.intentar(
          "select count(*)::int as n from movimiento_de_dinero where id = $1",
          [actoDeB],
        );
        expect(visibles.ok && visibles.rows[0]?.["n"]).toBe(0);
        // Insertar en nombre de B con el contexto de A: la política lo rechaza.
        const enNombreDeB = await insertarActo(s, sesionDeOtra, { importe: "1.00" }, otra);
        expect(enNombreDeB.ok).toBe(false);
        // Lo rechaza el disparador (la sesión no es de esta empresa) o la política: de cualquier modo, no entra.
        if (!enNombreDeB.ok) expect(["23514", "42501"]).toContain(enNombreDeB.codigo);
        // Una devolución de A apuntando a la entrada de B.
        rechazo(
          (
            await salida(s, sesion, "EFECTIVO", "1.00", {
              categoria: "DEVOLUCION_DE_UN_COBRO",
              devuelveA: actoDeB,
            })
          ).acto,
          "movimiento_de_dinero_devuelve_a_invalida",
        );
      });
      await conAppDe(b(), otra, async (s) => {
        const visibles = await s.intentar(
          "select count(*)::int as n from movimiento_de_dinero where id = $1",
          [actoDeB],
        );
        expect(visibles.ok && visibles.rows[0]?.["n"]).toBe(1);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("paridad dominio ↔ base (7.8)", () => {
    it("las categorías de la base son las de CATEGORIAS_DE_SALIDA", async () => {
      const { rows } = await dueno.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'movimiento_de_dinero_categoria_ck'",
      );
      const enBase = [...(rows[0]?.def.matchAll(/'([A-Z_]+)'::text/g) ?? [])]
        .map((x) => x[1] as string)
        .sort();
      expect(enBase).toEqual([...CATEGORIAS_DE_SALIDA].sort());
    });

    /** Las muestras de cada texto: la misma tabla para el TypeScript y para la base. */
    const MUESTRAS = [
      "Ana",
      "Pérez & Hijos S.A.",
      "D'Angelo",
      "La 5ta. SRL",
      "Hotel 9 de Julio",
      "Nuñez, Ángel (h)",
      "Ñandú ÿ",
      "100% listo",
      "¿Cuánto? ¡Ya!",
      "a/b: c; d",
      "x_y*z+w$#",
      "Señal “doble” — ® ™",
      "Łódź",
      "Š Œ Ž Ÿ",
      "12345",
      "30-71234567-1",
      "-Ana",
      "+Ana",
      "Ana\n",
      "Ana\nPérez",
      "con\ttab",
      "<b>Ana</b>",
      "Ana😀",
      "小林",
      "Ana​Pérez",
      "Ana  Pérez",
      " Ana",
      "Ana ",
      "Ana Pérez",
      "é",
      "",
      "a".repeat(40),
      "a".repeat(41),
      "a".repeat(200),
      "a".repeat(201),
      "a".repeat(500),
      "a".repeat(501),
    ];
    const CAMPOS = [
      {
        columna: "tercero_nombre",
        restriccion: "movimiento_de_dinero_tercero_nombre_ck",
        ts: (t: string) => nombreODenominacionDesdeTexto(t),
        maximo: 200,
      },
      {
        columna: "concepto",
        restriccion: "movimiento_de_dinero_concepto_ck",
        ts: (t: string) => conceptoDesdeTexto(t),
        maximo: LARGO_MAXIMO_DEL_CONCEPTO,
      },
      {
        columna: "motivo",
        restriccion: "movimiento_de_dinero_motivo_ck",
        ts: (t: string) => motivoObligatorio(t),
        maximo: 500,
      },
      {
        columna: "referencia",
        restriccion: "movimiento_de_dinero_referencia_ck",
        ts: (t: string) => referenciaDesdeTexto(t),
        maximo: LARGO_MAXIMO_DE_LA_REFERENCIA,
      },
    ] as const;

    it.each(CAMPOS)(
      "$columna: la base acepta exactamente lo que la primitiva deja en forma canónica (largos y conjunto permitido)",
      async ({ columna, restriccion, ts, maximo }) => {
        const { rows } = await dueno.query<{ def: string }>(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and conrelid = 'public.movimiento_de_dinero'::regclass",
          [restriccion],
        );
        const expresion = (rows[0]?.def ?? "").replace(/^CHECK /, "");
        expect(expresion).not.toBe("");
        const divergencias: string[] = [];
        for (const muestra of MUESTRAS) {
          const { rows: r } = await dueno.query<{ ok: boolean }>(
            `select ${expresion} as ok from (select $1::text as ${columna}) t`,
            [muestra],
          );
          const delTs = muestra === "" ? { ok: false as const } : ts(muestra);
          // La base exige la forma canónica (ya recortada y compacta); la primitiva la produce.
          const esperado = delTs.ok && delTs.valor === muestra;
          if (r[0]?.ok !== esperado)
            divergencias.push(
              `${JSON.stringify(muestra.slice(0, 20))}(${muestra.length}) base=${String(r[0]?.ok)} ts=${String(esperado)}`,
            );
        }
        expect(divergencias).toEqual([]);
        // El largo máximo exacto es el de la primitiva.
        const justo = "a".repeat(maximo);
        const { rows: borde } = await dueno.query<{ ok: boolean; mas: boolean }>(
          `select (select ${expresion} from (select $1::text as ${columna}) t) as ok, (select ${expresion} from (select $2::text as ${columna}) t) as mas`,
          [justo, justo + "a"],
        );
        expect(borde[0]).toEqual({ ok: true, mas: false });
      },
    );

    it("la clave y la huella tienen la forma de cobranza_de_ticket", async () => {
      const { rows } = await dueno.query<{ n: string; def: string }>(
        `select conname as n, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('cobranza_clave_ck', 'cobranza_huella_ck', 'movimiento_de_dinero_clave_ck', 'movimiento_de_dinero_huella_ck')`,
      );
      const patron = (n: string) =>
        /'([^']+)'::text/.exec(rows.find((r) => r.n === n)?.def ?? "")?.[1];
      expect(patron("movimiento_de_dinero_clave_ck")).toBe(patron("cobranza_clave_ck"));
      expect(patron("movimiento_de_dinero_huella_ck")).toBe(patron("cobranza_huella_ck"));
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("idempotencia (7.9 y 7.10 bis)", () => {
    it("la misma clave dos veces → choque de unicidad", async () => {
      const sesion = await sesionNueva();
      await conAppDe(b(), m, async (s) => {
        const clave = claveNueva();
        acepta(await insertarActo(s, sesion, { importe: "1.00", clave }));
        rechazo(
          await insertarActo(s, sesion, { importe: "2.00", clave }),
          "movimiento_de_dinero_clave_uk",
        );
      });
    });

    it.each(AISLAMIENTOS)(
      "(%s) dos transacciones que insertan la misma salida no efectiva con la misma clave → un solo acto y un solo egreso",
      async (aislamiento) => {
        const sesion = await sesionNueva();
        const clave = claveNueva();
        const antesActos = await cuenta(
          "select count(*) as n from movimiento_de_dinero where sesion_id = $1",
          [sesion],
        );
        const antesEgresos = await cuenta(
          "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'EGRESO_MANUAL'",
          [sesion],
        );
        const intentar = () =>
          conReintento(aislamiento, async (s) => {
            const e = await movimiento(s, esc, sesion, {
              clase: "EGRESO_MANUAL",
              medio: "TRANSFERENCIA",
              importe: "-12.00",
              motivo: "Doble clic",
            });
            if (!e.ok) return e;
            const a = await insertarActo(s, sesion, {
              sentido: "SALIDA",
              importe: "12.00",
              categoria: "GASTO_MENOR",
              motivo: "Doble clic",
              movimientoId: textoDe(e, "id"),
              clave,
            });
            return a.ok ? null : a;
          });
        const resultados = await Promise.all([intentar(), intentar()]);
        expect(
          resultados.filter((r) => r === "ok"),
          JSON.stringify(resultados),
        ).toHaveLength(1);
        expect(resultados.filter((r) => r !== "ok")).toEqual(["movimiento_de_dinero_clave_uk"]);
        expect(
          await cuenta("select count(*) as n from movimiento_de_dinero where sesion_id = $1", [
            sesion,
          ]),
        ).toBe(antesActos + 1);
        // El egreso de la que perdió se deshizo con su transacción.
        expect(
          await cuenta(
            "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'EGRESO_MANUAL'",
            [sesion],
          ),
        ).toBe(antesEgresos + 1);
      },
    );

    it.each(AISLAMIENTOS)(
      "(%s) dos salidas no efectivas a la vez sobre la misma caja → entran las dos y ninguna cambia el efectivo",
      async (aislamiento) => {
        const sesion = await sesionNueva();
        const efectivo = () =>
          cuenta(
            "select coalesce(sum(m.importe), 0) as n from movimiento_caja m join medio_de_pago d on d.id = m.medio_de_pago_id where m.sesion_id = $1 and d.tipo = 'EFECTIVO'",
            [sesion],
          );
        const antes = await efectivo();
        const barrera = crearBarrera(2);
        const salidaPor = (medio: TipoDeMedio, importe: string) =>
          conReintento(aislamiento, async (s, primero) => {
            const e = await movimiento(s, esc, sesion, {
              clase: "EGRESO_MANUAL",
              medio,
              importe: `-${importe}`,
              motivo: "A la vez",
            });
            if (!e.ok) return e;
            // En READ COMMITTED el egreso toma la fila de la sesión: la barrera solo se cruza antes de escribir.
            void primero;
            const a = await insertarActo(s, sesion, {
              sentido: "SALIDA",
              importe,
              categoria: "GASTO_MENOR",
              motivo: "A la vez",
              movimientoId: textoDe(e, "id"),
            });
            return a.ok ? null : a;
          });
        void barrera;
        const resultados = await Promise.all([
          salidaPor("TRANSFERENCIA", "7.00"),
          salidaPor("TARJETA_DEBITO", "9.00"),
        ]);
        expect(resultados, JSON.stringify(resultados)).toEqual(["ok", "ok"]);
        expect(await efectivo()).toBe(antes);
      },
    );
  });

  // ---------------------------------------------------------------------------------------------
  describe("concurrencia del tope (7.5)", () => {
    /** Una entrada de 100,00 en efectivo, confirmada, en una sesión propia. */
    const entradaConfirmada = async (): Promise<{
      acto: string;
      sesion: string;
      cobro: string;
    }> => {
      const sesion = await sesionNueva();
      let acto = "";
      let cobro = "";
      await conAppDe(b(), m, async (s) => {
        const e = await entradaDeCaja(s, sesion, [["EFECTIVO", "100.00"]]);
        acto = e.acto;
        cobro = e.cobros[0] as string;
        expect((await s.confirmar()).ok).toBe(true);
      });
      return { acto, sesion, cobro };
    };

    const devolver = (
      aislamiento: Aislamiento,
      acto: string,
      sesion: string,
      importe: string,
      barrera: () => Promise<void>,
    ): Promise<string> =>
      conReintento(aislamiento, async (s, primero) => {
        const e = await movimiento(s, esc, sesion, {
          clase: "EGRESO_MANUAL",
          medio: "EFECTIVO",
          importe: `-${importe}`,
          motivo: "Devolucion",
        });
        if (!e.ok) return e;
        if (primero) await barrera();
        const a = await insertarActo(s, sesion, {
          sentido: "SALIDA",
          importe,
          categoria: "DEVOLUCION_DE_UN_COBRO",
          motivo: "Devolucion",
          devuelveA: acto,
          movimientoId: textoDe(e, "id"),
        });
        return a.ok ? null : a;
      });

    it.each(AISLAMIENTOS)(
      "(%s) dos devoluciones desde dos cajas a la vez: que juntas superan la entrada → una confirma y la otra falla por el tope; que caben → las dos",
      async (aislamiento) => {
        for (const [x, y, esperadas] of [
          ["60.00", "60.00", 1],
          ["40.00", "60.00", 2],
        ] as const) {
          const { acto } = await entradaConfirmada();
          const [cajaB, cajaC] = [await sesionNueva(), await sesionNueva()];
          const barrera = crearBarrera(2);
          const resultados = await Promise.all([
            devolver(aislamiento, acto, cajaB, x, barrera),
            devolver(aislamiento, acto, cajaC, y, barrera),
          ]);
          expect(
            resultados.filter((r) => r === "ok"),
            JSON.stringify(resultados),
          ).toHaveLength(esperadas);
          for (const r of resultados.filter((r) => r !== "ok"))
            expect(r).toBe("devolucion_supera_lo_cobrado");
          const devuelto = await cuenta(
            "select coalesce(sum(importe), 0) as n from movimiento_de_dinero where devuelve_a = $1",
            [acto],
          );
          expect(devuelto).toBeLessThanOrEqual(100);
        }
      },
    );

    it.each(AISLAMIENTOS)(
      "(%s) anular el cobro contra devolverlo a la vez: no pueden ganar los dos",
      async (aislamiento) => {
        const { acto, sesion, cobro } = await entradaConfirmada();
        const cajaB = await sesionNueva();
        const barrera = crearBarrera(2);
        const anular = conReintento(aislamiento, async (s, primero) => {
          if (primero) await barrera();
          const r = await movimiento(s, esc, sesion, {
            clase: "ANULACION",
            medio: "EFECTIVO",
            importe: "-100.00",
            motivo: "Anula",
            anulaA: cobro,
          });
          return r.ok ? null : r;
        });
        const devolverLaMitad = devolver(aislamiento, acto, cajaB, "50.00", barrera);
        const resultados = await Promise.all([anular, devolverLaMitad]);
        expect(
          resultados.filter((r) => r === "ok"),
          JSON.stringify(resultados),
        ).toHaveLength(1);
        expect(resultados.filter((r) => r !== "ok")[0]).toMatch(
          /^(movimiento_caja_anulacion_con_devolucion|devolucion_supera_lo_cobrado)$/,
        );
        // Lo invariante: nunca queda más devuelto que cobrado neto.
        const { rows } = await dueno.query<{ neto: string; devuelto: string }>(
          `select (select coalesce(sum(m.importe), 0) from cobro c join movimiento_caja m on m.id = c.movimiento_id where c.origen_id = $1)
                + (select coalesce(sum(a.importe), 0) from cobro c join movimiento_caja a on a.anula_a = c.movimiento_id where c.origen_id = $1) as neto,
                (select coalesce(sum(importe), 0) from movimiento_de_dinero where devuelve_a = $1) as devuelto`,
          [acto],
        );
        expect(Number(rows[0]?.devuelto)).toBeLessThanOrEqual(Number(rows[0]?.neto));
      },
    );
  });

  // ---------------------------------------------------------------------------------------------
  describe("repositorio (insertar, porClave, obtener, deLaJornada, devueltoDe)", () => {
    type TxDelRepositorio = Readonly<{
      db: Kysely<SinTablas>;
      movimientosDeDinero: RepositorioDeMovimientosDeDinero;
    }>;

    it("guarda y lee los actos con el importe como texto decimal; suma lo devuelto sin contar lo anulado; no cruza empresas", async () => {
      const entorno = crearTransacciones<TxDelRepositorio>({
        urls: { OPERATIVO: b().app },
        armar: (db) => ({
          db,
          movimientosDeDinero: crearRepositorioDeMovimientosDeDinero(db.withTables<CajaDb>()),
        }),
        armarDeLectura: (db) => ({
          db,
          movimientosDeDinero: crearRepositorioDeMovimientosDeDinero(db.withTables<CajaDb>()),
        }),
        maximoDeConexiones: 4,
        clave: b().clave,
      });
      try {
        const sesion = await sesionNueva();
        let entrada = "";
        await conAppDe(b(), m, async (s) => {
          entrada = (await entradaDeCaja(s, sesion, [["EFECTIVO", "100.00"]], { concepto: "Seña" }))
            .acto;
          expect((await s.confirmar()).ok).toBe(true);
        });
        const fecha = (
          await dueno.query<{ f: string }>(
            "select fecha_negocio::text as f from sesion_caja where id = $1",
            [sesion],
          )
        ).rows[0]?.f as string;
        const contexto = comoEmpresa(empresaId(m.empresa), personaId(m.persona));
        const huella = (importe: string, devuelveA: string | null) =>
          huellaDelMovimientoDeDinero({
            sentido: "SALIDA",
            sesionId: sesion,
            importe,
            categoria: "DEVOLUCION_DE_UN_COBRO",
            concepto: null,
            motivo: "Devolucion",
            terceroNombre: null,
            terceroPersonaId: null,
            referencia: null,
            devuelveA,
          });
        const claves = [claveNueva(), claveNueva()];
        const ids: string[] = [];
        const egresos: string[] = [];
        const hecho = await entorno.ejecutar({ contexto }, async ({ db, movimientosDeDinero }) => {
          const cajaDb = db.withTables<CajaDb>();
          for (const [i, importe] of ["30.00", "20.00"].entries()) {
            const egreso = await cajaDb
              .insertInto("movimiento_caja")
              .values({
                empresa_id: m.empresa,
                sesion_id: sesion,
                clase: "EGRESO_MANUAL",
                medio_de_pago_id: esc.medios.EFECTIVO,
                cuenta_de_cobro_id: null,
                importe: `-${importe}`,
                motivo: "Devolucion",
                anula_a: null,
                corrige_jornada: null,
                registrado_en: new Date(AHORA),
                registrado_por: m.persona,
                clave_idempotencia: claveNueva(),
                huella: HUELLA,
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            egresos.push(egreso.id);
            ids.push(
              await movimientosDeDinero.insertar({
                empresa: empresaId(m.empresa),
                sucursalId: sucursalId(m.sucursal),
                sesionId: sesion,
                sentido: "SALIDA",
                importe: importeDesdeTexto(ARS, importe),
                categoria: "DEVOLUCION_DE_UN_COBRO",
                concepto: null,
                motivo: "Devolucion",
                terceroNombre: null,
                terceroPersonaId: null,
                referencia: null,
                devuelveA: entrada,
                movimientoId: egreso.id,
                claveDeIdempotencia: claves[i] as string,
                huella: huella(importe, entrada),
                registradoEn: new Date(AHORA),
                registradoPor: m.persona as PersonaId,
              }),
            );
          }
          // Se anula la segunda devolución (espejo de su egreso): deja de ser vigente.
          await cajaDb
            .insertInto("movimiento_caja")
            .values({
              empresa_id: m.empresa,
              sesion_id: sesion,
              clase: "ANULACION",
              medio_de_pago_id: esc.medios.EFECTIVO,
              cuenta_de_cobro_id: null,
              importe: "20.00",
              motivo: "Anula",
              anula_a: egresos[1] as string,
              corrige_jornada: null,
              registrado_en: new Date(AHORA),
              registrado_por: m.persona,
              clave_idempotencia: claveNueva(),
              huella: HUELLA,
            })
            .execute();
          return ok(true);
        });
        expect(hecho.ok, JSON.stringify(hecho)).toBe(true);

        const lecturas = await entorno.ejecutar({ contexto }, async ({ movimientosDeDinero }) =>
          ok({
            porClave: await movimientosDeDinero.porClave(empresaId(m.empresa), claves[0] as string),
            sinClave: await movimientosDeDinero.porClave(empresaId(m.empresa), claveNueva()),
            obtenido: await movimientosDeDinero.obtener(empresaId(m.empresa), ids[0] as string),
            mal: await movimientosDeDinero.obtener(empresaId(m.empresa), "no-es-un-uuid"),
            devuelto: await movimientosDeDinero.devueltoDe(empresaId(m.empresa), entrada),
            sinDevoluciones: await movimientosDeDinero.devueltoDe(
              empresaId(m.empresa),
              randomUUID(),
            ),
            jornada: await movimientosDeDinero.deLaJornada(
              empresaId(m.empresa),
              sucursalId(m.sucursal),
              fecha as never,
            ),
          }),
        );
        expect(lecturas.ok).toBe(true);
        if (!lecturas.ok) return;
        const l = lecturas.valor;
        expect(l.porClave?.id).toBe(ids[0]);
        expect(l.porClave && importeATexto(l.porClave.importe)).toBe("30.00");
        expect(l.porClave).toMatchObject({
          sentido: "SALIDA",
          categoria: "DEVOLUCION_DE_UN_COBRO",
          devuelveA: entrada,
          sesionId: sesion,
          huella: huella("30.00", entrada),
        });
        expect(l.sinClave).toBeNull();
        expect(l.obtenido?.id).toBe(ids[0]);
        expect(l.mal).toBeNull();
        expect(importeATexto(l.devuelto)).toBe("30.00");
        expect(importeATexto(l.sinDevoluciones)).toBe("0.00");
        expect(l.jornada.map((a) => a.id)).toEqual(expect.arrayContaining([entrada, ...ids]));
        expect(l.jornada.find((a) => a.id === entrada)?.concepto).toBe("Seña");

        // Otra empresa: no ve nada de esto (RLS) aunque pida por el id.
        const deOtra = await entorno.ejecutar(
          { contexto: comoEmpresa(empresaId(otra.empresa), personaId(otra.persona)) },
          async ({ movimientosDeDinero }) =>
            ok({
              porClave: await movimientosDeDinero.porClave(
                empresaId(m.empresa),
                claves[0] as string,
              ),
              obtenido: await movimientosDeDinero.obtener(empresaId(m.empresa), ids[0] as string),
              devuelto: await movimientosDeDinero.devueltoDe(empresaId(m.empresa), entrada),
              mia: await movimientosDeDinero.obtener(empresaId(otra.empresa), ids[0] as string),
            }),
        );
        expect(deOtra.ok).toBe(true);
        if (deOtra.ok) {
          expect(deOtra.valor.porClave).toBeNull();
          expect(deOtra.valor.obtenido).toBeNull();
          expect(importeATexto(deOtra.valor.devuelto)).toBe("0.00");
          expect(deOtra.valor.mia).toBeNull();
        }
      } finally {
        await entorno.cerrar();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("reversión (7.10)", () => {
    it("ciclo aplicar → revertir → aplicar; con datos se frena; con egresos no efectivos o anulaciones del acto falla siempre y no deja nada a medias", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
        const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
        const estado = async () =>
          (
            await c.query<{ tabla: boolean; viejo: boolean; nuevo: boolean }>(
              `select to_regclass('public.movimiento_de_dinero') is not null as tabla,
                      (select pg_get_functiondef(oid) like '%son solo de efectivo%' and pg_get_functiondef(oid) not like '%M-1%'
                         from pg_proc where proname = 'movimiento_caja_validar_alta') as viejo,
                      (select pg_get_functiondef(oid) like '%movimiento_caja_anulacion_con_devolucion%'
                         from pg_proc where proname = 'movimiento_caja_validar_alta') as nuevo`,
            )
          ).rows[0];
        const correr = async (texto: string, confirmar = false): Promise<string | null> => {
          try {
            await c.query(
              `begin; ${confirmar ? "set local pedernal.confirmar_reversion = 'SI'; " : ""}${texto}; commit;`,
            );
            return null;
          } catch (e) {
            await c.query("rollback");
            return (e as { message: string }).message;
          }
        };

        // Aplicar → revertir → aplicar → revertir → aplicar sobre una base sin datos: el esquema queda igual.
        expect(await estado()).toMatchObject({ tabla: true, nuevo: true });
        expect(await correr(reversion)).toBeNull();
        expect(await estado()).toMatchObject({ tabla: false, viejo: true });
        expect(await correr(reversion)).toBeNull(); // repetida: no cambia nada
        expect(
          await c.query("select 1 from migracion where nombre = $1", [MIGRACION]),
        ).toHaveProperty("rowCount", 0);
        await c.query(migracion);
        expect(await estado()).toMatchObject({ tabla: true, nuevo: true });

        // Con un rol sin BYPASSRLS el mensaje es claro y no se toca nada.
        const rol = `revisor_${sufijoUnico()}`;
        await c.query(`create role ${rol} nologin`);
        try {
          const mensaje = await correr(`set local role ${rol}; ${reversion}`);
          expect(mensaje).toMatch(/evada RLS/);
          expect(await estado()).toMatchObject({ tabla: true, nuevo: true });
        } finally {
          await c.query(`drop role ${rol}`);
        }

        // Con un acto cargado, se frena salvo la confirmación; con la confirmación, revierte y lo pierde.
        const mundo = await crearMundo(c);
        const escenario = await crearEscenario(c, mundo);
        const caja = await crearCaja(c, mundo, "Caja de la reversión");
        const sesionDeAparte = async (): Promise<string> => {
          let sesion = "";
          await conAppDe(aparte.base, mundo, async (s) => {
            sesion = (await abrirSesion(s, escenario, { caja })).sesion;
            expect((await s.confirmar()).ok).toBe(true);
          });
          return sesion;
        };
        const sesion = await sesionDeAparte();
        const cargarSalida = async (medio: TipoDeMedio): Promise<void> => {
          await conAppDe(aparte.base, mundo, async (s) => {
            const e = textoDe(
              await movimiento(s, escenario, sesion, {
                clase: "EGRESO_MANUAL",
                medio,
                importe: "-4.00",
                motivo: "Reversion",
              }),
              "id",
            );
            acepta(
              await s.intentar(
                `insert into movimiento_de_dinero (empresa_id, sucursal_id, sesion_id, sentido, importe, categoria, motivo, movimiento_id, clave, huella, registrado_por, registrado_en)
                 values ($1, $2, $3, 'SALIDA', 4, 'GASTO_MENOR', 'Reversion', $4, $5, $6, $7, $8)`,
                [
                  mundo.empresa,
                  mundo.sucursal,
                  sesion,
                  e,
                  claveNueva(),
                  HUELLA,
                  mundo.persona,
                  AHORA,
                ],
              ),
            );
            expect((await s.confirmar()).ok).toBe(true);
          });
        };
        await cargarSalida("EFECTIVO");
        expect(await correr(reversion)).toMatch(/actos de movimiento de dinero/);
        expect(await estado()).toMatchObject({ tabla: true, nuevo: true });
        expect(await correr(reversion, true)).toBeNull();
        expect(await estado()).toMatchObject({ tabla: false, viejo: true });
        await c.query(migracion);

        // Con un egreso de un medio que no es efectivo, falla SIEMPRE (aun con la confirmación) y la base queda como estaba.
        await cargarSalida("TRANSFERENCIA");
        for (const confirmar of [false, true]) {
          expect(await correr(reversion, confirmar)).toMatch(
            /egresos de un medio que no es efectivo/,
          );
          expect(await estado()).toMatchObject({ tabla: true, nuevo: true });
        }
        expect(
          Number(
            (await c.query<{ n: string }>("select count(*) as n from movimiento_de_dinero")).rows[0]
              ?.n,
          ),
        ).toBe(1);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });
});
