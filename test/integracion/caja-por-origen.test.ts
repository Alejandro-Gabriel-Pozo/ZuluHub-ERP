import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { cajaParaCompras, cajaParaIngresos } from "../../src/modulos/caja/publico";
import {
  claveDeAnulacionDeOrigen,
  claveDeEgresoDe,
  claveDeIngresoDe,
} from "../../src/modulos/caja/dominio/origen-de-movimiento";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  CERO,
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * LB-5: los puertos de caja por ORIGEN, el de egreso (con la entrega a rendir) y el de ingreso (reintegro de un proveedor, devolución del sobrante), con una base
 * real y una barrera. Cada origen es UN movimiento de efectivo por empresa: repetirlo (doble clic, reintento) o hacerlo a la vez no mete ni saca la plata dos
 * veces; sin sesión abierta no se escribe nada; una falla posterior deshace el movimiento; la anulación es un registro nuevo y no se duplica; la clave derivada
 * no la puede ocupar quien registra movimientos manuales (el permiso del operador no abre estos orígenes).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;
type Salida = Readonly<{ movimientoId: string; sesionId: string; yaExistia: boolean }>;
type Pedido = Readonly<{
  cajaId: string;
  sucursalId: string;
  origenId: string;
  importe?: string;
  motivo?: string;
}>;
type Variante = Readonly<{
  nombre: string;
  tipo: string;
  /** El signo con el que queda el movimiento: el ingreso suma, el egreso resta. */
  signo: 1 | -1;
  clase: "INGRESO_MANUAL" | "EGRESO_MANUAL";
  clave: (id: string) => string;
  registrar: (
    tx: TxDeCajaDePrueba,
    ctx: ContextoOperativo,
    pedido: Pedido,
    origenTipo?: string,
  ) => Promise<Resultado<Salida, unknown>>;
  anular: (
    tx: TxDeCajaDePrueba,
    ctx: ContextoOperativo,
    origenId: string,
    motivo?: string,
  ) => Promise<Resultado<{ anulacionId: string | null }, unknown>>;
}>;

const entradaDe = (p: Pedido) => ({
  cajaId: p.cajaId,
  sucursalId: p.sucursalId,
  importe: pesos(p.importe ?? "10.00"),
  motivo: p.motivo ?? "Operación de prueba",
});

const deIngreso = (tipo: "REINTEGRO_DE_PROVEEDOR" | "DEVOLUCION_DE_SOBRANTE"): Variante => ({
  nombre: `ingreso ${tipo}`,
  tipo,
  signo: 1,
  clase: "INGRESO_MANUAL",
  clave: (id) => claveDeIngresoDe({ tipo, id }),
  registrar: (tx, ctx, p, origenTipo) =>
    cajaParaIngresos.registrarIngresoEnTx(tx, ctx, {
      ...entradaDe(p),
      origen: { tipo: (origenTipo ?? tipo) as typeof tipo, id: p.origenId },
    }),
  anular: (tx, ctx, id, motivo = "Se anula la operación") =>
    cajaParaIngresos.anularIngresoEnTx(tx, ctx, { origen: { tipo, id }, motivo }),
});

const deEgreso = (tipo: "PAGO_A_PROVEEDOR" | "ENTREGA_A_RENDIR"): Variante => ({
  nombre: `egreso ${tipo}`,
  tipo,
  signo: -1,
  clase: "EGRESO_MANUAL",
  clave: (id) => claveDeEgresoDe({ tipo, id }),
  registrar: (tx, ctx, p, origenTipo) =>
    cajaParaCompras.registrarEgresoEnTx(tx, ctx, {
      ...entradaDe(p),
      origen: { tipo: (origenTipo ?? tipo) as typeof tipo, id: p.origenId },
    }),
  anular: (tx, ctx, id, motivo = "Se anula la operación") =>
    cajaParaCompras.anularEgresoEnTx(tx, ctx, { origen: { tipo, id }, motivo }),
});

