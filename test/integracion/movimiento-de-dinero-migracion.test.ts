import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { comoEmpresa, crearBarrera, crearBaseAparte } from "./entorno";
import { acepta, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  HUELLA,
  abrirSesion,
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
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";

/**
 * Migración M-1 (0091): el acto «movimiento de dinero». SQL directo con el rol de la aplicación, sobre una base propia con todas las
 * migraciones. Cada caso corre en una transacción que se deshace (`conAppDe`), salvo los de concurrencia, que confirman datos de verdad.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const ORIGEN = "caja.movimiento_de_dinero";
const AHORA = "2026-11-09T22:00:00Z";

describe.skipIf(base === null)("migración 0091: movimiento de dinero (SQL directo)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let esc: Escenario;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    esc = await crearEscenario(dueno, m);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const b = () => propia.base;

  type Acto = Partial<{
    sentido: "ENTRADA" | "SALIDA";
    importe: string;
    categoria: string | null;
    concepto: string | null;
    motivo: string | null;
    terceroNombre: string | null;
    referencia: string | null;
    devuelveA: string | null;
    movimientoId: string | null;
    clave: string;
  }>;

  const insertarActo = (s: SesionDePrueba, sesion: string, a: Acto): Promise<Intento> =>
    s.intentar(
      `insert into movimiento_de_dinero (empresa_id, sucursal_id, sesion_id, sentido, importe, categoria, concepto, motivo,
                                         tercero_nombre, referencia, devuelve_a, movimiento_id, clave, huella, registrado_por, registrado_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
      [
        m.empresa,
        m.sucursal,
        sesion,
        a.sentido ?? "ENTRADA",
        a.importe ?? "100.00",
        a.categoria ?? null,
        a.concepto ?? null,
        a.motivo ?? null,
        a.terceroNombre ?? null,
        a.referencia ?? null,
        a.devuelveA ?? null,
        a.movimientoId ?? null,
        a.clave ?? claveNueva(),
        HUELLA,
        m.persona,
        AHORA,
      ],
    );

  /** Una entrada completa: el acto y sus cobros (uno por medio), todo en la transacción. Devuelve el id del acto y los de sus cobros. */
  const entrada = async (
    s: SesionDePrueba,
    sesion: string,
    partes: ReadonlyArray<readonly [TipoDeMedio, string]>,
    importe?: string,
  ): Promise<{ acto: string; cobros: string[] }> => {
    const total = partes.reduce((t, [, i]) => t + Math.round(Number(i) * 100), 0) / 100;
    const acto = textoDe(
      await insertarActo(s, sesion, { sentido: "ENTRADA", importe: importe ?? total.toFixed(2) }),
      "id",
    );
    const cobros: string[] = [];
    let orden = 1;
    for (const [medio, i] of partes) {
      cobros.push(await cobrar(s, esc, sesion, { medio, importe: i, origen: { id: acto, orden: orden++ } }, {}));
    }
    return { acto, cobros };
  };

  // En `cobrar` el origen por defecto es de ventas: acá hace falta el de caja. Se arma a mano para fijar el tipo.
  const cobroDeCaja = async (
    s: SesionDePrueba,
    sesion: string,
    acto: string,
    medio: TipoDeMedio,
    importe: string,
    orden: number,
  ): Promise<string> => {
    const id = textoDe(
      await movimiento(s, esc, sesion, { clase: "COBRO", medio, importe }),
      "id",
    );
    acepta(await filaDeCobro(s, esc, id, { id: acto, orden, tipo: ORIGEN }));
    return id;
  };

  const entradaDeCaja = async (
    s: SesionDePrueba,
    sesion: string,
    partes: ReadonlyArray<readonly [TipoDeMedio, string]>,
  ): Promise<{ acto: string; cobros: string[] }> => {
    const total = partes.reduce((t, [, i]) => t + Math.round(Number(i) * 100), 0) / 100;
    const acto = textoDe(
      await insertarActo(s, sesion, { sentido: "ENTRADA", importe: total.toFixed(2) }),
      "id",
    );
    const cobros: string[] = [];
    let orden = 1;
    for (const [medio, i] of partes) cobros.push(await cobroDeCaja(s, sesion, acto, medio, i, orden++));
    return { acto, cobros };
  };
  void entrada;

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

  const sesionNueva = async (): Promise<string> => {
    const caja = await crearCaja(dueno, m, `Caja ${randomUUID().slice(0, 8)}`);
    let sesion = "";
    await conAppDe(b(), m, async (s) => {
      sesion = (await abrirSesion(s, esc, { caja })).sesion;
      expect((await s.confirmar()).ok).toBe(true);
    });
    return sesion;
  };

  const rechazo = (r: Intento, restriccion: string): void => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.restriccion).toBe(restriccion);
  };

  it("entrada que cuadra confirma; si los cobros suman de menos o de más, se rechaza al confirmar", async () => {
    const sesion = await sesionNueva();
    await conAppDe(b(), m, async (s) => {
      await entradaDeCaja(s, sesion, [["EFECTIVO", "60.00"], ["TARJETA_DEBITO", "40.00"]]);
      acepta(await s.directo("set constraints all immediate").then((r) => r));
    });
    for (const [parte, restriccion] of [
      ["30.00", "movimiento_de_dinero_no_cuadra"],
      ["130.00", "movimiento_de_dinero_no_cuadra"],
    ] as const) {
      await conAppDe(b(), m, async (s) => {
        const acto = textoDe(await insertarActo(s, sesion, { importe: "100.00" }), "id");
        await cobroDeCaja(s, sesion, acto, "EFECTIVO", parte, 1);
        const r = await s.directo("set constraints all immediate");
        rechazo(r, restriccion);
      });
    }
  });

  it("salida: efectivo con acto entra; transferencia con acto entra; transferencia sin acto falla al confirmar", async () => {
    const sesion = await sesionNueva();
    await conAppDe(b(), m, async (s) => {
      acepta((await salida(s, sesion, "EFECTIVO", "10.00")).acto);
      acepta((await salida(s, sesion, "TRANSFERENCIA", "20.00")).acto);
      acepta(await s.directo("set constraints all immediate"));
    });
    await conAppDe(b(), m, async (s) => {
      acepta(
        await movimiento(s, esc, sesion, { clase: "EGRESO_MANUAL", medio: "TRANSFERENCIA", importe: "-5.00", motivo: "Sin acto" }),
      );
      rechazo(await s.directo("set constraints all immediate"), "egreso_no_efectivo_sin_acto");
    });
  });

  it("fondo e ingreso manual por otro medio siguen rechazados (movimiento_caja_solo_efectivo)", async () => {
    const sesion = await sesionNueva();
    await conAppDe(b(), m, async (s) => {
      rechazo(
        await movimiento(s, esc, sesion, { clase: "INGRESO_MANUAL", medio: "TRANSFERENCIA", importe: "5.00", motivo: "x" }),
        "movimiento_caja_solo_efectivo",
      );
    });
  });

  it("AVISO 3: se anula un cobro del acto; no uno de ventas", async () => {
    const sesion = await sesionNueva();
    await conAppDe(b(), m, async (s) => {
      const { cobros } = await entradaDeCaja(s, sesion, [["EFECTIVO", "50.00"]]);
      acepta(
        await movimiento(s, esc, sesion, {
          clase: "ANULACION",
          medio: "EFECTIVO",
          importe: "-50.00",
          motivo: "Anula",
          anulaA: cobros[0] as string,
        }),
      );
      const de_ventas = await cobrar(s, esc, sesion, { medio: "EFECTIVO", importe: "7.00" });
      rechazo(
        await movimiento(s, esc, sesion, { clase: "ANULACION", medio: "EFECTIVO", importe: "-7.00", motivo: "Anula", anulaA: de_ventas }),
        "movimiento_caja_anulacion_con_origen",
      );
    });
  });

  it("tope: la devolución no supera lo cobrado menos lo anulado, y no se anula un cobro ya devuelto", async () => {
    const sesion = await sesionNueva();
    await conAppDe(b(), m, async (s) => {
      const { acto, cobros } = await entradaDeCaja(s, sesion, [["EFECTIVO", "100.00"]]);
      acepta((await salida(s, sesion, "TRANSFERENCIA", "70.00", { categoria: "DEVOLUCION_DE_UN_COBRO", devuelveA: acto })).acto);
      rechazo(
        (await salida(s, sesion, "EFECTIVO", "30.01", { categoria: "DEVOLUCION_DE_UN_COBRO", devuelveA: acto })).acto,
        "devolucion_supera_lo_cobrado",
      );
      acepta((await salida(s, sesion, "EFECTIVO", "30.00", { categoria: "DEVOLUCION_DE_UN_COBRO", devuelveA: acto })).acto);
      rechazo(
        await movimiento(s, esc, sesion, { clase: "ANULACION", medio: "EFECTIVO", importe: "-100.00", motivo: "Anula", anulaA: cobros[0] as string }),
        "movimiento_caja_anulacion_con_devolucion",
      );
      acepta(await s.directo("set constraints all immediate"));
    });
  });

  it.each([["read committed"], ["serializable"]] as const)(
    "concurrencia (%s): dos devoluciones desde dos cajas a la vez que juntas superan la entrada → una sola confirma; que caben → las dos",
    async (aislamiento) => {
      const sesionDeEntrada = await sesionNueva();
      const abrir = (): Promise<SesionDePrueba> =>
        SesionDePrueba.abrir(b(), "pedernal_app", comoEmpresa(empresaId(m.empresa), personaId(m.persona)), aislamiento);
      const preparar = async (): Promise<string> => {
        let acto = "";
        await conAppDe(b(), m, async (s) => {
          acto = (await entradaDeCaja(s, sesionDeEntrada, [["EFECTIVO", "100.00"]])).acto;
          expect((await s.confirmar()).ok).toBe(true);
        });
        return acto;
      };
      /** Una devolución en su propia sesión de caja; ante un 40001 (serializable) reintenta una vez, como la aplicación. */
      const devolver = async (acto: string, sesion: string, importe: string, barrera: () => Promise<void>): Promise<string> => {
        for (let intento = 1; ; intento++) {
          const s = await abrir();
          try {
            const e = await movimiento(s, esc, sesion, { clase: "EGRESO_MANUAL", medio: "EFECTIVO", importe: `-${importe}`, motivo: "Devolucion" });
            if (!e.ok) return `egreso:${e.restriccion ?? e.codigo}`;
            if (intento === 1) await barrera();
            const a = await insertarActo(s, sesion, {
              sentido: "SALIDA",
              importe,
              categoria: "DEVOLUCION_DE_UN_COBRO",
              motivo: "Devolucion",
              devuelveA: acto,
              movimientoId: textoDe(e, "id"),
            });
            const c = a.ok ? await s.confirmar() : a;
            if (c.ok) return "ok";
            if (!c.ok && c.codigo === "40001" && intento === 1) continue;
            return `${a.ok ? "commit" : "acto"}:${c.ok ? "" : (c.restriccion ?? c.codigo)}`;
          } finally {
            await s.cerrar();
          }
        }
      };
      for (const [x, y, esperadas] of [
        ["60.00", "60.00", 1],
        ["40.00", "60.00", 2],
      ] as const) {
        const acto = await preparar();
        const [cajaB, cajaC] = [await sesionNueva(), await sesionNueva()];
        const barrera = crearBarrera(2);
        const resultados = await Promise.all([devolver(acto, cajaB, x, barrera), devolver(acto, cajaC, y, barrera)]);
        expect(resultados.filter((r) => r === "ok"), JSON.stringify(resultados)).toHaveLength(esperadas);
        for (const r of resultados.filter((r) => r !== "ok")) expect(r).toBe("acto:devolucion_supera_lo_cobrado");
      }
    },
  );
});
