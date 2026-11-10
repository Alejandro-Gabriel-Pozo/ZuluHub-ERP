import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  crearMundoDeCaja,
  otraSucursalDeCaja,
  type MundoDeCaja,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";

/**
 * Concurrencia REAL de la configuración de caja (E3 §5.2): cada prueba lanza varias transacciones a la vez (`Promise.all`) y, con una
 * barrera dentro de la transacción (tras leer la autorización, ANTES de mirar nada más), fuerza que todas hayan empezado antes de que
 * cualquiera escriba. Después mira la base: nunca un estado inválido, nunca un doble efecto, y el perdedor (tras el reintento serializable
 * del adaptador) ve el resultado del ganador.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 8;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;
const cualquierTexto = expect.any(String) as unknown;
const NADA = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };

describe.skipIf(base === null)("configuración de caja: concurrencia", () => {
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
    entorno = crearEntornoDeCaja(propia.base, 12, (tx) => gancho(tx, () => barrera()));
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

  /** Prepara la ronda: `participantes` transacciones esperan tras su primera lectura de la autorización. */
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
  const sinRonda = () => {
    gancho = (tx) => tx;
  };

  const casos = () => caja.casos;
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeCaja(entornoBase, dueno, opciones);
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const auditorias = (m: MundoDeCaja, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const resumen = (rs: readonly { ok: boolean; error?: unknown; valor?: unknown }[]) =>
    rs.map((r) => (r.ok ? "ok" : JSON.stringify(r.error)));

  const crearSinRonda = async <T>(trabajo: () => Promise<T>): Promise<T> => {
    sinRonda();
    return trabajo();
  };

  it("dos crearCaja a la vez con límite 1 y nombres distintos: una sola caja activa, la otra LIMITE_DEL_PLAN", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo({ limiteDeCajas: 1 });
      ronda(2);
      const [a, b] = await Promise.all([
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja A" }),
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja B" }),
      ]);
      sinRonda();
      const ganadoras = [a, b].filter((r) => r.ok);
      const perdedoras = [a, b].filter((r) => !r.ok);
      expect(ganadoras, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toHaveLength(1);
      expect(perdedoras[0]).toMatchObject({
        ok: false,
        error: {
          codigo: "LIMITE_DEL_PLAN",
          perilla: "cajas_por_sucursal",
          limite: 1,
          usoActual: 1,
        },
      });
      expect(
        await contar("select count(*) as n from caja where empresa_id = $1 and activa", [
          m.empresa,
        ]),
        `ronda ${i}`,
      ).toBe(1);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
    }
  });

  it("tres crearCaja a la vez con límite 2: dos cajas y una LIMITE_DEL_PLAN", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo({ limiteDeCajas: 2 });
      ronda(3);
      const rs = await Promise.all(
        ["Caja A", "Caja B", "Caja C"].map((nombre) =>
          casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre }),
        ),
      );
      sinRonda();
      expect(
        rs.filter((r) => r.ok),
        `ronda ${i}: ${resumen(rs).join(" | ")}`,
      ).toHaveLength(2);
      expect(
        await contar("select count(*) as n from caja where empresa_id = $1 and activa", [
          m.empresa,
        ]),
      ).toBe(2);
    }
  });

  it("dos crearCaja iguales a la vez (doble clic): una crea y la otra ve que ya existía; una sola caja y una sola auditoría", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo({ limiteDeCajas: 3 });
      ronda(2);
      const pedido = { sucursalId: m.sucursal, nombre: "Caja 1" };
      const [a, b] = await Promise.all([
        casos().crearCaja(m.ctx(), pedido),
        casos().crearCaja(m.ctx(), pedido),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      const yaExistia = [a, b].map((r) => (r.ok ? r.valor.yaExistia : null));
      expect(yaExistia.filter((v) => v === false)).toHaveLength(1);
      expect(yaExistia.filter((v) => v === true)).toHaveLength(1);
      const ids = new Set([a, b].map((r) => (r.ok ? r.valor.cajaId : "")));
      expect(ids.size).toBe(1);
      expect(
        await contar("select count(*) as n from caja where empresa_id = $1", [m.empresa]),
      ).toBe(1);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
    }
  });

  it("dos crearCaja a la vez en sucursales distintas: las dos entran y hay un solo efectivo y una sola auditoría del medio", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo({ limiteDeCajas: 1 });
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
      ronda(2);
      const [a, b] = await Promise.all([
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
        casos().crearCaja(m.ctx(), { sucursalId: otra, nombre: "Caja 1" }),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      expect(
        await contar("select count(*) as n from caja where empresa_id = $1", [m.empresa]),
      ).toBe(2);
      expect(
        await contar(
          "select count(*) as n from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        ),
      ).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
    }
  });

  it("dos editarCaja a la vez con la misma versión: una cambia el nombre y la otra recibe VERSION_DESACTUALIZADA", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo({ limiteDeCajas: 3 });
      const creada = await crearSinRonda(() =>
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
      );
      const cajaId = creada.ok ? creada.valor.cajaId : "";
      ronda(2);
      const [a, b] = await Promise.all([
        casos().editarCaja(m.ctx(), { cajaId, versionEsperada: 1, nombre: "Caja A" }),
        casos().editarCaja(m.ctx(), { cajaId, versionEsperada: 1, nombre: "Caja B" }),
      ]);
      sinRonda();
      expect(
        [a, b].filter((r) => r.ok),
        `ronda ${i}: ${resumen([a, b]).join(" | ")}`,
      ).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(await filas("select version from caja where id = $1", [cajaId])).toEqual([
        { version: 2 },
      ]);
      expect(await auditorias(m, "CAJA_EDITADA")).toBe(1);
    }
  });

  it("dos editarMedioDePago a la vez con la misma versión: una gana y la otra recibe VERSION_DESACTUALIZADA", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      const creado = await crearSinRonda(() =>
        casos().crearMedioDePago(m.ctx(), { tipo: "TARJETA_DEBITO", nombre: "Visa" }),
      );
      const medioDePagoId = creado.ok ? creado.valor.medioDePagoId : "";
      ronda(2);
      const [a, b] = await Promise.all([
        casos().editarMedioDePago(m.ctx(), {
          medioDePagoId,
          versionEsperada: 1,
          nombre: "Visa A",
          datos: { ...NADA, cupon: true },
        }),
        casos().editarMedioDePago(m.ctx(), {
          medioDePagoId,
          versionEsperada: 1,
          nombre: "Visa B",
          datos: { ...NADA, marca: true },
        }),
      ]);
      sinRonda();
      expect(
        [a, b].filter((r) => r.ok),
        `ronda ${i}: ${resumen([a, b]).join(" | ")}`,
      ).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(
        await filas("select version from medio_de_pago where id = $1", [medioDePagoId]),
      ).toEqual([{ version: 2 }]);
      expect(await auditorias(m, "MEDIO_DE_PAGO_EDITADO")).toBe(1);
    }
  });

  it("dos editarMedioDePago iguales a la vez (doble clic en «Guardar»): las dos van bien y la versión sube una sola vez", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      const creado = await crearSinRonda(() =>
        casos().crearMedioDePago(m.ctx(), { tipo: "TARJETA_CREDITO", nombre: "Visa" }),
      );
      const medioDePagoId = creado.ok ? creado.valor.medioDePagoId : "";
      const pedido = {
        medioDePagoId,
        versionEsperada: 1,
        nombre: "Visa crédito",
        datos: { ...NADA, cuotas: true },
      };
      ronda(2);
      const [a, b] = await Promise.all([
        casos().editarMedioDePago(m.ctx(), pedido),
        casos().editarMedioDePago(m.ctx(), pedido),
      ]);
      sinRonda();
      expect(a, `ronda ${i}`).toEqual({ ok: true, valor: { version: 2 } });
      expect(b, `ronda ${i}`).toEqual({ ok: true, valor: { version: 2 } });
      expect(await auditorias(m, "MEDIO_DE_PAGO_EDITADO")).toBe(1);
    }
  });

  it("dos crearMedioDePago iguales a la vez: uno crea y el otro ve que ya existía; un solo medio y una sola auditoría", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      ronda(2);
      const pedido = { tipo: "QR", nombre: "QR del salón" };
      const [a, b] = await Promise.all([
        casos().crearMedioDePago(m.ctx(), pedido),
        casos().crearMedioDePago(m.ctx(), pedido),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      const yaExistia = [a, b].map((r) => (r.ok ? r.valor.yaExistia : null));
      expect(yaExistia.filter((v) => v === false)).toHaveLength(1);
      expect(yaExistia.filter((v) => v === true)).toHaveLength(1);
      expect(
        await contar("select count(*) as n from medio_de_pago where empresa_id = $1", [m.empresa]),
      ).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
    }
  });

  it("dos crearMedioDePago de efectivo a la vez: uno solo, y el segundo ve que ya existía", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      ronda(2);
      const [a, b] = await Promise.all([
        casos().crearMedioDePago(m.ctx(), { tipo: "EFECTIVO", nombre: null }),
        casos().crearMedioDePago(m.ctx(), { tipo: "EFECTIVO", nombre: null }),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      expect(
        await contar("select count(*) as n from medio_de_pago where empresa_id = $1", [m.empresa]),
      ).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
    }
  });

  it("dos crearCuentaDeCobro iguales a la vez (también con otra capitalización): una cuenta y una auditoría", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      ronda(2);
      const pedido = {
        tipo: "TERMINAL",
        identificadorExterno: "T-1",
        sucursalId: m.sucursal as string,
      };
      const [a, b] = await Promise.all([
        casos().crearCuentaDeCobro(m.ctx(), { ...pedido, nombre: "Terminal 1" }),
        casos().crearCuentaDeCobro(m.ctx(), { ...pedido, nombre: "TERMINAL 1" }),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      expect(
        await contar("select count(*) as n from cuenta_de_cobro where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(1);
      expect(await auditorias(m, "CUENTA_DE_COBRO_CREADA")).toBe(1);
    }
  });

  it("dos editarCuentaDeCobro a la vez con la misma versión: una gana y la otra recibe VERSION_DESACTUALIZADA", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      const creada = await crearSinRonda(() =>
        casos().crearCuentaDeCobro(m.ctx(), {
          tipo: "TERMINAL",
          nombre: "Terminal 1",
          identificadorExterno: null,
          sucursalId: m.sucursal,
        }),
      );
      const cuentaDeCobroId = creada.ok ? creada.valor.cuentaDeCobroId : "";
      ronda(2);
      const entrada = (nombre: string) => ({
        cuentaDeCobroId,
        versionEsperada: 1,
        nombre,
        identificadorExterno: null,
        sucursalId: m.sucursal as string,
      });
      const [a, b] = await Promise.all([
        casos().editarCuentaDeCobro(m.ctx(), entrada("Terminal A")),
        casos().editarCuentaDeCobro(m.ctx(), entrada("Terminal B")),
      ]);
      sinRonda();
      expect(
        [a, b].filter((r) => r.ok),
        `ronda ${i}: ${resumen([a, b]).join(" | ")}`,
      ).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    }
  });

  it("dos desactivarCaja a la vez: una desactiva y la otra ve que ya estaba; una sola auditoría", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      const creada = await crearSinRonda(() =>
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
      );
      const cajaId = creada.ok ? creada.valor.cajaId : "";
      ronda(2);
      const [a, b] = await Promise.all([
        casos().desactivarCaja(m.ctx(), { cajaId }),
        casos().desactivarCaja(m.ctx(), { cajaId }),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      const ya = [a, b].map((r) => (r.ok ? r.valor.yaEstabaInactiva : null));
      expect(ya.filter((v) => v === false)).toHaveLength(1);
      expect(ya.filter((v) => v === true)).toHaveLength(1);
      expect(await auditorias(m, "CAJA_DESACTIVADA")).toBe(1);
    }
  });

  it("dos reactivarCaja a la vez de cajas distintas con límite 1: una vuelve y la otra recibe LIMITE_DEL_PLAN", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo({ limiteDeCajas: 1 });
      const primera = await crearSinRonda(() =>
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
      );
      const idA = primera.ok ? primera.valor.cajaId : "";
      await crearSinRonda(() => casos().desactivarCaja(m.ctx(), { cajaId: idA }));
      const segunda = await crearSinRonda(() =>
        casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 2" }),
      );
      const idB = segunda.ok ? segunda.valor.cajaId : "";
      await crearSinRonda(() => casos().desactivarCaja(m.ctx(), { cajaId: idB }));
      ronda(2);
      const [a, b] = await Promise.all([
        casos().reactivarCaja(m.ctx(), { cajaId: idA }),
        casos().reactivarCaja(m.ctx(), { cajaId: idB }),
      ]);
      sinRonda();
      expect(
        [a, b].filter((r) => r.ok),
        `ronda ${i}: ${resumen([a, b]).join(" | ")}`,
      ).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toMatchObject({
        ok: false,
        error: { codigo: "LIMITE_DEL_PLAN", limite: 1 },
      });
      expect(
        await contar("select count(*) as n from caja where empresa_id = $1 and activa", [
          m.empresa,
        ]),
      ).toBe(1);
    }
  });

  it("dos desactivarMedioDePago a la vez: uno desactiva y el otro ve que ya estaba; una sola auditoría", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await mundo();
      const creado = await crearSinRonda(() =>
        casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre: "QR 1" }),
      );
      const medioDePagoId = creado.ok ? creado.valor.medioDePagoId : "";
      ronda(2);
      const [a, b] = await Promise.all([
        casos().desactivarMedioDePago(m.ctx(), { medioDePagoId }),
        casos().desactivarMedioDePago(m.ctx(), { medioDePagoId }),
      ]);
      sinRonda();
      expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
      const ya = [a, b].map((r) => (r.ok ? r.valor.yaEstabaInactivo : null));
      expect(ya.filter((v) => v === false)).toHaveLength(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_DESACTIVADO")).toBe(1);
    }
  });

  it("una cuenta que se crea a la vez en dos empresas con el mismo nombre no se pisa: cada una tiene la suya", async () => {
    const a = await mundo();
    const b = await mundo();
    ronda(2);
    const [ra, rb] = await Promise.all([
      casos().crearCuentaDeCobro(a.ctx(), {
        tipo: "TERMINAL",
        nombre: "Terminal 1",
        identificadorExterno: null,
        sucursalId: a.sucursal,
      }),
      casos().crearCuentaDeCobro(b.ctx(), {
        tipo: "TERMINAL",
        nombre: "Terminal 1",
        identificadorExterno: null,
        sucursalId: b.sucursal,
      }),
    ]);
    sinRonda();
    expect(ra).toEqual({
      ok: true,
      valor: { cuentaDeCobroId: cualquierTexto, yaExistia: false },
    });
    expect(rb).toEqual({
      ok: true,
      valor: { cuentaDeCobroId: cualquierTexto, yaExistia: false },
    });
    expect(await auditorias(a, "CUENTA_DE_COBRO_CREADA")).toBe(1);
    expect(await auditorias(b, "CUENTA_DE_COBRO_CREADA")).toBe(1);
  });
});