const VARIANTES: readonly Variante[] = [
  deIngreso("REINTEGRO_DE_PROVEEDOR"),
  deIngreso("DEVOLUCION_DE_SOBRANTE"),
  deEgreso("PAGO_A_PROVEEDOR"),
  deEgreso("ENTREGA_A_RENDIR"),
];

describe.skipIf(base === null)("caja: movimientos de efectivo por origen", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 16, (tx) => gancho(tx, () => barrera()));
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  /** Las transacciones de la ronda esperan a que lleguen todas después de leer la caja (antes de escribir): así de verdad corren a la vez. */
  const ronda = (participantes: number) => {
    barrera = crearBarrera(participantes);
    gancho = (tx, esperar) => {
      let primera = true;
      const original = tx.cajas;
      return {
        ...tx,
        cajas: {
          ...original,
          obtener: async (...argumentos: Parameters<typeof original.obtener>) => {
            const r = await original.obtener(...argumentos);
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
  const sinRonda = () => {
    gancho = (tx) => tx;
  };
  const aLaVez = async <T>(
    tareas: readonly (() => Promise<T>)[],
    participantes = tareas.length,
  ): Promise<T[]> => {
    ronda(participantes);
    try {
      return await Promise.all(tareas.map((t) => t()));
    } finally {
      sinRonda();
    }
  };

  const filas = async <T extends Record<string, unknown>>(texto: string, parametros: unknown[]) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[]) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = () => crearMundoDeOperacion(entornoBase, dueno, caja);
  const en = (minutos = 5) => new Date(instanteLocal(1, "10:00").getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeOperacion, minutos = 5) => conAhora(m.ctx(), en(minutos));
  const abrir = async (m: MundoDeOperacion) => {
    const r = await caja.casos.abrirSesion(ctxEn(m, 0), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos("1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const pedido = (
    m: MundoDeOperacion,
    origenId: string = randomUUID(),
    resto: Partial<Pedido> = {},
  ) => ({
    cajaId: m.cajaId,
    sucursalId: m.sucursal,
    origenId,
    ...resto,
  });
  /** Corre una operación en una transacción serializable, como la compuesta de quien la usa. */
  const correr = <T, E>(
    ctx: ContextoOperativo,
    trabajo: (tx: TxDeCajaDePrueba) => Promise<Resultado<T, E>>,
  ) => entorno.ejecutar({ contexto: ctx, reintentos: 20 }, trabajo);
  const registrar = (v: Variante, m: MundoDeOperacion, p: Pedido, ctx = ctxEn(m)) =>
    correr(ctx, (tx) => v.registrar(tx, ctx, p));
  const anular = (v: Variante, m: MundoDeOperacion, origenId: string, motivo?: string) => {
    const ctx = ctxEn(m, 20);
    return correr(ctx, (tx) => v.anular(tx, ctx, origenId, motivo));
  };
  const movimientos = (m: MundoDeOperacion, clave: string) =>
    filas<{ id: string; clase: string; importe: string; anula_a: string | null; medio: string }>(
      `select mc.id, mc.clase, mc.importe::text, mc.anula_a, mp.tipo as medio
         from movimiento_caja mc join medio_de_pago mp on mp.id = mc.medio_de_pago_id
        where mc.empresa_id = $1 and mc.clave_idempotencia = $2`,
      [m.empresa, clave],
    );
  const totalDeMovimientos = (m: MundoDeOperacion) =>
    contar("select count(*) as n from movimiento_caja where empresa_id = $1", [m.empresa]);
  const esperado = async (sesionId: string) =>
    (
      await filas<{ s: string }>(
        "select coalesce(sum(importe), 0)::text as s from movimiento_caja where sesion_id = $1",
        [sesionId],
      )
    )[0]?.s;
  const auditorias = (m: MundoDeOperacion, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const monto = (v: Variante, base: number, cantidad = 1) =>
    (base + v.signo * 10 * cantidad).toFixed(2);

  describe.each(VARIANTES)("$nombre", (v) => {
    it("registra UN movimiento de efectivo con su signo, su clave derivada y su auditoría, en la sesión abierta", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const origen = randomUUID();
      const r = await registrar(v, m, pedido(m, origen));
      expect(r.ok).toBe(true);
      const salida = r.ok ? r.valor : null;
      expect(salida).toMatchObject({ sesionId: sesion, yaExistia: false });
      const filasDelOrigen = await movimientos(m, v.clave(origen));
      expect(filasDelOrigen).toHaveLength(1);
      expect(filasDelOrigen[0]).toMatchObject({
        id: salida?.movimientoId,
        clase: v.clase,
        importe: v.signo === 1 ? "10.00" : "-10.00",
        anula_a: null,
        medio: "EFECTIVO",
      });
      expect(await esperado(sesion)).toBe(monto(v, 1000));
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
    });

    it("misma clave dos veces (doble clic): un solo movimiento y una sola auditoría; la segunda devuelve yaExistia con lo mismo", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const p = pedido(m);
      const primera = await registrar(v, m, p);
      const segunda = await registrar(v, m, p);
      expect(primera.ok && segunda.ok).toBe(true);
      if (!primera.ok || !segunda.ok) return;
      expect(segunda.valor).toEqual({ ...primera.valor, yaExistia: true });
      expect(await movimientos(m, v.clave(p.origenId))).toHaveLength(1);
      expect(await esperado(sesion)).toBe(monto(v, 1000));
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
    });

    it("el mismo uuid escrito en mayúsculas es el mismo origen: no se duplica", async () => {
      const m = await mundo();
      await abrir(m);
      const id = randomUUID();
      const primera = await registrar(v, m, pedido(m, id));
      const segunda = await registrar(v, m, pedido(m, id.toUpperCase()));
      expect(primera.ok && segunda.ok).toBe(true);
      expect(segunda.ok && segunda.valor.yaExistia).toBe(true);
      expect(await totalDeMovimientos(m)).toBe(2); // el fondo inicial y el movimiento
    });

    it("el mismo origen con otro importe o con otro motivo es CLAVE_REUTILIZADA y no escribe", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const p = pedido(m);
      expect((await registrar(v, m, p)).ok).toBe(true);
      expect(await registrar(v, m, { ...p, importe: "11.00" })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await registrar(v, m, { ...p, motivo: "Otro motivo" })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await esperado(sesion)).toBe(monto(v, 1000));
    });

    it("el reintento después de cerrada la caja devuelve lo hecho (la clave se busca ANTES de mirar la sesión)", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const p = pedido(m);
      const primera = await registrar(v, m, p);
      const cierre = await caja.casos.cerrarSesion(ctxEn(m, 30), {
        sesionId: sesion,
        conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(cierre.ok).toBe(true);
      const repetida = await registrar(v, m, p, ctxEn(m, 40));
      expect(repetida.ok && primera.ok && repetida.valor.movimientoId).toBe(
        primera.ok ? primera.valor.movimientoId : null,
      );
      expect(repetida.ok && repetida.valor.yaExistia).toBe(true);
    });

    it("sin sesión abierta falla cerrado, con su error, y no escribe nada", async () => {
      const m = await mundo();
      const origen = randomUUID();
      const r = await registrar(v, m, pedido(m, origen));
      expect(r).toEqual({
        ok: false,
        error: { codigo: "SIN_SESION_ABIERTA", cajaId: m.cajaId },
      });
      expect(await totalDeMovimientos(m)).toBe(0);
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(0);
    });

    it("con la sesión en cierre falla cerrado (CAJA_EN_CIERRE) y no escribe", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const cierre = await caja.casos.iniciarCierre(ctxEn(m, 10), { sesionId: sesion });
      expect(cierre.ok).toBe(true);
      const r = await registrar(v, m, pedido(m));
      expect(r).toEqual({
        ok: false,
        error: { codigo: "CAJA_EN_CIERRE", cajaId: m.cajaId, sesionId: sesion },
      });
      expect(await totalDeMovimientos(m)).toBe(1); // solo el fondo
    });

    it("con la sesión ya cerrada falla cerrado (SIN_SESION_ABIERTA)", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const cierre = await caja.casos.cerrarSesion(ctxEn(m, 10), {
        sesionId: sesion,
        conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(cierre.ok).toBe(true);
      const r = await registrar(v, m, pedido(m), ctxEn(m, 40));
      expect(r.ok).toBe(false);
      expect(!r.ok && (r.error as { codigo: string }).codigo).toBe("SIN_SESION_ABIERTA");
      expect(await totalDeMovimientos(m)).toBe(1);
    });

    it("aislamiento: una caja de otra empresa es CAJA_NO_ENCONTRADA y no escribe en ninguna", async () => {
      const m = await mundo();
      const otra = await mundo();
      await abrir(m);
      await abrir(otra);
      const r = await registrar(v, m, { ...pedido(m), cajaId: otra.cajaId });
      expect(r).toEqual({ ok: false, error: "CAJA_NO_ENCONTRADA" });
      expect(await totalDeMovimientos(m)).toBe(1);
      expect(await totalDeMovimientos(otra)).toBe(1);
    });

    it("aislamiento: la misma clave en dos empresas son dos movimientos, uno por empresa", async () => {
      const a = await mundo();
      const b = await mundo();
      await abrir(a);
      await abrir(b);
      const origen = randomUUID();
      expect((await registrar(v, a, pedido(a, origen))).ok).toBe(true);
      const enB = await registrar(v, b, pedido(b, origen));
      expect(enB.ok && enB.valor.yaExistia).toBe(false);
      expect(await movimientos(a, v.clave(origen))).toHaveLength(1);
      expect(await movimientos(b, v.clave(origen))).toHaveLength(1);
    });

    it("una caja de otra sucursal es CAJA_DE_OTRA_SUCURSAL, una caja inactiva es CAJA_INACTIVA, y no escribe", async () => {
      const m = await mundo();
      const otraSucursal = await otraSucursalDeCaja(dueno, m.empresa, "Otra");
      expect(await registrar(v, m, { ...pedido(m), sucursalId: otraSucursal })).toEqual({
        ok: false,
        error: "CAJA_DE_OTRA_SUCURSAL",
      });
      await dueno.query("update caja set activa = false where id = $1", [m.cajaId]);
      expect(await registrar(v, m, pedido(m))).toEqual({ ok: false, error: "CAJA_INACTIVA" });
      expect(await totalDeMovimientos(m)).toBe(0);
    });

    it("rechaza lo que no es un origen de su lista cerrada y no escribe", async () => {
      const m = await mundo();
      await abrir(m);
      const ctx = ctxEn(m);
      for (const tipo of ["OTRO", "COBRO", "pago_a_proveedor"]) {
        const r = await correr(ctx, (tx) => v.registrar(tx, ctx, pedido(m), tipo));
        expect(r, tipo).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
      }
      const r = await registrar(v, m, pedido(m, "no-es-un-uuid"));
      expect(r).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
      expect(await anular(v, m, "no-es-un-uuid")).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
      expect(await totalDeMovimientos(m)).toBe(1);
    });

    it("importe y motivo se validan: cero, negativo, texto y motivo vacío se rechazan sin escribir", async () => {
      const m = await mundo();
      await abrir(m);
      for (const importe of ["0.00", "-5.00", "abc"]) {
        const r = await registrar(v, m, { ...pedido(m), importe });
        expect(r.ok, importe).toBe(false);
      }
      expect((await registrar(v, m, { ...pedido(m), motivo: "   " })).ok).toBe(false);
      expect(await totalDeMovimientos(m)).toBe(1);
    });

    it("sin persona en el contexto es SIN_PERMISO y no escribe", async () => {
      const m = await mundo();
      await abrir(m);
      const ctx = { ...ctxEn(m), personaId: null } as unknown as ContextoOperativo;
      const r = await correr(ctx, (tx) => v.registrar(tx, ctx, pedido(m)));
      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      const a = await correr(ctx, (tx) => v.anular(tx, ctx, randomUUID()));
      expect(a).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await totalDeMovimientos(m)).toBe(1);
    });

    it("solo corre en una transacción serializable", async () => {
      const m = await mundo();
      await abrir(m);
      const ctx = ctxEn(m);
      await expect(
        entorno.ejecutar({ contexto: ctx, aislamiento: "read committed" }, (tx) =>
          v.registrar(tx, ctx, pedido(m)),
        ),
      ).rejects.toThrow(/solo corre en una transacción serializable/);
      expect(await totalDeMovimientos(m)).toBe(1);
    });

    it("atomicidad: si lo que sigue al movimiento falla, el movimiento y su auditoría se deshacen (por error de negocio y por excepción)", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ctx = ctxEn(m);
      const porError = await correr(ctx, async (tx) => {
        const r = await v.registrar(tx, ctx, pedido(m));
        expect(r.ok).toBe(true);
        return { ok: false as const, error: "FALLA_POSTERIOR" };
      });
      expect(porError).toEqual({ ok: false, error: "FALLA_POSTERIOR" });
      await expect(
        correr(ctx, async (tx) => {
          await v.registrar(tx, ctx, pedido(m));
          throw new Error("falla posterior");
        }),
      ).rejects.toThrow("falla posterior");
      expect(await totalDeMovimientos(m)).toBe(1);
      expect(await esperado(sesion)).toBe("1000.00");
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(0);
    });

    it("concurrencia: el mismo origen a la vez (varias veces) deja UN movimiento; todos ven lo mismo y uno solo lo escribió", async () => {
      for (let i = 0; i < 3; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const p = pedido(m);
        const rs = await aLaVez(Array.from({ length: 5 }, () => () => registrar(v, m, p)));
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(rs),
        ).toBe(true);
        const salidas = rs.flatMap((r) => (r.ok ? [r.valor] : []));
        expect(new Set(salidas.map((s) => s.movimientoId)).size).toBe(1);
        expect(salidas.filter((s) => !s.yaExistia)).toHaveLength(1);
        expect(await movimientos(m, v.clave(p.origenId))).toHaveLength(1);
        expect(await esperado(sesion)).toBe(monto(v, 1000));
        expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
      }
    });

    it("concurrencia: orígenes distintos a la vez se suman sin pisarse", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const rs = await aLaVez(Array.from({ length: 5 }, () => () => registrar(v, m, pedido(m))));
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      expect(await esperado(sesion)).toBe(monto(v, 1000, 5));
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(5);
    });

    it("concurrencia: contra el cierre de la sesión, todo lo confirmado queda contado en el esperado del arqueo y lo rechazado no escribe", async () => {
      let confirmados = 0;
      for (let i = 0; i < 3; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const rs = await aLaVez(
          [
            () =>
              caja.casos.cerrarSesion(ctxEn(m, 30), {
                sesionId: sesion,
                conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
                otros: [],
                conformeGeneral: false,
                observacion: null,
              }),
            ...Array.from({ length: 4 }, () => () => registrar(v, m, pedido(m))),
          ] as readonly (() => Promise<{ ok: boolean; error?: unknown }>)[],
          4,
        ); // el cierre no pasa por la barrera: solo las 4 operaciones
        const [cierre, ...operaciones] = rs;
        expect(cierre?.ok, JSON.stringify(rs)).toBe(true);
        const buenas = operaciones.filter((r) => r.ok);
        for (const r of operaciones.filter((o) => !o.ok)) {
          expect(["SIN_SESION_ABIERTA", "CAJA_EN_CIERRE"]).toContain(
            (r.error as { codigo: string }).codigo,
          );
        }
        confirmados += buenas.length;
        const [linea] = await filas<{ esperado: string }>(
          "select esperado::text from arqueo_caja where sesion_id = $1",
          [sesion],
        );
        expect(linea?.esperado).toBe(monto(v, 1000, buenas.length));
        expect(await totalDeMovimientos(m)).toBe(1 + buenas.length);
      }
      expect(confirmados).toBeGreaterThanOrEqual(0);
    });

    describe("anular", () => {
      it("registra el movimiento inverso (otra fila, nunca borra), con su auditoría; la plata vuelve a su lugar", async () => {
        const m = await mundo();
        const sesion = await abrir(m);
        const p = pedido(m);
        const hecho = await registrar(v, m, p);
        expect(hecho.ok).toBe(true);
        const r = await anular(v, m, p.origenId, "Se anula la operación");
        expect(r.ok).toBe(true);
        const anulacionId = r.ok ? r.valor.anulacionId : null;
        expect(anulacionId).not.toBeNull();
        const espejo = await movimientos(m, claveDeAnulacionDeOrigen(v.clave(p.origenId)));
        expect(espejo).toHaveLength(1);
        expect(espejo[0]).toMatchObject({
          id: anulacionId,
          clase: "ANULACION",
          importe: v.signo === 1 ? "-10.00" : "10.00",
          anula_a: hecho.ok ? hecho.valor.movimientoId : null,
          medio: "EFECTIVO",
        });
        expect(await movimientos(m, v.clave(p.origenId))).toHaveLength(1); // el original sigue
        expect(await esperado(sesion)).toBe("1000.00");
        expect(await auditorias(m, "MOVIMIENTO_ANULADO")).toBe(1);
      });

      it("anular dos veces no duplica el inverso: la segunda es MOVIMIENTO_YA_ANULADO", async () => {
        const m = await mundo();
        const sesion = await abrir(m);
        const p = pedido(m);
        await registrar(v, m, p);
        expect((await anular(v, m, p.origenId)).ok).toBe(true);
        expect(await anular(v, m, p.origenId)).toEqual({
          ok: false,
          error: "MOVIMIENTO_YA_ANULADO",
        });
        expect(await esperado(sesion)).toBe("1000.00");
        expect(await auditorias(m, "MOVIMIENTO_ANULADO")).toBe(1);
      });

      it("concurrencia: dos anulaciones a la vez dejan UN solo inverso", async () => {
        for (let i = 0; i < 3; i += 1) {
          const m = await mundo();
          const sesion = await abrir(m);
          const p = pedido(m);
          await registrar(v, m, p);
          const ctx = ctxEn(m, 20);
          const rs = await aLaVez(
            Array.from(
              { length: 3 },
              () => () => correr(ctx, (tx) => v.anular(tx, ctx, p.origenId)),
            ),
          );
          expect(rs.filter((r) => r.ok)).toHaveLength(1);
          for (const r of rs.filter((o) => !o.ok))
            expect(r).toEqual({ ok: false, error: "MOVIMIENTO_YA_ANULADO" });
          expect(
            await contar(
              "select count(*) as n from movimiento_caja where empresa_id = $1 and clase = 'ANULACION'",
              [m.empresa],
            ),
          ).toBe(1);
          expect(await esperado(sesion)).toBe("1000.00");
        }
      });

      it("sin movimiento para ese origen no hay nada que anular y no escribe (anulacionId null)", async () => {
        const m = await mundo();
        await abrir(m);
        expect(await anular(v, m, randomUUID())).toEqual({
          ok: true,
          valor: { anulacionId: null },
        });
        expect(await totalDeMovimientos(m)).toBe(1);
      });

      it("el motivo es obligatorio", async () => {
        const m = await mundo();
        await abrir(m);
        const p = pedido(m);
        await registrar(v, m, p);
        expect(await anular(v, m, p.origenId, "  ")).toEqual({
          ok: false,
          error: "MOTIVO_INVALIDO",
        });
      });

      it("con la sesión ya cerrada no se anula: hay que corregirlo en caja", async () => {
        const m = await mundo();
        const sesion = await abrir(m);
        const p = pedido(m);
        await registrar(v, m, p);
        const cierre = await caja.casos.cerrarSesion(ctxEn(m, 10), {
          sesionId: sesion,
          conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
          otros: [],
          conformeGeneral: false,
          observacion: null,
        });
        expect(cierre.ok).toBe(true);
        expect(await anular(v, m, p.origenId)).toEqual({ ok: false, error: "SESION_CERRADA" });
      });

      it("aislamiento: otra empresa con el mismo origen no puede anular el movimiento de ésta (no encuentra nada)", async () => {
        const a = await mundo();
        const b = await mundo();
        await abrir(a);
        await abrir(b);
        const p = pedido(a);
        await registrar(v, a, p);
        expect(await anular(v, b, p.origenId)).toEqual({ ok: true, valor: { anulacionId: null } });
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where clase = 'ANULACION' and empresa_id = $1",
            [a.empresa],
          ),
        ).toBe(0);
      });
    });
  });

  describe("el egreso de la entrega a rendir", () => {
    const entrega = deEgreso("ENTREGA_A_RENDIR");

    it("una entrega mayor al efectivo esperado se PERMITE y deja EGRESO_SUPERA_EFECTIVO (misma regla que el egreso manual)", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const r = await registrar(entrega, m, pedido(m, randomUUID(), { importe: "1500.00" }));
      expect(r.ok).toBe(true);
      expect(await esperado(sesion)).toBe("-500.00");
      expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(1);
    });

    it("una entrega que no supera el efectivo no deja el aviso", async () => {
      const m = await mundo();
      await abrir(m);
      expect(
        (await registrar(entrega, m, pedido(m, randomUUID(), { importe: "1000.00" }))).ok,
      ).toBe(true);
      expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(0);
    });
  });

  describe("permisos: el movimiento manual del operador no abre estos orígenes", () => {
    it("el operador no puede ocupar la clave derivada de un origen con un movimiento manual: la rechaza y no escribe; el gerente puede usar el origen después", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const origen = randomUUID();
      const reservadas = [
        claveDeIngresoDe({ tipo: "REINTEGRO_DE_PROVEEDOR", id: origen }),
        claveDeIngresoDe({ tipo: "DEVOLUCION_DE_SOBRANTE", id: origen }),
        claveDeEgresoDe({ tipo: "ENTREGA_A_RENDIR", id: origen }),
        claveDeEgresoDe({ tipo: "PAGO_A_PROVEEDOR", id: origen }),
        claveDeAnulacionDeOrigen(claveDeEgresoDe({ tipo: "ENTREGA_A_RENDIR", id: origen })),
      ];
      for (const claveDeIdempotencia of reservadas) {
        for (const sentido of ["INGRESO", "EGRESO"] as const) {
          const r = await caja.casos.registrarMovimientoManual(conAhora(operador(), en()), {
            claveDeIdempotencia,
            sesionId: sesion,
            sentido,
            importe: pesos("10.00"),
            motivo: "Intento de ocupar la clave",
          });
          expect(r, claveDeIdempotencia).toEqual({
            ok: false,
            error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
          });
        }
      }
      expect(await totalDeMovimientos(m)).toBe(1);
      const entrega = await registrar(deEgreso("ENTREGA_A_RENDIR"), m, pedido(m, origen));
      expect(entrega.ok && entrega.valor.yaExistia).toBe(false);
    });

    it("el operador sigue registrando sus movimientos manuales con claves de pantalla (uuid)", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const r = await caja.casos.registrarMovimientoManual(conAhora(operador(), en()), {
        claveDeIdempotencia: claveNueva(),
        sesionId: sesion,
        sentido: "INGRESO",
        importe: pesos("10.00"),
        motivo: "Cambio",
      });
      expect(r.ok).toBe(true);
    });
  });
});
