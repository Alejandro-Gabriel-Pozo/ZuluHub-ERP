import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cajaParaVentas,
  traducirErroresDelCobro,
  type EntradaDeRegistrarCobro,
} from "../../src/modulos/caja/publico";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  ACCION_DE_VENTA_FALSA,
  cobrarComoVentas,
  crearMundoDeCobro,
  entradaDeCobro,
  importe,
  origenNuevo,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import {
  CERO,
  armarCierreDeJornada,
  claveNueva,
  conAhora,
  fechaLocal,
  instanteLocal,
  pesos,
} from "./caja-operacion-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * El puerto «cobrar» de caja para ventas (E3, tramo 6; e3 §3.5, §3.6 y §5) con una base real, los roles limitados de la aplicación y una
 * «caja falsa de ventas» que arma la transacción del llamador (`caja-cobrar-apoyo.ts`): lectura previa (los tres estados de la caja),
 * opciones de cobro (solo lo activo), el cobro (validaciones, caja y sesión, medio ↔ cuenta, datos del cobro, jornada vencida, auditoría
 * sin valores), la atomicidad con la venta, el aislamiento entre empresas y `cobrosPorOrigen`. La concurrencia y la idempotencia están en
 * `caja-cobrar-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;
const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";
const BILLETE_DE_MIL = { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO };
const NADIE = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };

describe.skipIf(base === null)("puerto de cobrar: la caja para ventas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierreDelDia: ReturnType<typeof armarCierreDeJornada>;
  /** Falla inyectada: cuando está puesta, el repositorio de cobros lanza DESPUÉS de que el movimiento ya se insertó. */
  let fallaEnElCobro = false;
  /** Cuántas veces tocó la autorización el puerto (no debe tocarla). */
  let llamadasDeAutorizacion = 0;
  let contarAutorizacion = false;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8, (tx): TxDeCajaDePrueba => ({
      ...tx,
      cobros: {
        ...tx.cobros,
        insertar: async (nuevo) => {
          if (fallaEnElCobro) throw new Error("falla inyectada entre el movimiento y el cobro");
          return tx.cobros.insertar(nuevo);
        },
      },
      autorizacion: contarAutorizacion
        ? {
            delActor: (...a) => {
              llamadasDeAutorizacion += 1;
              return tx.autorizacion.delActor(...a);
            },
            sucursalesDelActor: (...a) => {
              llamadasDeAutorizacion += 1;
              return tx.autorizacion.sucursalesDelActor(...a);
            },
          }
        : tx.autorizacion,
    }));
    caja = armarCaja(entorno);
    cierreDelDia = armarCierreDeJornada(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const casos = () => caja.casos;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeCobro(entornoBase, dueno, caja, opciones);
  const en = (dias: number, minutos = 0, hora = "10:00") =>
    new Date(instanteLocal(dias, hora).getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeCobro, dias = 1, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), en(dias, minutos, hora));
  const abrir = async (m: MundoDeCobro, dias = 1, minutos = 0, hora = "10:00") => {
    const r = await casos().abrirSesion(ctxEn(m, dias, minutos, hora), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos("1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const cobrar = (
    m: MundoDeCobro,
    cambios: Partial<EntradaDeRegistrarCobro> = {},
    ctx = ctxEn(m, 1, 5),
  ) => cobrarComoVentas(entorno, ctx, entradaDeCobro(m, cambios));
  /** Todo lo que escribe un cobro, de una empresa: movimientos de cobro, filas de cobro y auditorías del cobro y de la venta falsa. */
  const rastros = async (m: MundoDeCobro) => ({
    movimientos: await contar(
      "select count(*) as n from movimiento_caja where empresa_id = $1 and clase = 'COBRO'",
      [m.empresa],
    ),
    cobros: await contar("select count(*) as n from cobro where empresa_id = $1", [m.empresa]),
    auditorias: await contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion in ('COBRO_REGISTRADO', 'COBRO_EN_JORNADA_VENCIDA', $2)",
      [m.empresa, ACCION_DE_VENTA_FALSA],
    ),
  });
  const SIN_RASTROS = { movimientos: 0, cobros: 0, auditorias: 0 };
  /** Lee con el rol de la aplicación, en solo lectura (si el puerto escribiera, la base lo rechazaría). */
  const leer = <T>(
    m: MundoDeCobro,
    trabajo: (tx: TxDeCajaDePrueba) => Promise<T>,
    ctx = ctxEn(m, 1, 5),
  ) =>
    entorno.ejecutar(
      { contexto: ctx, aislamiento: "read committed", soloLectura: true },
      async (tx) => ok(await trabajo(tx)),
    );
  /** Habilita datos en un medio por el caso de uso real (`editarMedioDePago`, el que usa el administrador). */
  const habilitar = async (
    m: MundoDeCobro,
    tipo: keyof MundoDeCobro["medios"],
    datos: Partial<typeof NADIE>,
  ) => {
    const id = m.medios[tipo];
    const [fila] = await filas<{ version: number; nombre: string | null }>(
      "select version, nombre from medio_de_pago where id = $1",
      [id],
    );
    const r = await casos().editarMedioDePago(m.ctx(), {
      medioDePagoId: id,
      versionEsperada: fila?.version as number,
      nombre: fila?.nombre ?? null,
      datos: { ...NADIE, ...datos },
    });
    if (!r.ok) throw new Error(`no se pudo editar el medio: ${JSON.stringify(r.error)}`);
  };
  const marca = async (nombre: string) =>
    (await filas<{ id: string }>("select id from valor_de_lista where nombre = $1", [nombre]))[0]
      ?.id as string;

  // =============================================================================================
  describe("estadoDeCajasParaCobrar (la lectura previa, decisión 145)", () => {
    it("sin sesión, abierta y en cierre: los tres estados, y una sesión cerrada vuelve a ser SIN_SESION", async () => {
      const m = await mundo();
      const estado = async (ahora = ctxEn(m, 1, 1)) => {
        const r = await leer(m, (tx) =>
          cajaParaVentas.estadoDeCajasParaCobrar(tx, ahora, m.sucursal),
        );
        if (!r.ok || !r.valor.ok) throw new Error(JSON.stringify(r));
        return r.valor.valor;
      };
      expect((await estado()).cajas).toEqual([
        {
          cajaId: m.cajaId,
          nombre: "Caja 1",
          estado: "SIN_SESION",
          sesionId: null,
          fechaDeNegocio: null,
          jornadaVencida: false,
        },
      ]);
      const sesion = await abrir(m);
      expect((await estado()).cajas).toEqual([
        {
          cajaId: m.cajaId,
          nombre: "Caja 1",
          estado: "ABIERTA",
          sesionId: sesion,
          fechaDeNegocio: fechaLocal(en(1)),
          jornadaVencida: false,
        },
      ]);
      expect((await casos().iniciarCierre(ctxEn(m, 1, 20), { sesionId: sesion })).ok).toBe(true);
      const enCierre = (await estado()).cajas[0];
      expect(enCierre).toMatchObject({ estado: "EN_CIERRE", sesionId: sesion });
      expect(
        (
          await casos().cerrarSesion(ctxEn(m, 1, 30), {
            sesionId: sesion,
            conteo: BILLETE_DE_MIL,
            otros: [],
            conformeGeneral: false,
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      expect((await estado()).cajas[0]).toMatchObject({
        estado: "SIN_SESION",
        sesionId: null,
        fechaDeNegocio: null,
      });
    });

    it("una sucursal sin cajas devuelve cajas: [] y la consulta no escribe nada (ni la caja por defecto ni la jornada)", async () => {
      const m = await mundo();
      const vacia = await otraSucursalDeCaja(dueno, m.empresa, "Sin cajas");
      const antes = {
        cajas: await contar("select count(*) as n from caja where empresa_id = $1", [m.empresa]),
        jornadas: await contar(
          "select count(*) as n from jornada_de_sucursal where empresa_id = $1",
          [m.empresa],
        ),
        sesiones: await contar("select count(*) as n from sesion_caja where empresa_id = $1", [
          m.empresa,
        ]),
        auditoria: await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1",
          [m.empresa],
        ),
      };
      const r = await leer(m, (tx) =>
        cajaParaVentas.estadoDeCajasParaCobrar(tx, ctxEn(m, 1, 1), vacia),
      );
      expect(r.ok && r.valor.ok && r.valor.valor.cajas).toEqual([]);
      expect(r.ok && r.valor.ok && r.valor.valor.jornadaActual).toEqual({
        fechaDeNegocio: fechaLocal(en(1)),
        estado: "ABIERTA",
      });
      expect({
        cajas: await contar("select count(*) as n from caja where empresa_id = $1", [m.empresa]),
        jornadas: await contar(
          "select count(*) as n from jornada_de_sucursal where empresa_id = $1",
          [m.empresa],
        ),
        sesiones: await contar("select count(*) as n from sesion_caja where empresa_id = $1", [
          m.empresa,
        ]),
        auditoria: await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1",
          [m.empresa],
        ),
      }).toEqual(antes);
    });

    it("las cajas desactivadas y las de otra sucursal no figuran; las activas, por nombre", async () => {
      const m = await mundo();
      const segunda = await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Barra" });
      const tercera = await casos().crearCaja(m.ctx(), {
        sucursalId: m.sucursal,
        nombre: "Antigua",
      });
      // El límite del plan es una caja por sucursal por defecto: el escenario usa el dueño de la base si el caso no deja.
      const idSegunda = segunda.ok
        ? segunda.valor.cajaId
        : (
            await filas<{ id: string }>(
              "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Barra') returning id",
              [m.empresa, m.sucursal],
            )
          )[0]?.id;
      const idTercera = tercera.ok
        ? tercera.valor.cajaId
        : (
            await filas<{ id: string }>(
              "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Antigua') returning id",
              [m.empresa, m.sucursal],
            )
          )[0]?.id;
      await dueno.query("update caja set activa = false where id = $1", [idTercera]);
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Otra");
      await dueno.query(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'De otra')",
        [m.empresa, otra],
      );
      const r = await leer(m, (tx) =>
        cajaParaVentas.estadoDeCajasParaCobrar(tx, ctxEn(m, 1, 1), m.sucursal),
      );
      expect(r.ok && r.valor.ok && r.valor.valor.cajas.map((c) => c.nombre)).toEqual([
        "Barra",
        "Caja 1",
      ]);
      expect(idSegunda).toBeDefined();
    });

    it("la jornada de hoy: sin actividad o abierta es ABIERTA, en auditoría es EN_AUDITORIA, cerrada es CERRADA", async () => {
      const m = await mundo();
      const jornada = async (ahora: Date) => {
        const r = await leer(m, (tx) =>
          cajaParaVentas.estadoDeCajasParaCobrar(tx, conAhora(m.ctx(), ahora), m.sucursal),
        );
        return r.ok && r.valor.ok ? r.valor.valor.jornadaActual : r;
      };
      expect(await jornada(en(1, 1))).toEqual({
        fechaDeNegocio: fechaLocal(en(1)),
        estado: "ABIERTA",
      });
      const sesion = await abrir(m);
      expect(await jornada(en(1, 2))).toMatchObject({ estado: "ABIERTA" });
      expect(
        (
          await casos().cerrarSesion(ctxEn(m, 1, 30), {
            sesionId: sesion,
            conteo: BILLETE_DE_MIL,
            otros: [],
            conformeGeneral: false,
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      const entradaDeJornada = { sucursalId: m.sucursal, fechaDeNegocio: fechaLocal(en(1)) };
      expect((await cierreDelDia.iniciarAuditoria(ctxEn(m, 1, 40), entradaDeJornada)).ok).toBe(
        true,
      );
      expect(await jornada(en(1, 41))).toEqual({
        fechaDeNegocio: fechaLocal(en(1)),
        estado: "EN_AUDITORIA",
      });
      expect((await cierreDelDia.cancelarAuditoria(ctxEn(m, 1, 45), entradaDeJornada)).ok).toBe(
        true,
      );
      expect((await cierreDelDia.iniciarAuditoria(ctxEn(m, 1, 50), entradaDeJornada)).ok).toBe(
        true,
      );
      expect(
        (
          await cierreDelDia.cerrarJornada(ctxEn(m, 1, 55), {
            ...entradaDeJornada,
            huellaVista: (await import("../../src/modulos/cierre/publico")).huellaDeControles([]),
            reconocimientos: [],
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      expect(await jornada(en(1, 56))).toEqual({
        fechaDeNegocio: fechaLocal(en(1)),
        estado: "CERRADA",
      });
    });

    it("jornadaVencida: la sesión sigue abierta al día siguiente y sigue cobrando en su jornada; el límite es la hora de corte", async () => {
      const m = await mundo();
      const sesion = await abrir(m, 1, 0, "19:00");
      const estado = async (ahora: Date) => {
        const r = await leer(m, (tx) =>
          cajaParaVentas.estadoDeCajasParaCobrar(tx, conAhora(m.ctx(), ahora), m.sucursal),
        );
        return r.ok && r.valor.ok ? r.valor.valor.cajas[0] : r;
      };
      // Corte 00:00: a las 23:59:59.999 del mismo día no está vencida; a las 00:00:00.000 del siguiente, sí.
      expect(await estado(en(1, 0, "23:59"))).toMatchObject({
        sesionId: sesion,
        jornadaVencida: false,
      });
      expect(await estado(new Date(en(2, 0, "00:00").getTime() - 1))).toMatchObject({
        jornadaVencida: false,
      });
      expect(await estado(en(2, 0, "00:00"))).toMatchObject({
        jornadaVencida: true,
        fechaDeNegocio: fechaLocal(en(1)),
      });
      expect(await estado(en(2, 0, "10:00"))).toMatchObject({ jornadaVencida: true });
    });

    it("una sucursal que no existe, de otra empresa o que no es un uuid: SUCURSAL_NO_ENCONTRADA", async () => {
      const m = await mundo();
      const otro = await mundo();
      for (const sucursal of [
        UUID_QUE_NO_EXISTE,
        otro.sucursal,
        "x",
        otro.sucursal.toUpperCase(),
      ]) {
        const r = await leer(m, (tx) =>
          cajaParaVentas.estadoDeCajasParaCobrar(tx, ctxEn(m, 1, 1), sucursal),
        );
        expect(r.ok && r.valor, sucursal).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      }
    });
  });

  // =============================================================================================
  describe("opcionesDeCobro", () => {
    it("solo medios y cuentas activos de la sucursal de la caja; las cuentas que cada medio admite; la cuenta nunca es obligatoria", async () => {
      const m = await mundo();
      await abrir(m);
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Otra");
      await dueno.query(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'De otra sucursal', $2)",
        [m.empresa, otra],
      );
      await dueno.query(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id, activa) values ($1, 'TERMINAL', 'Apagada', $2, false)",
        [m.empresa, m.sucursal],
      );
      await dueno.query("update medio_de_pago set activo = false where id = $1", [m.medios.OTRO]);
      const r = await leer(m, (tx) => cajaParaVentas.opcionesDeCobro(tx, ctxEn(m, 1, 1), m.cajaId));
      expect(r.ok && r.valor.ok).toBe(true);
      const opciones = r.ok && r.valor.ok ? r.valor.valor : null;
      const porTipo = Object.fromEntries((opciones?.medios ?? []).map((o) => [o.tipo, o]));
      expect(Object.keys(porTipo).sort()).toEqual([
        "EFECTIVO",
        "QR",
        "TARJETA_CREDITO",
        "TARJETA_DEBITO",
        "TRANSFERENCIA",
      ]);
      const nombres = (tipo: string) => porTipo[tipo]?.cuentas.map((c) => c.nombre).sort();
      expect(nombres("EFECTIVO")).toEqual([]);
      expect(nombres("TARJETA_DEBITO")).toEqual(["Terminal 1"]);
      expect(nombres("TARJETA_CREDITO")).toEqual(["Terminal 1"]);
      expect(nombres("QR")).toEqual(["QR 1", "Terminal 1"]);
      expect(nombres("TRANSFERENCIA")).toEqual(["Banco 1"]);
      expect(Object.values(porTipo).every((o) => o.cuentaObligatoria === false)).toBe(true);
      expect(porTipo.QR?.cuentas.find((c) => c.nombre === "QR 1")).toEqual({
        id: m.cuentas.qr,
        tipo: "QR",
        nombre: "QR 1",
      });
      expect(porTipo.EFECTIVO).toMatchObject({ id: m.medios.EFECTIVO, nombre: null });
    });

    it("qué datos pide cada medio (los que el administrador habilitó) y las marcas de tarjeta activas, sin las desactivadas", async () => {
      const m = await mundo();
      await habilitar(m, "TARJETA_DEBITO", { cupon: true, ultimos4: true, marca: true });
      await habilitar(m, "TARJETA_CREDITO", { cuotas: true });
      await habilitar(m, "TRANSFERENCIA", { dni: true });
      await dueno.query(
        "update valor_de_lista set activo = false where nombre = 'Cabal' and lista = 'MARCAS_DE_TARJETA'",
      );
      try {
        const r = await leer(m, (tx) =>
          cajaParaVentas.opcionesDeCobro(tx, ctxEn(m, 1, 1), m.cajaId),
        );
        const o = r.ok && r.valor.ok ? r.valor.valor : null;
        const pide = (tipo: string) => o?.medios.find((x) => x.tipo === tipo)?.datosQuePide;
        expect(pide("EFECTIVO")).toEqual(NADIE);
        expect(pide("QR")).toEqual(NADIE);
        expect(pide("TARJETA_DEBITO")).toEqual({
          ...NADIE,
          cupon: true,
          ultimos4: true,
          marca: true,
        });
        expect(pide("TARJETA_CREDITO")).toEqual({ ...NADIE, cuotas: true });
        expect(pide("TRANSFERENCIA")).toEqual({ ...NADIE, dni: true });
        expect(o?.marcasDeTarjeta.map((x) => x.nombre).sort()).toEqual([
          "American Express",
          "Mastercard",
          "Naranja X",
          "Otra",
          "Visa",
        ]);
      } finally {
        await dueno.query(
          "update valor_de_lista set activo = true where nombre = 'Cabal' and lista = 'MARCAS_DE_TARJETA'",
        );
      }
    });

    it("una caja que no existe, de otra empresa o desactivada no ofrece nada", async () => {
      const m = await mundo();
      const otro = await mundo();
      const consultar = (id: string) =>
        leer(m, (tx) => cajaParaVentas.opcionesDeCobro(tx, ctxEn(m, 1, 1), id));
      for (const id of [UUID_QUE_NO_EXISTE, otro.cajaId, "x"]) {
        const r = await consultar(id);
        expect(r.ok && r.valor, id).toEqual({ ok: false, error: "CAJA_NO_ENCONTRADA" });
      }
      await dueno.query("update caja set activa = false where id = $1", [m.cajaId]);
      const r = await consultar(m.cajaId);
      expect(r.ok && r.valor).toEqual({ ok: false, error: "CAJA_INACTIVA" });
    });
  });

  // =============================================================================================
  describe("registrarCobroEnTx: el cobro", () => {
    it("cobra en la sesión abierta: un movimiento COBRO con su fila, la persona del contexto, el reloj del contexto y la jornada de la sesión", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const entrada = entradaDeCobro(m, { importe: importe("1234.56") });
      const ctx = ctxEn(m, 1, 5);
      const r = await cobrarComoVentas(entorno, ctx, entrada);
      expect(r).toMatchObject({
        ok: true,
        valor: {
          sesionId: sesion,
          fechaDeNegocio: fechaLocal(en(1)),
          jornadaVencida: false,
          yaExistia: false,
        },
      });
      const cobroId = r.ok ? r.valor.cobroId : "";
      const [mov] = await filas<{
        clase: string;
        importe: string;
        moneda: string;
        sesion_id: string;
        medio_de_pago_id: string;
        cuenta_de_cobro_id: string | null;
        registrado_por: string;
        registrado_en: Date;
        clave_idempotencia: string;
        motivo: string | null;
      }>("select * from movimiento_caja where id = $1", [cobroId]);
      expect(mov).toMatchObject({
        clase: "COBRO",
        importe: "1234.56",
        moneda: "ARS",
        sesion_id: sesion,
        medio_de_pago_id: m.medios.EFECTIVO,
        cuenta_de_cobro_id: null,
        registrado_por: m.persona,
        clave_idempotencia: `cobro_${entrada.origen.id}_1`,
        motivo: null,
      });
      expect(mov?.registrado_en.toISOString()).toBe(ctx.ahora.toISOString());
      const [cobro] = await filas("select * from cobro where movimiento_id = $1", [cobroId]);
      expect(cobro).toMatchObject({
        empresa_id: m.empresa,
        origen_tipo: "ventas.cobranza_de_ticket",
        origen_id: entrada.origen.id,
        origen_orden: 1,
        cupon: null,
        ultimos4: null,
        marca_de_tarjeta_id: null,
        cuotas: null,
        dni: null,
      });
      // Lo de la venta y lo del cobro, en la misma transacción.
      expect(await rastros(m)).toEqual({ movimientos: 1, cobros: 1, auditorias: 2 });
    });

    it("la auditoría del cobro lleva solo qué datos se completaron, nunca sus valores, ni la clave, ni la huella", async () => {
      const m = await mundo();
      await abrir(m);
      await habilitar(m, "TARJETA_CREDITO", {
        cupon: true,
        ultimos4: true,
        marca: true,
        cuotas: true,
      });
      const visa = await marca("Visa");
      const entrada = entradaDeCobro(m, {
        medioDePagoId: m.medios.TARJETA_CREDITO,
        cuentaDeCobroId: m.cuentas.terminal,
        datos: { cupon: "ZX-9981", ultimos4: "4242", marcaDeTarjetaId: visa, cuotas: 6 },
      });
      const r = await cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const [fila] = await filas<{
        actor_persona_id: string;
        entidad: string;
        despues: Record<string, unknown>;
      }>(
        "select actor_persona_id, entidad, despues from auditoria_empresa where empresa_id = $1 and accion = 'COBRO_REGISTRADO'",
        [m.empresa],
      );
      expect(fila?.actor_persona_id).toBe(m.persona);
      expect(fila?.despues).toMatchObject({
        importe: "100.00",
        medioDePagoId: m.medios.TARJETA_CREDITO,
        cuentaDeCobroId: m.cuentas.terminal,
        origenTipo: "ventas.cobranza_de_ticket",
        origenId: entrada.origen.id,
        origenOrden: 1,
        datosCompletados: ["cupon", "ultimos4", "marca", "cuotas"],
      });
      const texto = JSON.stringify(fila?.despues);
      // Los últimos 4 dígitos («4242») se buscan fuera de los uuid del registro: ahí caen por azar (~0,2 % de las corridas) y
      // darían un falso positivo; un uuid nunca es el valor de un dato de la tarjeta.
      const sinUuid = texto.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        "",
      );
      for (const secreto of ["ZX-9981", "4242", visa, `cobro_${entrada.origen.id}`]) {
        if (secreto === visa) continue; // el id de la marca no es un secreto, pero el valor tampoco se guarda (se comprueba abajo)
        expect((secreto === "4242" ? sinUuid : texto).includes(secreto), secreto).toBe(false);
      }
      expect(texto.includes(visa)).toBe(false);
      expect(texto).not.toMatch(/huella|clave/i);
    });

    it("el puerto no autoriza ni lee permisos: corre con la autorización que arma el llamador", async () => {
      const m = await mundo();
      await abrir(m);
      llamadasDeAutorizacion = 0;
      contarAutorizacion = true;
      try {
        const entrada = entradaDeCobro(m);
        const ctx = ctxEn(m, 1, 5);
        const r = await entorno.ejecutar({ contexto: ctx }, (tx) =>
          cajaParaVentas.registrarCobroEnTx(tx, ctx, entrada),
        );
        expect(r.ok).toBe(true);
        expect(llamadasDeAutorizacion).toBe(0);
      } finally {
        contarAutorizacion = false;
      }
    });

    it("solo corre en una transacción serializable: en read committed se niega antes de escribir (el cierre serializable no vería al cobro en vuelo)", async () => {
      const m = await mundo();
      await abrir(m);
      const ctx = ctxEn(m, 1, 5);
      for (const aislamiento of ["read committed"] as const) {
        await expect(
          entorno.ejecutar({ contexto: ctx, aislamiento }, (tx) =>
            cajaParaVentas.registrarCobroEnTx(tx, ctx, entradaDeCobro(m)),
          ),
        ).rejects.toThrow("serializable");
      }
      expect(await rastros(m)).toEqual(SIN_RASTROS);
    });

    it("sin persona en el contexto no se cobra (no hay quién deje constancia) y no se escribe nada", async () => {
      const m = await mundo();
      await abrir(m);
      const sinPersona = { ...ctxEn(m, 1, 5), personaId: null };
      expect(await cobrarComoVentas(entorno, sinPersona, entradaDeCobro(m))).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await rastros(m)).toEqual(SIN_RASTROS);
    });

    it("importe cero, negativo o sobre el tope; origen u orden inválidos: se rechazan siempre y no se escribe nada", async () => {
      const m = await mundo();
      await abrir(m);
      const casosMalos: [Partial<EntradaDeRegistrarCobro>, unknown][] = [
        [{ importe: importe("0.00") }, "IMPORTE_INVALIDO"],
        [{ importe: importe("-100.00") }, "IMPORTE_INVALIDO"],
        [{ importe: importe("-0.01") }, "IMPORTE_INVALIDO"],
        [{ importe: importe("1000000000.00") }, "IMPORTE_INVALIDO"],
        [{ origen: { tipo: "ventas", id: origenNuevo().id } }, "ORIGEN_INVALIDO"],
        [{ origen: { tipo: "ventas.cobranza", id: "no-es-uuid" } }, "ORIGEN_INVALIDO"],
        [{ origenOrden: 0 }, "ORIGEN_INVALIDO"],
        [{ origenOrden: 51 }, "ORIGEN_INVALIDO"],
        [{ cajaId: "x" }, "CAJA_NO_ENCONTRADA"],
        [{ medioDePagoId: "x" }, "MEDIO_NO_ENCONTRADO"],
        [{ cuentaDeCobroId: "x" }, "CUENTA_DE_COBRO_NO_ENCONTRADA"],
      ];
      for (const [indice, [cambios, error]] of casosMalos.entries()) {
        const r = await cobrar(m, cambios);
        expect(r, `caso ${indice}`).toEqual({ ok: false, error });
      }
      expect(await rastros(m)).toEqual(SIN_RASTROS);
      // El tope exacto y el centavo mínimo sí cobran.
      expect((await cobrar(m, { importe: importe("999999999.99") })).ok).toBe(true);
      expect((await cobrar(m, { importe: importe("0.01") })).ok).toBe(true);
      expect((await cobrar(m, { origenOrden: 50 })).ok).toBe(true);
    });

    describe("la caja y su sesión (decisión 145)", () => {
      it("sin sesión abierta: SIN_SESION_ABIERTA con la caja, sin escribir ni auditar nada", async () => {
        const m = await mundo();
        expect(await cobrar(m)).toEqual({
          ok: false,
          error: { codigo: "SIN_SESION_ABIERTA", cajaId: m.cajaId },
        });
        expect(await rastros(m)).toEqual(SIN_RASTROS);
      });

      it("con la sesión en cierre: CAJA_EN_CIERRE con la caja y la sesión; cerrada: vuelve a ser SIN_SESION_ABIERTA", async () => {
        const m = await mundo();
        const sesion = await abrir(m);
        expect((await casos().iniciarCierre(ctxEn(m, 1, 20), { sesionId: sesion })).ok).toBe(true);
        expect(await cobrar(m)).toEqual({
          ok: false,
          error: { codigo: "CAJA_EN_CIERRE", cajaId: m.cajaId, sesionId: sesion },
        });
        expect(
          (
            await casos().cerrarSesion(ctxEn(m, 1, 30), {
              sesionId: sesion,
              conteo: BILLETE_DE_MIL,
              otros: [],
              conformeGeneral: false,
              observacion: null,
            })
          ).ok,
        ).toBe(true);
        expect(await cobrar(m)).toEqual({
          ok: false,
          error: { codigo: "SIN_SESION_ABIERTA", cajaId: m.cajaId },
        });
        expect(await rastros(m)).toEqual(SIN_RASTROS);
        // Si el cierre se cancela, la caja vuelve a cobrar.
      });

      it("cancelar el cierre devuelve la caja a cobrar", async () => {
        const m = await mundo();
        const sesion = await abrir(m);
        await casos().iniciarCierre(ctxEn(m, 1, 20), { sesionId: sesion });
        expect((await cobrar(m)).ok).toBe(false);
        expect((await casos().cancelarCierre(ctxEn(m, 1, 25), { sesionId: sesion })).ok).toBe(true);
        expect((await cobrar(m)).ok).toBe(true);
      });

      it("caja inexistente, de otra empresa, desactivada o de otra sucursal", async () => {
        const m = await mundo();
        const otro = await mundo();
        await abrir(m);
        expect(await cobrar(m, { cajaId: UUID_QUE_NO_EXISTE })).toEqual({
          ok: false,
          error: "CAJA_NO_ENCONTRADA",
        });
        expect(await cobrar(m, { cajaId: otro.cajaId })).toEqual({
          ok: false,
          error: "CAJA_NO_ENCONTRADA",
        });
        const otraSucursal = await otraSucursalDeCaja(dueno, m.empresa, "Otra");
        expect(await cobrar(m, { sucursalId: otraSucursal })).toEqual({
          ok: false,
          error: "CAJA_DE_OTRA_SUCURSAL",
        });
        // Desactivar una caja con sesión abierta no se puede: se cierra la sesión y recién ahí se desactiva.
        const [segunda] = await filas<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre, activa) values ($1, $2, 'Vieja', false) returning id",
          [m.empresa, m.sucursal],
        );
        expect(await cobrar(m, { cajaId: segunda?.id as string })).toEqual({
          ok: false,
          error: "CAJA_INACTIVA",
        });
        expect(await rastros(m)).toEqual(SIN_RASTROS);
      });

      it("con la jornada en auditoría o cerrada no se cobra: JORNADA_EN_AUDITORIA / JORNADA_CERRADA, sin escribir nada", async () => {
        const m = await mundo();
        const sesion = await abrir(m);
        const fecha = fechaLocal(en(1));
        // Una sesión abierta no deja iniciar la auditoría: se fuerza el estado de la jornada con el dueño de la base (la defensa es del puerto).
        for (const estado of ["EN_AUDITORIA", "CERRADA"] as const) {
          await dueno.query("alter table jornada_de_sucursal disable trigger user");
          await dueno.query(
            `update jornada_de_sucursal set estado = $3,
               auditoria_iniciada_en = now(), auditoria_iniciada_por = $4,
               cerrada_en = case when $3 = 'CERRADA' then now() end,
               cerrada_por = case when $3 = 'CERRADA' then $4::uuid end,
               huella_de_cierre = case when $3 = 'CERRADA' then repeat('a', 64) end
             where empresa_id = $1 and fecha_negocio = $2`,
            [m.empresa, fecha, estado, m.persona],
          );
          await dueno.query("alter table jornada_de_sucursal enable trigger user");
          const r = await cobrar(m);
          expect(r, estado).toEqual({
            ok: false,
            error: estado === "EN_AUDITORIA" ? "JORNADA_EN_AUDITORIA" : "JORNADA_CERRADA",
          });
          expect(await rastros(m), estado).toEqual(SIN_RASTROS);
        }
        expect(sesion).toBeDefined();
      });

      it("jornada vencida: la sesión abierta ayer sigue cobrando en SU jornada, devuelve jornadaVencida y deja la constancia", async () => {
        const m = await mundo();
        const sesion = await abrir(m, 1, 0, "19:00");
        const r = await cobrar(m, {}, ctxEn(m, 2, 30, "01:00"));
        expect(r).toMatchObject({
          ok: true,
          valor: { sesionId: sesion, fechaDeNegocio: fechaLocal(en(1)), jornadaVencida: true },
        });
        expect(
          await contar(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COBRO_EN_JORNADA_VENCIDA'",
            [m.empresa],
          ),
        ).toBe(1);
        // Y un cobro dentro de la jornada no la deja.
        expect((await cobrar(m, {}, ctxEn(m, 1, 30, "20:00"))).ok).toBe(true);
        expect(
          await contar(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COBRO_EN_JORNADA_VENCIDA'",
            [m.empresa],
          ),
        ).toBe(1);
        // El movimiento lleva la hora real del cobro, y la jornada sigue siendo la de la sesión.
        const [mov] = await filas<{ f: string }>(
          "select s.fecha_negocio::text as f from movimiento_caja m join sesion_caja s on s.id = m.sesion_id where m.id = $1",
          [r.ok ? r.valor.cobroId : ""],
        );
        expect(mov?.f).toBe(fechaLocal(en(1)));
      });
    });

    describe("medio ↔ cuenta de cobro (e3 §3.3, decisión 151)", () => {
      it("las cinco combinaciones por tipo y la cuenta opcional", async () => {
        const m = await mundo();
        await abrir(m);
        const c = m.cuentas;
        const tabla: [keyof typeof m.medios, string | null, unknown][] = [
          // Efectivo: sin cuenta (con una, no se admite).
          ["EFECTIVO", null, true],
          ["EFECTIVO", c.terminal, "CUENTA_DE_COBRO_NO_ADMITIDA"],
          ["EFECTIVO", c.qr, "CUENTA_DE_COBRO_NO_ADMITIDA"],
          ["EFECTIVO", c.banco, "CUENTA_DE_COBRO_NO_ADMITIDA"],
          // Débito y crédito: terminal, o ninguna.
          ["TARJETA_DEBITO", null, true],
          ["TARJETA_DEBITO", c.terminal, true],
          ["TARJETA_DEBITO", c.qr, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          ["TARJETA_DEBITO", c.banco, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          ["TARJETA_CREDITO", null, true],
          ["TARJETA_CREDITO", c.terminal, true],
          ["TARJETA_CREDITO", c.qr, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          ["TARJETA_CREDITO", c.banco, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          // QR: QR o terminal, o ninguna.
          ["QR", null, true],
          ["QR", c.qr, true],
          ["QR", c.terminal, true],
          ["QR", c.banco, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          // Transferencia: cuenta bancaria, o ninguna.
          ["TRANSFERENCIA", null, true],
          ["TRANSFERENCIA", c.banco, true],
          ["TRANSFERENCIA", c.terminal, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          ["TRANSFERENCIA", c.qr, "CUENTA_DE_COBRO_INCOMPATIBLE"],
          // Otro: cualquiera.
          ["OTRO", null, true],
          ["OTRO", c.terminal, true],
          ["OTRO", c.qr, true],
          ["OTRO", c.banco, true],
        ];
        for (const [tipo, cuenta, esperado] of tabla) {
          const r = await cobrar(m, { medioDePagoId: m.medios[tipo], cuentaDeCobroId: cuenta });
          const nombre = `${tipo} con ${cuenta ?? "ninguna cuenta"}`;
          if (esperado === true) expect(r.ok, `${nombre}: ${JSON.stringify(r)}`).toBe(true);
          else expect(r, nombre).toEqual({ ok: false, error: esperado });
        }
        // Un cobro sin cuenta con tarjeta, QR y transferencia pasó y queda sin cuenta (el arqueo lo agrupa «sin cuenta»).
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where empresa_id = $1 and clase = 'COBRO' and cuenta_de_cobro_id is null",
            [m.empresa],
          ),
        ).toBe(6);
      });

      it("medio inexistente, de otra empresa o desactivado; cuenta inexistente, de otra empresa, de otra sucursal o desactivada", async () => {
        const m = await mundo();
        const otro = await mundo();
        await abrir(m);
        expect(await cobrar(m, { medioDePagoId: UUID_QUE_NO_EXISTE })).toEqual({
          ok: false,
          error: "MEDIO_NO_ENCONTRADO",
        });
        expect(await cobrar(m, { medioDePagoId: otro.medios.QR })).toEqual({
          ok: false,
          error: "MEDIO_NO_ENCONTRADO",
        });
        await dueno.query("update medio_de_pago set activo = false where id = $1", [m.medios.QR]);
        expect(await cobrar(m, { medioDePagoId: m.medios.QR })).toEqual({
          ok: false,
          error: "MEDIO_INACTIVO",
        });
        const quiosco = { medioDePagoId: m.medios.TARJETA_DEBITO };
        expect(await cobrar(m, { ...quiosco, cuentaDeCobroId: UUID_QUE_NO_EXISTE })).toEqual({
          ok: false,
          error: "CUENTA_DE_COBRO_NO_ENCONTRADA",
        });
        expect(await cobrar(m, { ...quiosco, cuentaDeCobroId: otro.cuentas.terminal })).toEqual({
          ok: false,
          error: "CUENTA_DE_COBRO_NO_ENCONTRADA",
        });
        const otraSucursal = await otraSucursalDeCaja(dueno, m.empresa, "Otra");
        const [deOtra] = await filas<{ id: string }>(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'De otra', $2) returning id",
          [m.empresa, otraSucursal],
        );
        expect(await cobrar(m, { ...quiosco, cuentaDeCobroId: deOtra?.id as string })).toEqual({
          ok: false,
          error: "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
        });
        await dueno.query("update cuenta_de_cobro set activa = false where id = $1", [
          m.cuentas.terminal,
        ]);
        expect(await cobrar(m, { ...quiosco, cuentaDeCobroId: m.cuentas.terminal })).toEqual({
          ok: false,
          error: "CUENTA_DE_COBRO_INACTIVA",
        });
        expect(await rastros(m)).toEqual(SIN_RASTROS);
      });
    });

    describe("datos del cobro (e3 §3.6, decisión 129)", () => {
      const preparar = async () => {
        const m = await mundo();
        await abrir(m);
        await habilitar(m, "TARJETA_DEBITO", { cupon: true, ultimos4: true, marca: true });
        await habilitar(m, "TARJETA_CREDITO", {
          cupon: true,
          ultimos4: true,
          marca: true,
          cuotas: true,
        });
        await habilitar(m, "TRANSFERENCIA", { dni: true });
        return m;
      };
      const credito = (m: MundoDeCobro, datos: EntradaDeRegistrarCobro["datos"]) =>
        ({ medioDePagoId: m.medios.TARJETA_CREDITO, datos }) as const;

      it("un cupón que parece un número de tarjeta, con espacios o sin letras ni dígitos se rechaza; los válidos se guardan tal cual", async () => {
        const m = await preparar();
        const rechazos: [string, "FORMA" | "NUMERO_DE_TARJETA"][] = [
          ["4509 9535 6623 3704", "FORMA"],
          ["4509-9535-6623-3704", "NUMERO_DE_TARJETA"],
          ["4509.9535.6623.3704", "NUMERO_DE_TARJETA"],
          ["4509953566233704", "NUMERO_DE_TARJETA"],
          ["ABC 123", "FORMA"],
          [" ABC", "FORMA"],
          ["---", "FORMA"],
          ["._/", "FORMA"],
          ["", "FORMA"],
          ["ñandú", "FORMA"],
          ["A".repeat(33), "FORMA"],
          ["<b>1</b>", "FORMA"],
        ];
        for (const [cupon, motivo] of rechazos) {
          const r = await cobrar(m, credito(m, { cupon }));
          expect(r, JSON.stringify(cupon)).toEqual({
            ok: false,
            error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "cupon", motivo },
          });
        }
        expect(await rastros(m)).toEqual(SIN_RASTROS);
        for (const cupon of ["ABC123", "A-1/2.3_4", "1".repeat(12), "A".repeat(32), "9"]) {
          const r = await cobrar(m, credito(m, { cupon }));
          expect(r.ok, `${cupon}: ${JSON.stringify(r)}`).toBe(true);
        }
        expect(
          (
            await filas<{ cupon: string }>(
              "select cupon from cobro where empresa_id = $1 order by cupon",
              [m.empresa],
            )
          ).map((f) => f.cupon),
        ).toEqual(["1".repeat(12), "9", "A".repeat(32), "A-1/2.3_4", "ABC123"].sort());
      });

      it("últimos 4: exactamente 4 dígitos; 16 dígitos pegados se rechazan, nunca se truncan", async () => {
        const m = await preparar();
        for (const ultimos4 of [
          "4509953566233704",
          "123",
          "12345",
          "12a4",
          " 123",
          "",
          "1 2 3 4",
        ]) {
          const r = await cobrar(m, credito(m, { ultimos4 }));
          expect(r, JSON.stringify(ultimos4)).toEqual({
            ok: false,
            error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "ultimos4", motivo: "FORMA" },
          });
        }
        expect(await rastros(m)).toEqual(SIN_RASTROS);
        expect((await cobrar(m, credito(m, { ultimos4: "0042" }))).ok).toBe(true);
        expect(
          (
            await filas<{ u: string }>("select ultimos4 as u from cobro where empresa_id = $1", [
              m.empresa,
            ])
          )[0]?.u,
        ).toBe("0042");
      });

      it("cuotas: entero de 1 a 36; 0, 37, decimales y texto se rechazan", async () => {
        const m = await preparar();
        const malas: unknown[] = [
          0,
          37,
          2.5,
          -1,
          "abc",
          "3",
          Number.NaN,
          Number.POSITIVE_INFINITY,
          null,
        ];
        for (const cuotas of malas) {
          const r = await cobrar(m, credito(m, { cuotas } as never));
          expect(r, String(cuotas)).toEqual({
            ok: false,
            error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "cuotas", motivo: "FORMA" },
          });
        }
        expect(await rastros(m)).toEqual(SIN_RASTROS);
        for (const cuotas of [1, 36]) {
          expect((await cobrar(m, credito(m, { cuotas }))).ok, String(cuotas)).toBe(true);
        }
      });

      it("DNI (transferencia): de 6 a 9 dígitos; con letras o con puntos se rechaza (la pantalla los quita, el servidor no)", async () => {
        const m = await preparar();
        const transferencia = (dni: string) =>
          ({ medioDePagoId: m.medios.TRANSFERENCIA, datos: { dni } }) as const;
        for (const dni of ["12a45678", "12.345.678", "12345", "1234567890", "", " 12345678"]) {
          const r = await cobrar(m, transferencia(dni));
          expect(r, JSON.stringify(dni)).toEqual({
            ok: false,
            error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "dni", motivo: "FORMA" },
          });
        }
        expect(await rastros(m)).toEqual(SIN_RASTROS);
        for (const dni of ["123456", "12345678", "123456789"]) {
          expect((await cobrar(m, transferencia(dni))).ok, dni).toBe(true);
        }
      });

      it("un dato que el medio no habilitó se rechaza (efectivo, QR, otro; un dato que el tipo no admite; uno que el medio no pidió)", async () => {
        const m = await preparar();
        const noHabilitado = (dato: string) => ({
          ok: false,
          error: { codigo: "DATO_DE_COBRO_NO_HABILITADO", dato },
        });
        expect(await cobrar(m, { datos: { cupon: "ABC" } })).toEqual(noHabilitado("cupon"));
        expect(
          await cobrar(m, { medioDePagoId: m.medios.QR, datos: { ultimos4: "1234" } }),
        ).toEqual(noHabilitado("ultimos4"));
        expect(await cobrar(m, { medioDePagoId: m.medios.OTRO, datos: { cuotas: 2 } })).toEqual(
          noHabilitado("cuotas"),
        );
        expect(
          await cobrar(m, { medioDePagoId: m.medios.TARJETA_DEBITO, datos: { cuotas: 2 } }),
        ).toEqual(noHabilitado("cuotas"));
        expect(
          await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO, datos: { dni: "12345678" } }),
        ).toEqual(noHabilitado("dni"));
        expect(
          await cobrar(m, { medioDePagoId: m.medios.TRANSFERENCIA, datos: { cupon: "ABC" } }),
        ).toEqual(noHabilitado("cupon"));
        // Un medio que el administrador todavía no configuró no pide nada, aunque su tipo lo admita.
        await habilitar(m, "TARJETA_DEBITO", {});
        expect(
          await cobrar(m, { medioDePagoId: m.medios.TARJETA_DEBITO, datos: { cupon: "ABC" } }),
        ).toEqual(noHabilitado("cupon"));
        expect(await rastros(m)).toEqual(SIN_RASTROS);
      });

      it("con todo vacío cobra igual: los datos nunca bloquean", async () => {
        const m = await preparar();
        for (const medioDePagoId of Object.values(m.medios)) {
          expect((await cobrar(m, { medioDePagoId })).ok, medioDePagoId).toBe(true);
        }
        expect(
          await contar(
            "select count(*) as n from cobro where empresa_id = $1 and cupon is null and ultimos4 is null and marca_de_tarjeta_id is null and cuotas is null and dni is null",
            [m.empresa],
          ),
        ).toBe(6);
      });

      it("la marca: la activa se guarda; una desactivada o que no existe se rechaza en un cobro nuevo y los cobros viejos la conservan", async () => {
        const m = await preparar();
        const naranja = await marca("Naranja X");
        const cabal = await marca("Cabal");
        const viejo = await cobrar(m, credito(m, { marcaDeTarjetaId: cabal }));
        expect(viejo.ok).toBe(true);
        await dueno.query("update valor_de_lista set activo = false where id = $1", [cabal]);
        try {
          for (const marcaDeTarjetaId of [cabal, UUID_QUE_NO_EXISTE, "x"]) {
            const r = await cobrar(m, credito(m, { marcaDeTarjetaId }));
            expect(r, marcaDeTarjetaId).toEqual({
              ok: false,
              error: {
                codigo: "DATO_DE_COBRO_INVALIDO",
                dato: "marca",
                motivo: marcaDeTarjetaId === "x" ? "FORMA" : "NO_DISPONIBLE",
              },
            });
          }
          // Una marca de la OTRA lista tampoco sirve.
          const [motivo] = await filas<{ id: string }>(
            "select id from valor_de_lista where lista = 'MOTIVOS_DE_RECHAZO' limit 1",
          );
          expect(await cobrar(m, credito(m, { marcaDeTarjetaId: motivo?.id as string }))).toEqual({
            ok: false,
            error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "marca", motivo: "NO_DISPONIBLE" },
          });
          expect((await cobrar(m, credito(m, { marcaDeTarjetaId: naranja }))).ok).toBe(true);
          // El cobro viejo conserva la marca que se desactivó después.
          expect(
            (
              await filas<{ marca_de_tarjeta_id: string }>(
                "select marca_de_tarjeta_id from cobro where movimiento_id = $1",
                [viejo.ok ? viejo.valor.cobroId : ""],
              )
            )[0]?.marca_de_tarjeta_id,
          ).toBe(cabal);
        } finally {
          await dueno.query("update valor_de_lista set activo = true where id = $1", [cabal]);
        }
      });

      it("un cobro con todos los datos de un crédito los guarda en sus columnas", async () => {
        const m = await preparar();
        const visa = await marca("Visa");
        const r = await cobrar(m, {
          medioDePagoId: m.medios.TARJETA_CREDITO,
          cuentaDeCobroId: m.cuentas.terminal,
          datos: { cupon: "123456", ultimos4: "1111", marcaDeTarjetaId: visa, cuotas: 12 },
        });
        expect(r.ok).toBe(true);
        expect(
          (
            await filas(
              "select cupon, ultimos4, marca_de_tarjeta_id, cuotas, dni from cobro where empresa_id = $1",
              [m.empresa],
            )
          )[0],
        ).toEqual({
          cupon: "123456",
          ultimos4: "1111",
          marca_de_tarjeta_id: visa,
          cuotas: 12,
          dni: null,
        });
      });
    });
  });

  // =============================================================================================
  describe("atomicidad: el cobro y la venta son una sola transacción", () => {
    it("una falla entre el movimiento y la fila de cobro no deja nada: ni movimiento, ni cobro, ni auditoría, ni la constancia de la venta", async () => {
      const m = await mundo();
      await abrir(m);
      fallaEnElCobro = true;
      try {
        await expect(cobrar(m)).rejects.toThrow("falla inyectada");
      } finally {
        fallaEnElCobro = false;
      }
      expect(await rastros(m)).toEqual(SIN_RASTROS);
      // Y la caja sigue cobrando.
      expect((await cobrar(m)).ok).toBe(true);
    });

    it("una falla de la venta DESPUÉS de cobrar deshace el cobro entero", async () => {
      const m = await mundo();
      await abrir(m);
      await expect(
        cobrarComoVentas(entorno, ctxEn(m, 1, 5), entradaDeCobro(m), {
          despuesDelCobro: () => Promise.reject(new Error("la venta falló después de cobrar")),
        }),
      ).rejects.toThrow("la venta falló");
      expect(await rastros(m)).toEqual(SIN_RASTROS);
    });

    it("una venta con la caja que se cierra entre la lectura y el cobro revierte ENTERA (con su constancia) y el reintento ve la caja cerrada", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      let intentosVistos = 0;
      const r = await cobrarComoVentas(entorno, ctxEn(m, 1, 5), entradaDeCobro(m), {
        entreLaLecturaYElCobro: async (intento) => {
          intentosVistos = intento;
          if (intento !== 1) return;
          // Otro usuario cierra la caja justo después de que la venta leyó «abierta» y antes de que cobre.
          const cierre = await casos().cerrarSesion(ctxEn(m, 1, 10), {
            sesionId: sesion,
            conteo: BILLETE_DE_MIL,
            otros: [],
            conformeGeneral: false,
            observacion: null,
          });
          expect(cierre.ok).toBe(true);
        },
      });
      expect(r).toEqual({
        ok: false,
        error: { codigo: "SIN_SESION_ABIERTA", cajaId: m.cajaId },
      });
      // La primera vuelta chocó con el cierre (serialización) y el adaptador repitió la venta entera: la segunda ya vio la caja cerrada.
      expect(intentosVistos).toBeGreaterThanOrEqual(2);
      expect(await rastros(m)).toEqual(SIN_RASTROS);
    });

    it("el error de una restricción de la base se traduce al código del cobro (red de seguridad), y el resto sale como persistencia", async () => {
      const m = await mundo();
      await abrir(m);
      // Con SQL directo y el rol de la aplicación: un medio desactivado entre la lectura y el alta lo rechaza la base.
      const ctx = ctxEn(m, 1, 5);
      const r = await entorno.ejecutar({ contexto: ctx }, async (tx) => {
        await sql`update medio_de_pago set activo = false where id = ${m.medios.QR}::uuid`.execute(
          tx.db,
        );
        const [sesion] = (
          await sql<{
            id: string;
          }>`select id from sesion_caja where empresa_id = ${m.empresa}::uuid`.execute(tx.db)
        ).rows;
        await sql`insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, registrado_en, registrado_por, clave_idempotencia, huella)
                  values (${m.empresa}::uuid, ${sesion?.id}::uuid, 'COBRO', ${m.medios.QR}::uuid, 5, ${ctx.ahora}::timestamptz, ${m.persona}::uuid, ${claveNueva()}, ${"a".repeat(64)})`.execute(
          tx.db,
        );
        return ok(null);
      });
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "movimiento_caja_medio_inactivo" },
      });
      expect(traducirErroresDelCobro(r)).toEqual(err("MEDIO_INACTIVO"));
      // Lo que no es del cobro sale tal cual.
      const otro = { ok: false, error: { tipo: "Check", restriccion: "caja_nombre_ck" } } as const;
      expect(traducirErroresDelCobro(otro)).toEqual(otro);
    });
  });

  // =============================================================================================
  describe("aislamiento entre empresas", () => {
    it("una empresa no cobra en la caja, con el medio o con la cuenta de otra, ni lee sus cobros", async () => {
      const a = await mundo();
      const b = await mundo();
      await abrir(a);
      await abrir(b);
      const entradaA = entradaDeCobro(a);
      expect((await cobrarComoVentas(entorno, ctxEn(a, 1, 5), entradaA)).ok).toBe(true);
      // B con la caja de A, el medio de A o la cuenta de A: no existen para B.
      expect(await cobrar(b, { cajaId: a.cajaId })).toEqual({
        ok: false,
        error: "CAJA_NO_ENCONTRADA",
      });
      expect(await cobrar(b, { medioDePagoId: a.medios.QR })).toEqual({
        ok: false,
        error: "MEDIO_NO_ENCONTRADO",
      });
      expect(
        await cobrar(b, { medioDePagoId: b.medios.QR, cuentaDeCobroId: a.cuentas.qr }),
      ).toEqual({ ok: false, error: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
      // B no ve los cobros de A.
      const lectura = await leer(b, (tx) =>
        cajaParaVentas.cobrosPorOrigen(tx, ctxEn(b, 1, 5), entradaA.origen),
      );
      expect(lectura.ok && lectura.valor.cobros).toEqual([]);
      expect(lectura.ok && lectura.valor.cobrado.unidades).toBe(0n);
      // El mismo origen y orden en las dos empresas son dos cobros distintos.
      expect(
        (
          await cobrarComoVentas(
            entorno,
            ctxEn(b, 1, 5),
            entradaDeCobro(b, { origen: entradaA.origen }),
          )
        ).ok,
      ).toBe(true);
      expect(
        await contar("select count(*) as n from cobro where origen_id = $1", [entradaA.origen.id]),
      ).toBe(2);
      // Y con SQL directo: B no inserta un cobro en la sesión de A.
      const [sesionDeA] = await filas<{ id: string }>(
        "select id from sesion_caja where empresa_id = $1",
        [a.empresa],
      );
      const ctxB = ctxEn(b, 1, 6);
      const directo = await entorno.ejecutar({ contexto: ctxB }, async (tx) => {
        await sql`insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, registrado_en, registrado_por, clave_idempotencia, huella)
                  values (${b.empresa}::uuid, ${sesionDeA?.id}::uuid, 'COBRO', ${b.medios.QR}::uuid, 5, ${ctxB.ahora}::timestamptz, ${b.persona}::uuid, ${claveNueva()}, ${"b".repeat(64)})`.execute(
          tx.db,
        );
        return ok(null);
      });
      expect(directo.ok).toBe(false);
    });

    it("una empresa suspendida no escribe cobros", async () => {
      const m = await mundo();
      await abrir(m);
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [m.empresa],
      );
      const r = await cobrar(m);
      expect(r.ok).toBe(false);
      expect(await rastros(m)).toEqual(SIN_RASTROS);
    });

    it("el que no tiene asignada la sucursal igual cobra por el puerto: el alcance y el permiso son de ventas", async () => {
      const m = await mundo();
      await abrir(m);
      const operador = await sumarPersona(dueno, m, "OPERADOR", false);
      const ctx = conAhora(operador(), en(1, 5));
      expect((await cobrarComoVentas(entorno, ctx, entradaDeCobro(m))).ok).toBe(true);
    });
  });

  // =============================================================================================
  describe("cobrosPorOrigen", () => {
    it("la suma exacta de los cobros del origen, por orden, con el medio con que se cobró; un origen sin cobros da cero", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const origen = origenNuevo();
      const otroOrigen = origenNuevo();
      for (const [orden, medioDePagoId, monto] of [
        [2, m.medios.TARJETA_DEBITO, "0.10"],
        [1, m.medios.EFECTIVO, "1234.56"],
        [3, m.medios.QR, "0.20"],
      ] as const) {
        const r = await cobrarComoVentas(
          entorno,
          ctxEn(m, 1, 5),
          entradaDeCobro(m, { origen, origenOrden: orden, medioDePagoId, importe: importe(monto) }),
        );
        expect(r.ok).toBe(true);
      }
      expect((await cobrar(m, { origen: otroOrigen })).ok).toBe(true);
      const r = await leer(m, (tx) => cajaParaVentas.cobrosPorOrigen(tx, ctxEn(m, 1, 6), origen));
      const lectura = r.ok ? r.valor : null;
      expect(lectura?.cobrado).toEqual(importe("1234.86"));
      expect(
        lectura?.cobros.map((c) => [
          c.origenOrden,
          c.medioTipo,
          c.medioVigenteTipo,
          c.importe.unidades,
        ]),
      ).toEqual([
        [1, "EFECTIVO", "EFECTIVO", 123456n],
        [2, "TARJETA_DEBITO", "TARJETA_DEBITO", 10n],
        [3, "QR", "QR", 20n],
      ]);
      expect(lectura?.cobros[0]).toMatchObject({
        cuentaDeCobroId: null,
        fechaDeNegocio: fechaLocal(en(1)),
      });
      expect(lectura?.cobros.every((c) => c.cobroId.length === 36)).toBe(true);
      const sin = await leer(m, (tx) =>
        cajaParaVentas.cobrosPorOrigen(tx, ctxEn(m, 1, 6), origenNuevo()),
      );
      expect(sin.ok && sin.valor.cobrado).toEqual(importe("0.00"));
      expect(sin.ok && sin.valor.cobros).toEqual([]);
      // Un origen de otro tipo con el mismo id no es el mismo origen; uno mal formado no tiene cobros.
      const otroTipo = await leer(m, (tx) =>
        cajaParaVentas.cobrosPorOrigen(tx, ctxEn(m, 1, 6), {
          tipo: "ventas.otra_cosa",
          id: origen.id,
        }),
      );
      expect(otroTipo.ok && otroTipo.valor.cobros).toEqual([]);
      const malo = await leer(m, (tx) =>
        cajaParaVentas.cobrosPorOrigen(tx, ctxEn(m, 1, 6), { tipo: "x", id: "no-es-uuid" }),
      );
      expect(malo.ok && malo.valor.cobros).toEqual([]);
      expect(sesion).toBeDefined();
    });

    it("`cobrado` no cambia con una corrección de medio y medioVigenteTipo sigue la última corrección", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const origen = origenNuevo();
      const cobro = await cobrarComoVentas(
        entorno,
        ctxEn(m, 1, 5),
        entradaDeCobro(m, { origen, importe: importe("500.00") }),
      );
      const cobroId = cobro.ok ? cobro.valor.cobroId : "";
      const fecha = fechaLocal(en(1));
      expect(
        (
          await casos().cerrarSesion(ctxEn(m, 1, 30), {
            sesionId: sesion,
            conteo: BILLETE_DE_MIL,
            otros: [],
            conformeGeneral: false,
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      const entradaDeJornada = { sucursalId: m.sucursal, fechaDeNegocio: fecha };
      expect((await cierreDelDia.iniciarAuditoria(ctxEn(m, 1, 40), entradaDeJornada)).ok).toBe(
        true,
      );
      const corregir = async (secuencia: number, antes: string, despues: string) => {
        const ctx = ctxEn(m, 1, 41 + secuencia);
        const r = await entorno.ejecutar({ contexto: ctx }, async (tx) => {
          await sql`insert into correccion_de_medio
              (empresa_id, cobro_id, secuencia, sucursal_id, fecha_negocio, medio_antes_id, medio_despues_id, motivo, corregido_en, corregido_por, clave_idempotencia, huella)
              values (${m.empresa}::uuid, ${cobroId}::uuid, ${secuencia}, ${m.sucursal}::uuid, ${fecha}::date, ${antes}::uuid, ${despues}::uuid,
                      'Se cobro con otro medio', ${ctx.ahora}::timestamptz, ${m.persona}::uuid, ${claveNueva()}, ${"c".repeat(64)})`.execute(
            tx.db,
          );
          return ok(null);
        });
        expect(r.ok, JSON.stringify(r)).toBe(true);
      };
      const ver = async () => {
        const r = await leer(m, (tx) =>
          cajaParaVentas.cobrosPorOrigen(tx, ctxEn(m, 1, 60), origen),
        );
        return r.ok ? r.valor : null;
      };
      const antes = await ver();
      expect(antes?.cobros[0]).toMatchObject({
        medioTipo: "EFECTIVO",
        medioVigenteTipo: "EFECTIVO",
      });
      await corregir(1, m.medios.EFECTIVO, m.medios.QR);
      const uno = await ver();
      expect(uno?.cobros[0]).toMatchObject({ medioTipo: "EFECTIVO", medioVigenteTipo: "QR" });
      expect(uno?.cobrado).toEqual(antes?.cobrado);
      await corregir(2, m.medios.QR, m.medios.TARJETA_CREDITO);
      const dos = await ver();
      expect(dos?.cobros[0]).toMatchObject({
        medioTipo: "EFECTIVO",
        medioVigenteTipo: "TARJETA_CREDITO",
      });
      expect(dos?.cobrado).toEqual(importe("500.00"));
      // El movimiento original no se toca: el arqueo cerrado sigue como se contó.
      expect(
        (
          await filas<{ medio_de_pago_id: string }>(
            "select medio_de_pago_id from movimiento_caja where id = $1",
            [cobroId],
          )
        )[0]?.medio_de_pago_id,
      ).toBe(m.medios.EFECTIVO);
    });
  });
});
