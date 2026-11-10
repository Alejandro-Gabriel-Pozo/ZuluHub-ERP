import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type OpcionesDeMundoDeCaja,
} from "./caja-configuracion-apoyo";
import {
  CERO,
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  fechaLocal,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * Las consultas de la operación de caja (E3, tramo 5; e3 §3.10) con una base real y los roles limitados: `opcionesDeApertura`,
 * `resumenDeSesion`, `movimientosDeSesion`, `prepararCierre`, `listarSesiones` y `fichaDeSesion` (`cajas.ver`, `read committed`, alcance
 * de sucursal, solo lectura), y el aislamiento entre empresas de toda la operación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000 });

type Fila = Record<string, unknown>;
const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";

describe.skipIf(base === null)("operación de caja: consultas y aislamiento entre empresas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
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

  const casos = () => caja.casos;
  const consultas = () => caja.consultas;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeOperacion(entornoBase, dueno, caja, opciones);
  const en = (dias: number, minutos = 0, hora = "10:00") =>
    new Date(instanteLocal(dias, hora).getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeOperacion, dias = 1, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), en(dias, minutos, hora));
  const abrir = async (
    m: MundoDeOperacion,
    opciones: {
      fondo?: string;
      dias?: number;
      minutos?: number;
      hora?: string;
      cajaId?: string;
    } = {},
  ): Promise<string> => {
    const r = await casos().abrirSesion(ctxEn(m, opciones.dias, opciones.minutos, opciones.hora), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: opciones.cajaId ?? m.cajaId,
      fondoInicial: pesos(opciones.fondo ?? "1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir la sesión: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const ingresar = async (
    m: MundoDeOperacion,
    sesionId: string,
    importe: string,
    minutos = 5,
    dias = 1,
  ) => {
    const r = await casos().registrarMovimientoManual(ctxEn(m, dias, minutos), {
      claveDeIdempotencia: claveNueva(),
      sesionId,
      sentido: "INGRESO",
      importe: pesos(importe),
      motivo: "Cambio",
    });
    if (!r.ok) throw new Error(`no se pudo ingresar: ${JSON.stringify(r.error)}`);
    return r.valor.movimientoId;
  };
  const cerrar = async (
    m: MundoDeOperacion,
    sesionId: string,
    billetes: { denominacion: number; cantidad: number }[],
    monedas = "0.00",
    minutos = 60,
    dias = 1,
  ) => {
    const r = await casos().cerrarSesion(ctxEn(m, dias, minutos), {
      sesionId,
      conteo: { billetes, monedas: pesos(monedas) },
      otros: [],
      conformeGeneral: true,
      observacion: null,
    });
    if (!r.ok) throw new Error(`no se pudo cerrar: ${JSON.stringify(r.error)}`);
  };
  const medioDe = async (m: MundoDeOperacion, tipo: string, nombre: string) => {
    const r = await casos().crearMedioDePago(m.ctx(), { tipo, nombre });
    if (!r.ok) throw new Error(`no se pudo crear el medio: ${JSON.stringify(r.error)}`);
    return r.valor.medioDePagoId;
  };
  const cuentaDe = async (m: MundoDeOperacion, nombre: string) => {
    const r = await casos().crearCuentaDeCobro(m.ctx(), {
      tipo: "TERMINAL",
      nombre,
      identificadorExterno: null,
      sucursalId: m.sucursal,
    });
    if (!r.ok) throw new Error(`no se pudo crear la cuenta: ${JSON.stringify(r.error)}`);
    return r.valor.cuentaDeCobroId;
  };
  const foto = async (m: MundoDeOperacion) =>
    JSON.stringify({
      sesiones: await filas("select * from sesion_caja where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      movimientos: await filas("select * from movimiento_caja where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      arqueo: await filas("select * from arqueo_caja where empresa_id = $1 order by sesion_id", [
        m.empresa,
      ]),
      cajas: await filas("select * from caja where empresa_id = $1 order by id", [m.empresa]),
      jornadas: await filas("select * from jornada_de_sucursal where empresa_id = $1", [m.empresa]),
      auditoria: Number(
        (
          await filas<{ n: string }>(
            "select count(*) as n from auditoria_empresa where empresa_id = $1",
            [m.empresa],
          )
        )[0]?.n,
      ),
    });

  // =============================================================================================
  describe("opcionesDeApertura", () => {
    it("el fondo sugerido es el efectivo contado del último cierre de ESA caja, o vacío si nunca se cerró", async () => {
      const m = await mundo({ limiteDeCajas: 2 });
      const otraCaja = await casos().crearCaja(m.ctx(), {
        sucursalId: m.sucursal,
        nombre: "Caja 2",
      });
      if (!otraCaja.ok) throw new Error("no se creó la caja 2");
      expect(await consultas().opcionesDeApertura(ctxEn(m), { cajaId: m.cajaId })).toEqual({
        ok: true,
        valor: { cajaId: m.cajaId, fondoSugerido: null },
      });
      // Dos cierres de la caja 1: el último manda (por la hora de cierre). La caja 2 tiene el suyo.
      const primera = await abrir(m, { dias: 1 });
      await cerrar(m, primera, [{ denominacion: 1000, cantidad: 1 }], "0.00", 30);
      const segunda = await abrir(m, { dias: 1, minutos: 60 });
      await ingresar(m, segunda, "10.00", 65);
      await cerrar(
        m,
        segunda,
        [
          { denominacion: 1000, cantidad: 1 },
          { denominacion: 10, cantidad: 0 },
        ].slice(0, 1),
        "10.50",
        90,
      );
      const deLaOtra = await abrir(m, { dias: 1, cajaId: otraCaja.valor.cajaId, fondo: "50.00" });
      await cerrar(m, deLaOtra, [{ denominacion: 100, cantidad: 1 }], "0.00", 100);
      // Una sesión abierta no cuenta: solo lo contado en un cierre.
      await abrir(m, { dias: 1, minutos: 120, fondo: "77.00" });
      expect(await consultas().opcionesDeApertura(ctxEn(m), { cajaId: m.cajaId })).toEqual({
        ok: true,
        valor: { cajaId: m.cajaId, fondoSugerido: pesos("1010.50") },
      });
      expect(
        await consultas().opcionesDeApertura(ctxEn(m), { cajaId: otraCaja.valor.cajaId }),
      ).toEqual({
        ok: true,
        valor: { cajaId: otraCaja.valor.cajaId, fondoSugerido: pesos("100.00") },
      });
    });

    it("una caja inexistente (o que no es un UUID) es CAJA_NO_ENCONTRADA", async () => {
      const m = await mundo();
      for (const cajaId of [UUID_QUE_NO_EXISTE, "no-es-un-uuid"]) {
        expect(await consultas().opcionesDeApertura(ctxEn(m), { cajaId })).toEqual({
          ok: false,
          error: "CAJA_NO_ENCONTRADA",
        });
      }
    });
  });

  // =============================================================================================
  describe("resumenDeSesion y prepararCierre", () => {
    it("el esperado por medio y cuenta es la suma exacta de los movimientos; prepararCierre marca qué línea se cuenta con billetes", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const qr = await medioDe(m, "QR", "QR");
      const terminal = await cuentaDe(m, "Terminal 1");
      const sesion = await abrir(m, { fondo: "1000.00" });
      await ingresar(m, sesion, "0.10");
      await ingresar(m, sesion, "0.20");
      for (const [medio, cuenta, importe] of [
        [debito, terminal, "100.10"],
        [debito, terminal, "200.20"],
        [debito, null, "7.00"],
        [qr, null, "-3.33"],
      ] as const) {
        const r = await casos().registrarAjuste(ctxEn(m, 1, 10), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          medioDePagoId: medio,
          cuentaDeCobroId: cuenta,
          importe: pesos(importe),
          motivo: "Dinero sin otro registro",
          corrigeJornada: null,
        });
        expect(r.ok).toBe(true);
      }
      const resumen = await consultas().resumenDeSesion(ctxEn(m, 1, 20), { sesionId: sesion });
      expect(resumen.ok).toBe(true);
      if (!resumen.ok) return;
      expect(resumen.valor.sesion).toMatchObject({
        id: sesion,
        cajaId: m.cajaId,
        cajaNombre: "Caja 1",
        sucursalId: m.sucursal,
        estado: "ABIERTA",
        fechaDeNegocio: fechaLocal(en(1)),
        zonaHoraria: "America/Argentina/Buenos_Aires",
        abiertaEn: en(1).toISOString(),
        abiertaPor: m.persona,
        cerradaEn: null,
        cerradaPor: null,
      });
      const porLinea = Object.fromEntries(
        resumen.valor.lineas.map((l) => [
          `${l.medioTipo}/${l.cuentaNombre ?? "sin cuenta"}`,
          l.esperado,
        ]),
      );
      expect(porLinea).toEqual({
        "EFECTIVO/sin cuenta": pesos("1000.30"),
        "TARJETA_DEBITO/Terminal 1": pesos("300.30"),
        "TARJETA_DEBITO/sin cuenta": pesos("7.00"),
        "QR/sin cuenta": pesos("-3.33"),
      });
      const preparado = await consultas().prepararCierre(ctxEn(m, 1, 20), { sesionId: sesion });
      expect(preparado.ok).toBe(true);
      if (!preparado.ok) return;
      expect(preparado.valor).toMatchObject({ sesionId: sesion, estado: "ABIERTA" });
      expect(
        Object.fromEntries(
          preparado.valor.lineas.map((l) => [
            l.medioTipo + "/" + (l.cuentaNombre ?? "-"),
            l.contarConBilletes,
          ]),
        ),
      ).toEqual({
        "EFECTIVO/-": true,
        "TARJETA_DEBITO/Terminal 1": false,
        "TARJETA_DEBITO/-": false,
        "QR/-": false,
      });
      // Lo que se prepara es lo que después cierra: el arqueo calcula el mismo esperado.
      const cierre = await casos().cerrarSesion(ctxEn(m, 1, 30), {
        sesionId: sesion,
        conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: pesos("0.30") },
        otros: [],
        conformeGeneral: true,
        observacion: null,
      });
      expect(cierre.ok && cierre.valor.arqueo.map((l) => l.esperado.monto).sort()).toEqual(
        preparado.valor.lineas.map((l) => l.esperado.monto).sort(),
      );
    });

    it("las consultas no escriben nada, también con la sesión cerrada", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      await cerrar(m, sesion, [{ denominacion: 1000, cantidad: 1 }]);
      const antes = await foto(m);
      for (const consulta of [
        () => consultas().resumenDeSesion(ctxEn(m), { sesionId: sesion }),
        () => consultas().prepararCierre(ctxEn(m), { sesionId: sesion }),
        () => consultas().movimientosDeSesion(ctxEn(m), { sesionId: sesion }),
        () => consultas().fichaDeSesion(ctxEn(m), { sesionId: sesion }),
        () => consultas().opcionesDeApertura(ctxEn(m), { cajaId: m.cajaId }),
        () =>
          consultas().listarSesiones(ctxEn(m), {
            sucursalId: m.sucursal,
            desde: "2026-01-01",
            hasta: "2099-12-31",
          }),
      ]) {
        expect((await consulta()).ok).toBe(true);
      }
      expect(await foto(m)).toBe(antes);
    });

    it("una sesión inexistente, o que no es un UUID, es SESION_NO_ENCONTRADA", async () => {
      const m = await mundo();
      for (const sesionId of [UUID_QUE_NO_EXISTE, "no-es-un-uuid"]) {
        for (const consulta of [
          () => consultas().resumenDeSesion(ctxEn(m), { sesionId }),
          () => consultas().prepararCierre(ctxEn(m), { sesionId }),
          () => consultas().movimientosDeSesion(ctxEn(m), { sesionId }),
          () => consultas().fichaDeSesion(ctxEn(m), { sesionId }),
        ]) {
          expect(await consulta()).toEqual({ ok: false, error: "SESION_NO_ENCONTRADA" });
        }
      }
    });
  });

  // =============================================================================================
  describe("movimientosDeSesion", () => {
    it("pagina con cursor (registrado_en, id), en orden, sin repetir ni saltar", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ids: string[] = [];
      for (let i = 1; i <= 5; i += 1) ids.push(await ingresar(m, sesion, `${i}.00`, i));
      const vistos: string[] = [];
      let cursor: { registradoEn: string; id: string } | null = null;
      let paginas = 0;
      for (;;) {
        const pagina = await consultas().movimientosDeSesion(ctxEn(m, 1, 30), {
          sesionId: sesion,
          despuesDe: cursor,
          limite: 2,
        });
        expect(pagina.ok).toBe(true);
        if (!pagina.ok) return;
        paginas += 1;
        vistos.push(...pagina.valor.movimientos.map((x) => x.id));
        if (pagina.valor.siguiente === null) break;
        expect(pagina.valor.movimientos).toHaveLength(2);
        cursor = pagina.valor.siguiente;
      }
      expect(paginas).toBe(3);
      // El fondo (a las 10:00) primero y después los cinco ingresos en el orden en que se registraron.
      expect(vistos.slice(1)).toEqual(ids);
      expect(new Set(vistos).size).toBe(6);
    });

    it("devuelve hasta 100 por pedido, y rechaza un límite o un cursor inválidos", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      for (let i = 1; i <= 100; i += 1) await ingresar(m, sesion, "1.00", i % 50);
      const primera = await consultas().movimientosDeSesion(ctxEn(m, 1, 90), { sesionId: sesion });
      expect(primera.ok && primera.valor.movimientos).toHaveLength(100);
      expect(primera.ok && primera.valor.siguiente).not.toBeNull();
      const resto = await consultas().movimientosDeSesion(ctxEn(m, 1, 90), {
        sesionId: sesion,
        despuesDe: primera.ok ? primera.valor.siguiente : null,
      });
      expect(resto.ok && resto.valor.movimientos).toHaveLength(1);
      expect(resto.ok && resto.valor.siguiente).toBeNull();
      for (const limite of [0, -1, 101, 1.5, Number.NaN]) {
        expect(
          await consultas().movimientosDeSesion(ctxEn(m), { sesionId: sesion, limite }),
          String(limite),
        ).toEqual({ ok: false, error: "LIMITE_INVALIDO" });
      }
      for (const despuesDe of [
        { registradoEn: "no es una fecha", id: UUID_QUE_NO_EXISTE },
        { registradoEn: en(1).toISOString(), id: "no-es-un-uuid" },
        { registradoEn: en(1).toISOString(), id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
      ]) {
        expect(
          await consultas().movimientosDeSesion(ctxEn(m), { sesionId: sesion, despuesDe }),
        ).toEqual({ ok: false, error: "CURSOR_INVALIDO" });
      }
    });

    it("cada movimiento trae su medio, su cuenta, el importe como texto, el motivo, la anulación y quién lo registró", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const terminal = await cuentaDe(m, "Terminal 1");
      const sesion = await abrir(m);
      const ajuste = await casos().registrarAjuste(ctxEn(m, 1, 5), {
        claveDeIdempotencia: claveNueva(),
        sesionId: sesion,
        medioDePagoId: debito,
        cuentaDeCobroId: terminal,
        importe: pesos("-12.34"),
        motivo: "Faltante",
        corrigeJornada: null,
      });
      if (!ajuste.ok) throw new Error("no ajustó");
      const anulacion = await casos().anularMovimientoDeCaja(ctxEn(m, 1, 6), {
        claveDeIdempotencia: claveNueva(),
        movimientoId: ajuste.valor.movimientoId,
        motivo: "Me equivoqué",
      });
      if (!anulacion.ok) throw new Error("no anuló");
      const pagina = await consultas().movimientosDeSesion(ctxEn(m, 1, 30), { sesionId: sesion });
      expect(pagina.ok).toBe(true);
      if (!pagina.ok) return;
      const delAjuste = pagina.valor.movimientos.find((x) => x.id === ajuste.valor.movimientoId);
      expect(delAjuste).toEqual({
        id: ajuste.valor.movimientoId,
        clase: "AJUSTE",
        medioDePagoId: debito,
        medioTipo: "TARJETA_DEBITO",
        medioNombre: "Débito",
        cuentaDeCobroId: terminal,
        cuentaNombre: "Terminal 1",
        importe: pesos("-12.34"),
        motivo: "Faltante",
        anulaA: null,
        anuladoPor: anulacion.valor.anulacionId,
        corrigeJornada: null,
        registradoEn: en(1, 5).toISOString(),
        registradoPor: m.persona,
        origen: null,
        anulablePorElActor: false,
        motivoNoAnulable: "NO_ANULABLE",
      });
      const delEspejo = pagina.valor.movimientos.find((x) => x.id === anulacion.valor.anulacionId);
      expect(delEspejo).toMatchObject({
        clase: "ANULACION",
        anulaA: ajuste.valor.movimientoId,
        importe: pesos("12.34"),
        anulablePorElActor: false,
      });
    });
  });

  // =============================================================================================
  describe("listarSesiones", () => {
    it("filtra por fecha de NEGOCIO (no de calendario), de la más nueva a la más vieja", async () => {
      const m = await mundo();
      await dueno.query("update sucursal set hora_de_corte = '06:00' where id = $1", [m.sucursal]);
      // 05:30 con corte 06:00 es todavía la jornada anterior; 06:00 en punto es la nueva.
      const a = await abrir(m, { dias: 2, hora: "05:30" });
      await cerrar(m, a, [{ denominacion: 1000, cantidad: 1 }], "0.00", 10, 2);
      // Esta cae a las 06:30 del mismo día de calendario: otra jornada.
      const b = await abrir(m, { dias: 2, hora: "06:30" });
      await cerrar(m, b, [{ denominacion: 1000, cantidad: 1 }], "0.00", 10, 2);
      const c = await abrir(m, { dias: 3, hora: "10:00" });
      const dia = (dias: number) => fechaLocal(en(dias));
      const listar = async (desde: string, hasta: string) => {
        const r = await consultas().listarSesiones(ctxEn(m), {
          sucursalId: m.sucursal,
          desde,
          hasta,
        });
        if (!r.ok) throw new Error(JSON.stringify(r.error));
        return r.valor.map((s) => s.id);
      };
      expect(dia(2)).not.toBe(dia(1));
      // La sesión de las 05:30 es de la jornada del día anterior (dias=1), las de después de las 06:00 del día de calendario.
      expect(await listar(dia(1), dia(1))).toEqual([a]);
      expect(await listar(dia(2), dia(2))).toEqual([b]);
      expect(await listar(dia(1), dia(3))).toEqual([c, b, a]);
      expect(await listar(dia(4), dia(5))).toEqual([]);
      const r = await consultas().listarSesiones(ctxEn(m), {
        sucursalId: m.sucursal,
        desde: dia(1),
        hasta: dia(1),
      });
      expect(r.ok && r.valor[0]).toMatchObject({
        id: a,
        cajaNombre: "Caja 1",
        estado: "CERRADA",
        fechaDeNegocio: dia(1),
        zonaHoraria: "America/Argentina/Buenos_Aires",
      });
    });

    it("valida las fechas y la sucursal elegida (nunca «todas»)", async () => {
      const m = await mundo();
      const listar = (entrada: { sucursalId: string; desde: string; hasta: string }) =>
        consultas().listarSesiones(ctxEn(m), entrada);
      const buena = { sucursalId: m.sucursal as string, desde: "2026-11-01", hasta: "2026-11-09" };
      for (const mala of [
        { desde: "2026-11-10" },
        { desde: "2026-02-30" },
        { hasta: "ayer" },
        { desde: "" },
        { hasta: "2026-11-9" },
      ]) {
        expect(await listar({ ...buena, ...mala }), JSON.stringify(mala)).toEqual({
          ok: false,
          error: "FECHA_INVALIDA",
        });
      }
      expect(await listar({ ...buena, sucursalId: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      const operador = await sumarPersona(dueno, m, "OPERADOR", false);
      expect(await consultas().listarSesiones(conAhora(operador(), en(1)), buena)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
    });

    it("el operador ve las sesiones de sus sucursales y no las de otras", async () => {
      const m = await mundo();
      const otraSucursal = await otraSucursalDeCaja(dueno, m.empresa, "Norte");
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      await abrir(m);
      const deLaOtra = await casos().abrirSesion(ctxEn(m), {
        claveDeIdempotencia: claveNueva(),
        sucursalId: otraSucursal,
        cajaId: null,
        fondoInicial: pesos("5.00"),
      });
      expect(deLaOtra.ok).toBe(true);
      const rango = { desde: "2026-01-01", hasta: "2099-12-31" };
      const propias = await consultas().listarSesiones(conAhora(operador(), en(1)), {
        sucursalId: m.sucursal,
        ...rango,
      });
      expect(propias.ok && propias.valor).toHaveLength(1);
      expect(
        await consultas().listarSesiones(conAhora(operador(), en(1)), {
          sucursalId: otraSucursal,
          ...rango,
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      // El gerente (todas) las ve.
      const todas = await consultas().listarSesiones(ctxEn(m), {
        sucursalId: otraSucursal,
        ...rango,
      });
      expect(todas.ok && todas.valor).toHaveLength(1);
    });
  });

  // =============================================================================================
  describe("fichaDeSesion", () => {
    it("una sesión abierta no trae arqueo ni billetes; una cerrada trae el detalle de billetes, las monedas, la observación y el conforme", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const sesion = await abrir(m, { fondo: "1000.00" });
      const abierta = await consultas().fichaDeSesion(ctxEn(m, 1, 5), { sesionId: sesion });
      expect(abierta.ok && abierta.valor).toMatchObject({
        arqueo: [],
        billetes: [],
        observacion: null,
        horaDeCorte: "00:00",
        zonaHoraria: "America/Argentina/Buenos_Aires",
      });
      await casos().registrarAjuste(ctxEn(m, 1, 6), {
        claveDeIdempotencia: claveNueva(),
        sesionId: sesion,
        medioDePagoId: debito,
        cuentaDeCobroId: null,
        importe: pesos("40.00"),
        motivo: "Dinero sin otro registro",
        corrigeJornada: null,
      });
      const cierre = await casos().cerrarSesion(ctxEn(m, 1, 30), {
        sesionId: sesion,
        conteo: {
          billetes: [
            { denominacion: 500, cantidad: 1 },
            { denominacion: 200, cantidad: 2 },
            { denominacion: 100, cantidad: 0 },
          ],
          monedas: pesos("99.99"),
        },
        otros: [],
        conformeGeneral: true,
        observacion: "Faltó un billete chico",
      });
      expect(cierre.ok).toBe(true);
      const ficha = await consultas().fichaDeSesion(ctxEn(m, 1, 40), { sesionId: sesion });
      expect(ficha.ok).toBe(true);
      if (!ficha.ok) return;
      expect(ficha.valor.sesion).toMatchObject({
        estado: "CERRADA",
        cerradaEn: en(1, 30).toISOString(),
        cerradaPor: m.persona,
      });
      expect(ficha.valor.observacion).toBe("Faltó un billete chico");
      expect(ficha.valor.billetes).toEqual([
        { denominacion: 500, cantidad: 1 },
        { denominacion: 200, cantidad: 2 },
        { denominacion: 100, cantidad: 0 },
      ]);
      const efectivo = ficha.valor.arqueo.find((l) => l.medioTipo === "EFECTIVO");
      expect(efectivo).toMatchObject({
        esperado: pesos("1000.00"),
        contado: pesos("999.99"),
        monedas: pesos("99.99"),
        conforme: false,
        conformePor: null,
        diferencia: pesos("-0.01"),
      });
      const dePago = ficha.valor.arqueo.find((l) => l.medioTipo === "TARJETA_DEBITO");
      expect(dePago).toMatchObject({
        medioNombre: "Débito",
        esperado: pesos("40.00"),
        contado: null,
        monedas: null,
        conforme: true,
        conformePor: m.persona,
        conformeEn: en(1, 30).toISOString(),
        diferencia: null,
      });
    });
  });

  // =============================================================================================
  describe("aislamiento entre empresas", () => {
    it("la empresa B no ve ni toca las cajas, sesiones, movimientos ni arqueos de la A (mismo grupo y todo)", async () => {
      const a = await mundo();
      const b = await mundo();
      const sesionDeA = await abrir(a);
      const movimientoDeA = await ingresar(a, sesionDeA, "10.00");
      await cerrar(a, sesionDeA, [{ denominacion: 1000, cantidad: 1 }], "10.00");
      const abiertaDeA = await abrir(a, { dias: 2 });
      const antesDeA = await foto(a);
      const antesDeB = await foto(b);

      const noEncontrada = { ok: false, error: "SESION_NO_ENCONTRADA" };
      expect(await consultas().resumenDeSesion(ctxEn(b), { sesionId: sesionDeA })).toEqual(
        noEncontrada,
      );
      expect(await consultas().prepararCierre(ctxEn(b), { sesionId: sesionDeA })).toEqual(
        noEncontrada,
      );
      expect(await consultas().movimientosDeSesion(ctxEn(b), { sesionId: sesionDeA })).toEqual(
        noEncontrada,
      );
      expect(await consultas().fichaDeSesion(ctxEn(b), { sesionId: sesionDeA })).toEqual(
        noEncontrada,
      );
      expect(await consultas().opcionesDeApertura(ctxEn(b), { cajaId: a.cajaId })).toEqual({
        ok: false,
        error: "CAJA_NO_ENCONTRADA",
      });
      expect(await casos().iniciarCierre(ctxEn(b), { sesionId: abiertaDeA })).toEqual(noEncontrada);
      expect(await casos().cancelarCierre(ctxEn(b), { sesionId: abiertaDeA })).toEqual(
        noEncontrada,
      );
      expect(
        await casos().cerrarSesion(ctxEn(b), {
          sesionId: abiertaDeA,
          conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
          otros: [],
          conformeGeneral: true,
          observacion: null,
        }),
      ).toEqual(noEncontrada);
      expect(
        await casos().registrarMovimientoManual(ctxEn(b), {
          claveDeIdempotencia: claveNueva(),
          sesionId: abiertaDeA,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
      ).toEqual(noEncontrada);
      expect(
        await casos().anularMovimientoDeCaja(ctxEn(b), {
          claveDeIdempotencia: claveNueva(),
          movimientoId: movimientoDeA,
          motivo: "Me equivoqué",
        }),
      ).toEqual({ ok: false, error: "MOVIMIENTO_NO_ENCONTRADO" });
      // Abrir sobre la caja de A desde B, con la sucursal de B o la de A.
      for (const sucursalId of [b.sucursal, a.sucursal]) {
        const r = await casos().abrirSesion(ctxEn(b, 2), {
          claveDeIdempotencia: claveNueva(),
          sucursalId,
          cajaId: a.cajaId,
          fondoInicial: pesos("1.00"),
        });
        expect(r.ok).toBe(false);
        expect([
          "CAJA_NO_ENCONTRADA",
          "SUCURSAL_NO_ENCONTRADA",
          "SUCURSAL_FUERA_DE_ALCANCE",
        ]).toContain(r.ok ? null : r.error);
      }
      expect(await foto(a)).toBe(antesDeA);
      expect(await foto(b)).toBe(antesDeB);
    });

    it("la misma clave de idempotencia en dos empresas son dos operaciones distintas (la clave es única POR empresa)", async () => {
      const a = await mundo();
      const b = await mundo();
      const clave = claveNueva();
      const abrirCon = (m: MundoDeOperacion) =>
        casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: clave,
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("1.00"),
        });
      const deA = await abrirCon(a);
      const deB = await abrirCon(b);
      expect(deA.ok && deA.valor.yaExistia).toBe(false);
      expect(deB.ok && deB.valor.yaExistia).toBe(false);
      expect(deA.ok && deB.ok && deA.valor.sesionId !== deB.valor.sesionId).toBe(true);
    });
  });
});
