import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cargarElConteo, cargarLaCaja } from "../../src/composicion/lecturas-de-sesion-de-caja-web";
import {
  abrirLaCaja,
  anularElMovimiento,
  cancelarElCierreDeCaja,
  cerrarLaCaja,
  iniciarElCierreDeCaja,
  registrarElAjuste,
  registrarElMovimiento,
  type DependenciasDeSesionDeCajaWeb,
} from "../../src/composicion/sesion-de-caja-web";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
} from "./caja-configuracion-apoyo";
import {
  conAhora,
  crearMundoDeOperacion,
  fechaLocal,
  instanteLocal,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * La pantalla «Caja» del mostrador (servidor + composición web) contra una base real y los roles reales: lo que la pantalla lee, cada acción con su resultado y su error, que
 * repetir (doble clic, reintento) no duplica nada, que dos acciones a la vez no se pisan, que el permiso, la sucursal y la empresa los decide el servidor, y que el dinero y la
 * fecha de negocio (Argentina) salen bien. Los casos de uso en sí tienen sus pruebas en `caja-operacion-*.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000 });

const GENERICO = "CAJA_ACCION_NO_PERMITIDA";
const clave = (): string => randomUUID();

describe.skipIf(base === null)("pantalla «Caja» del mostrador", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let d: DependenciasDeSesionDeCajaWeb;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    const caja = armarCaja(entorno);
    d = {
      casosDeUso: () => caja.casos,
      consultas: () => caja.consultas,
      respuesta: { registrar: () => undefined },
    };
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const mundo = () => crearMundoDeOperacion(entornoBase, dueno, armarCaja(entorno));
  const ctx = (m: MundoDeOperacion, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), new Date(instanteLocal(1, hora).getTime() + minutos * 60_000));
  const filas = async <T extends Record<string, unknown>>(texto: string, parametros: unknown[]) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[]) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const efectivoDe = async (m: MundoDeOperacion) =>
    (
      await filas<{ id: string }>(
        "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
        [m.empresa],
      )
    )[0]?.id as string;
  const abrir = async (m: MundoDeOperacion, fondo = "1000.00", minutos = 0) => {
    const r = await abrirLaCaja(d, ctx(m, minutos), m.sucursal, {
      claveDeIdempotencia: clave(),
      cajaId: m.cajaId,
      fondoInicial: fondo,
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${r.error.codigo}`);
    return r.dato.sesionId;
  };
  const movimiento = (
    m: MundoDeOperacion,
    sesionId: string,
    extra: Record<string, unknown> = {},
    minutos = 5,
  ) =>
    registrarElMovimiento(d, ctx(m, minutos), {
      claveDeIdempotencia: clave(),
      sesionId,
      sentido: "INGRESO",
      importe: "100.00",
      motivo: "Cambio",
      ...extra,
    });
  const cierre = (m: MundoDeOperacion, sesionId: string, extra: Record<string, unknown> = {}) =>
    cerrarLaCaja(d, ctx(m, 60), {
      sesionId,
      conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: "" },
      otros: [],
      conformeGeneral: true,
      observacion: null,
      ...extra,
    });
  const sesiones = (m: MundoDeOperacion) =>
    contar("select count(*) as n from sesion_caja where empresa_id = $1", [m.empresa]);
  const movimientos = (m: MundoDeOperacion, clase?: string) =>
    clase === undefined
      ? contar("select count(*) as n from movimiento_caja where empresa_id = $1", [m.empresa])
      : contar("select count(*) as n from movimiento_caja where empresa_id = $1 and clase = $2", [
          m.empresa,
          clase,
        ]);
  const auditorias = (m: MundoDeOperacion, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);

  describe("lo que la pantalla lee", () => {
    it("recorre la caja: cerrada sin historia, abierta con su jornada, corte, esperado y movimientos, y cerrada con el resumen de la última sesión", async () => {
      const m = await mundo();
      const inicial = await cargarLaCaja(d, ctx(m), m.sucursal);
      if (!inicial.ok) throw new Error(inicial.error.codigo);
      expect(inicial.dato.jornadaActual.estado).toBe("ABIERTA");
      expect(inicial.dato.cajas).toEqual([
        {
          cajaId: m.cajaId,
          nombre: "Caja 1",
          estado: "SIN_SESION",
          jornadaVencida: false,
          sesion: null,
          ultimaSesion: null,
        },
      ]);

      const sesionId = await abrir(m, "1000.00");
      const ingreso = await movimiento(m, sesionId, { importe: "250.50" });
      expect(ingreso.ok).toBe(true);
      const abierta = await cargarLaCaja(d, ctx(m, 10), m.sucursal);
      if (!abierta.ok) throw new Error(abierta.error.codigo);
      const caja = abierta.dato.cajas[0];
      expect(caja?.estado).toBe("ABIERTA");
      expect(caja?.ultimaSesion).toBeNull();
      expect(caja?.sesion).toMatchObject({
        sesionId,
        fechaDeNegocio: fechaLocal(ctx(m).ahora),
        horaDeCorte: expect.stringMatching(/^\d{2}:\d{2}/) as unknown,
        hayMasMovimientos: false,
      });
      expect(caja?.sesion?.lineas).toEqual([
        expect.objectContaining({
          medioTipo: "EFECTIVO",
          esperado: { moneda: "ARS", monto: "1250.50" },
        }),
      ]);
      expect(caja?.sesion?.movimientos.map((x) => [x.clase, x.importe.monto])).toEqual([
        ["FONDO_INICIAL", "1000.00"],
        ["INGRESO_MANUAL", "250.50"],
      ]);
      expect(caja?.sesion?.movimientos.map((x) => x.anulablePorElActor)).toEqual([false, true]);
    });

    it("cargarElConteo trae las líneas a cubrir y los billetes que dicta el dominio (la pantalla no los repite)", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const r = await cargarElConteo(d, ctx(m), { sesionId });
      if (!r.ok) throw new Error(r.error.codigo);
      expect(r.dato.estado).toBe("ABIERTA");
      expect(r.dato.denominaciones).toEqual([20000, 10000, 2000, 1000, 500, 200, 100]);
      expect(r.dato.cantidadMaximaDeBilletes).toBe(99999);
      expect(r.dato.lineas).toEqual([
        expect.objectContaining({ medioTipo: "EFECTIVO", contarConBilletes: true }),
      ]);
      expect(codigoDe(await cargarElConteo(d, ctx(m), { sesionId: "no-es-un-id" }))).toBe(GENERICO);
    });

    it("la caja de la sucursal elegida: ninguna sucursal, una ajena o una de otra empresa es el genérico y no filtra nada", async () => {
      const a = await mundo();
      const b = await mundo();
      for (const sucursal of ["", "todas", b.sucursal]) {
        expect(codigoDe(await cargarLaCaja(d, ctx(a), sucursal))).toBe(GENERICO);
      }
    });
  });

  describe("abrir la caja", () => {
    it("abre con el fondo (texto decimal, en pesos) y deja su movimiento, la sesión sellada con la jornada de Argentina y la auditoría", async () => {
      const m = await mundo();
      const r = await abrirLaCaja(d, ctx(m), m.sucursal, {
        claveDeIdempotencia: clave(),
        cajaId: m.cajaId,
        fondoInicial: "15000.00",
      });
      if (!r.ok) throw new Error(r.error.codigo);
      expect(r.dato).toMatchObject({ fechaDeNegocio: fechaLocal(ctx(m).ahora), yaExistia: false });
      const fondo = await filas<{ importe: string; moneda: string; registrado_por: string }>(
        "select importe::text, moneda, registrado_por from movimiento_caja where sesion_id = $1 and clase = 'FONDO_INICIAL'",
        [r.dato.sesionId],
      );
      expect(fondo).toEqual([{ importe: "15000.00", moneda: "ARS", registrado_por: m.persona }]);
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
    });

    it("el corte de día: a las 23:30 de Argentina es la jornada de hoy y a las 00:30 la de mañana", async () => {
      const noche = await mundo();
      const tarde = await abrirLaCaja(d, ctx(noche, 0, "23:30"), noche.sucursal, {
        claveDeIdempotencia: clave(),
        cajaId: noche.cajaId,
        fondoInicial: "0",
      });
      const madrugada = await mundo();
      const siguiente = await abrirLaCaja(d, ctx(madrugada, 0, "00:30"), madrugada.sucursal, {
        claveDeIdempotencia: clave(),
        cajaId: madrugada.cajaId,
        fondoInicial: "0",
      });
      if (!tarde.ok || !siguiente.ok) throw new Error("no se abrió");
      expect(tarde.dato.fechaDeNegocio).toBe(fechaLocal(instanteLocal(1, "23:30")));
      expect(siguiente.dato.fechaDeNegocio).toBe(fechaLocal(instanteLocal(1, "00:30")));
      expect(tarde.dato.fechaDeNegocio).toBe(siguiente.dato.fechaDeNegocio);
    });

    it("IDEMPOTENCIA: repetir con la misma clave (clic doble) devuelve la misma sesión con yaExistia y no duplica nada; la misma clave con otro fondo es rechazada", async () => {
      const m = await mundo();
      const k = clave();
      const pedido = { claveDeIdempotencia: k, cajaId: m.cajaId, fondoInicial: "500.00" };
      const uno = await abrirLaCaja(d, ctx(m), m.sucursal, pedido);
      const dos = await abrirLaCaja(d, ctx(m, 1), m.sucursal, pedido);
      if (!uno.ok || !dos.ok) throw new Error("se esperaban dos respuestas correctas");
      expect(dos.dato.sesionId).toBe(uno.dato.sesionId);
      expect([uno.dato.yaExistia, dos.dato.yaExistia]).toEqual([false, true]);
      expect(await sesiones(m)).toBe(1);
      expect(await movimientos(m, "FONDO_INICIAL")).toBe(1);
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
      expect(
        codigoDe(
          await abrirLaCaja(d, ctx(m, 2), m.sucursal, { ...pedido, fondoInicial: "600.00" }),
        ),
      ).toBe(GENERICO);
      expect(await sesiones(m)).toBe(1);
    });

    it("CONCURRENCIA: dos aperturas a la vez de la misma caja (claves distintas): una gana y la otra recibe el genérico; una sola sesión y un solo fondo", async () => {
      const m = await mundo();
      const pedir = (fondo: string) =>
        abrirLaCaja(d, ctx(m), m.sucursal, {
          claveDeIdempotencia: clave(),
          cajaId: m.cajaId,
          fondoInicial: fondo,
        });
      const [a, b] = await Promise.all([pedir("100.00"), pedir("200.00")]);
      expect([a, b].map(codigoDe).sort()).toEqual([GENERICO, "OK"].sort());
      expect(await sesiones(m)).toBe(1);
      expect(await movimientos(m, "FONDO_INICIAL")).toBe(1);
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
    });

    it("CONCURRENCIA + IDEMPOTENCIA: dos clics simultáneos con la MISMA clave dan la misma sesión (los dos correctos) y una sola apertura", async () => {
      const m = await mundo();
      const pedido = { claveDeIdempotencia: clave(), cajaId: m.cajaId, fondoInicial: "100.00" };
      const [a, b] = await Promise.all([
        abrirLaCaja(d, ctx(m), m.sucursal, pedido),
        abrirLaCaja(d, ctx(m), m.sucursal, pedido),
      ]);
      if (!a.ok || !b.ok) throw new Error(`${codigoDe(a)} ${codigoDe(b)}`);
      expect(a.dato.sesionId).toBe(b.dato.sesionId);
      expect(await sesiones(m)).toBe(1);
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
    });

    it.each([
      ["negativo", "-5"],
      ["con exponente", "1e3"],
      ["con letras", "5400abc"],
      ["con tres decimales (no se redondea)", "10.001"],
      ["vacío", ""],
      ["con coma", "10,50"],
      ["más allá del tope", "1000000000.00"],
    ])("un fondo %s se rechaza sin escribir nada", async (_nombre, fondo) => {
      const m = await mundo();
      const r = await abrirLaCaja(d, ctx(m), m.sucursal, {
        claveDeIdempotencia: clave(),
        cajaId: m.cajaId,
        fondoInicial: fondo,
      });
      expect(codigoDe(r)).toBe(GENERICO);
      expect(await sesiones(m)).toBe(0);
    });

    it("el pedido manda su propia sucursal o empresa: se ignoran (las fija el servidor); una caja de otra sucursal o de otra empresa es el genérico", async () => {
      const m = await mundo();
      const otraEmpresa = await mundo();
      const otraSuc = await otraSucursalDeCaja(dueno, m.empresa, "Anexo");
      const r = await abrirLaCaja(d, ctx(m), m.sucursal, {
        claveDeIdempotencia: clave(),
        cajaId: otraEmpresa.cajaId,
        fondoInicial: "1.00",
        sucursalId: otraSuc,
        empresaId: otraEmpresa.empresa,
      });
      expect(codigoDe(r)).toBe(GENERICO);
      expect(await sesiones(m)).toBe(0);
      expect(await sesiones(otraEmpresa)).toBe(0);
      // Con una sucursal ajena como la elegida por el servidor, la caja de la propia no coincide.
      expect(
        codigoDe(
          await abrirLaCaja(d, ctx(m), otraSuc, {
            claveDeIdempotencia: clave(),
            cajaId: m.cajaId,
            fondoInicial: "1.00",
          }),
        ),
      ).toBe(GENERICO);
      expect(await sesiones(m)).toBe(0);
    });

    it("un operador sin esa sucursal asignada no abre (fuera de alcance, el genérico); asignado, sí", async () => {
      const m = await mundo();
      const sin = await sumarPersona(dueno, m, "OPERADOR", false);
      const con = await sumarPersona(dueno, m, "OPERADOR", true);
      const pedido = () => ({
        claveDeIdempotencia: clave(),
        cajaId: m.cajaId,
        fondoInicial: "1.00",
      });
      expect(
        codigoDe(await abrirLaCaja(d, conAhora(sin(), ctx(m).ahora), m.sucursal, pedido())),
      ).toBe(GENERICO);
      expect(await sesiones(m)).toBe(0);
      expect(
        codigoDe(await abrirLaCaja(d, conAhora(con(), ctx(m).ahora), m.sucursal, pedido())),
      ).toBe("OK");
    });
  });

  describe("iniciar y cancelar el cierre", () => {
    it("recorre abierta → en cierre → abierta; repetir cada paso no cambia nada (ya estaba) y no suma auditoría", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const a = await iniciarElCierreDeCaja(d, ctx(m, 5), { sesionId });
      const b = await iniciarElCierreDeCaja(d, ctx(m, 6), { sesionId });
      expect([a, b].map((r) => (r.ok ? r.dato.yaEstabaEnCierre : null))).toEqual([false, true]);
      expect(await auditorias(m, "SESION_CAJA_CIERRE_INICIADO")).toBe(1);
      // Mientras se cuenta no entran movimientos.
      expect(codigoDe(await movimiento(m, sesionId, {}, 7))).toBe(GENERICO);
      const c = await cancelarElCierreDeCaja(d, ctx(m, 8), { sesionId });
      const e = await cancelarElCierreDeCaja(d, ctx(m, 9), { sesionId });
      expect([c, e].map((r) => (r.ok ? r.dato.yaEstabaAbierta : null))).toEqual([false, true]);
      expect(codigoDe(await movimiento(m, sesionId, {}, 10))).toBe("OK");
    });

    it("CONCURRENCIA: dos pedidos de iniciar el cierre a la vez dejan una sola transición y una sola auditoría", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const [a, b] = await Promise.all([
        iniciarElCierreDeCaja(d, ctx(m, 5), { sesionId }),
        iniciarElCierreDeCaja(d, ctx(m, 5), { sesionId }),
      ]);
      expect([a.ok, b.ok]).toEqual([true, true]);
      expect(await auditorias(m, "SESION_CAJA_CIERRE_INICIADO")).toBe(1);
    });

    it("una sesión de otra empresa o inexistente es el genérico, igual para las dos", async () => {
      const a = await mundo();
      const b = await mundo();
      const ajena = await abrir(b);
      const r1 = await iniciarElCierreDeCaja(d, ctx(a, 5), { sesionId: ajena });
      const r2 = await iniciarElCierreDeCaja(d, ctx(a, 5), { sesionId: randomUUID() });
      expect(r1).toEqual(r2);
      expect(codigoDe(r1)).toBe(GENERICO);
      expect(await auditorias(b, "SESION_CAJA_CIERRE_INICIADO")).toBe(0);
    });
  });

  describe("movimientos de efectivo", () => {
    it("registra un ingreso y un egreso con motivo, en pesos, con quién y cuándo, y su auditoría; nada se borra", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const ingreso = await movimiento(m, sesionId, { importe: "250.50", motivo: "Cambio chico" });
      const egreso = await movimiento(m, sesionId, {
        sentido: "EGRESO",
        importe: "75.25",
        motivo: "Hielo",
      });
      expect([ingreso.ok, egreso.ok]).toEqual([true, true]);
      expect(
        await filas(
          "select clase, importe::text, moneda, motivo, registrado_por from movimiento_caja where sesion_id = $1 and clase <> 'FONDO_INICIAL' order by clase",
          [sesionId],
        ),
      ).toEqual([
        {
          clase: "EGRESO_MANUAL",
          importe: "-75.25",
          moneda: "ARS",
          motivo: "Hielo",
          registrado_por: m.persona,
        },
        {
          clase: "INGRESO_MANUAL",
          importe: "250.50",
          moneda: "ARS",
          motivo: "Cambio chico",
          registrado_por: m.persona,
        },
      ]);
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(2);
    });

    it("IDEMPOTENCIA: la misma clave dos veces es un solo movimiento (yaExistia la segunda); con otro importe es rechazada", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const k = clave();
      const a = await movimiento(m, sesionId, { claveDeIdempotencia: k });
      const b = await movimiento(m, sesionId, { claveDeIdempotencia: k }, 6);
      if (!a.ok || !b.ok) throw new Error("se esperaban dos respuestas correctas");
      expect(b.dato.movimientoId).toBe(a.dato.movimientoId);
      expect([a.dato.yaExistia, b.dato.yaExistia]).toEqual([false, true]);
      expect(await movimientos(m, "INGRESO_MANUAL")).toBe(1);
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
      expect(
        codigoDe(await movimiento(m, sesionId, { claveDeIdempotencia: k, importe: "999.00" }, 7)),
      ).toBe(GENERICO);
      expect(await movimientos(m, "INGRESO_MANUAL")).toBe(1);
    });

    it("CONCURRENCIA + IDEMPOTENCIA: doble clic simultáneo (misma clave) deja un solo movimiento y los dos correctos", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const k = clave();
      const [a, b] = await Promise.all([
        movimiento(m, sesionId, { claveDeIdempotencia: k }),
        movimiento(m, sesionId, { claveDeIdempotencia: k }),
      ]);
      if (!a.ok || !b.ok) throw new Error(`${codigoDe(a)} ${codigoDe(b)}`);
      expect(a.dato.movimientoId).toBe(b.dato.movimientoId);
      expect(await movimientos(m, "INGRESO_MANUAL")).toBe(1);
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
    });

    it("CONCURRENCIA: diez movimientos distintos a la vez se registran los diez y el esperado es la suma exacta", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "0.00");
      const rs = await Promise.all(
        Array.from({ length: 10 }, (_v, i) => movimiento(m, sesionId, { importe: `${i + 1}.10` })),
      );
      expect(rs.map(codigoDe)).toEqual(Array(10).fill("OK"));
      const conteo = await cargarElConteo(d, ctx(m, 10), { sesionId });
      if (!conteo.ok) throw new Error(conteo.error.codigo);
      expect(conteo.dato.lineas[0]?.esperado).toEqual({ moneda: "ARS", monto: "56.00" });
    });

    it.each([
      ["importe negativo", { importe: "-10.00" }],
      ["importe cero", { importe: "0" }],
      ["importe con exponente", { importe: "1e2" }],
      ["motivo en blanco", { motivo: "   " }],
      ["sentido inventado", { sentido: "AJUSTE" }],
      ["clave sin la forma pedida", { claveDeIdempotencia: "uno" }],
    ])("%s: se rechaza y no escribe nada", async (_n, extra) => {
      const m = await mundo();
      const sesionId = await abrir(m);
      expect(codigoDe(await movimiento(m, sesionId, extra))).toBe(GENERICO);
      expect(await movimientos(m, "INGRESO_MANUAL")).toBe(0);
      expect(await movimientos(m, "EGRESO_MANUAL")).toBe(0);
    });

    it("una sesión de otra empresa no se toca: el genérico, sin movimiento en ninguna", async () => {
      const a = await mundo();
      const b = await mundo();
      const ajena = await abrir(b);
      expect(codigoDe(await movimiento(a, ajena))).toBe(GENERICO);
      expect(await movimientos(b, "INGRESO_MANUAL")).toBe(0);
    });
  });

  describe("ajuste (solo gerente y administrador)", () => {
    it("«Falta» resta y «Sobra» suma, sobre el efectivo, con motivo; y el signo no se manda: «Sobra» con importe negativo se rechaza", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const medioDePagoId = await efectivoDe(m);
      const ajuste = (extra: Record<string, unknown>) =>
        registrarElAjuste(d, ctx(m, 5), {
          claveDeIdempotencia: clave(),
          sesionId,
          medioDePagoId,
          cuentaDeCobroId: null,
          sentido: "FALTA",
          importe: "30.00",
          motivo: "Billete falso",
          ...extra,
        });
      expect(codigoDe(await ajuste({}))).toBe("OK");
      expect(
        codigoDe(await ajuste({ sentido: "SOBRA", importe: "12.50", motivo: "Propina" })),
      ).toBe("OK");
      expect(codigoDe(await ajuste({ sentido: "SOBRA", importe: "-12.50" }))).toBe(GENERICO);
      expect(codigoDe(await ajuste({ importe: "0" }))).toBe(GENERICO);
      expect(
        (
          await filas<{ importe: string; corrige_jornada: string | null }>(
            "select importe::text, corrige_jornada from movimiento_caja where sesion_id = $1 and clase = 'AJUSTE' order by importe",
            [sesionId],
          )
        ).map((x) => [x.importe, x.corrige_jornada]),
      ).toEqual([
        ["-30.00", null],
        ["12.50", null],
      ]);
      expect(await auditorias(m, "AJUSTE_REGISTRADO")).toBe(2);
    });

    it("AUTORIZACIÓN: un operador no ajusta (SIN_PERMISO) aunque la pantalla se lo muestre; el gerente sí; repetir con la misma clave no duplica", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const medioDePagoId = await efectivoDe(m);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const k = clave();
      const pedido = {
        claveDeIdempotencia: k,
        sesionId,
        medioDePagoId,
        cuentaDeCobroId: null,
        sentido: "FALTA",
        importe: "5.00",
        motivo: "Error de carga",
      };
      expect(
        codigoDe(await registrarElAjuste(d, conAhora(operador(), ctx(m, 5).ahora), pedido)),
      ).toBe("SIN_PERMISO");
      expect(await movimientos(m, "AJUSTE")).toBe(0);
      const a = await registrarElAjuste(d, ctx(m, 6), pedido);
      const b = await registrarElAjuste(d, ctx(m, 7), pedido);
      if (!a.ok || !b.ok) throw new Error(`${codigoDe(a)} ${codigoDe(b)}`);
      expect(b.dato).toEqual({ movimientoId: a.dato.movimientoId, yaExistia: true });
      expect(await movimientos(m, "AJUSTE")).toBe(1);
    });

    it("un medio de otra empresa en el ajuste es el genérico y no escribe", async () => {
      const a = await mundo();
      const b = await mundo();
      const sesionId = await abrir(a);
      const r = await registrarElAjuste(d, ctx(a, 5), {
        claveDeIdempotencia: clave(),
        sesionId,
        medioDePagoId: await efectivoDe(b),
        cuentaDeCobroId: null,
        sentido: "FALTA",
        importe: "5.00",
        motivo: "X",
      });
      expect(codigoDe(r)).toBe(GENERICO);
      expect(await movimientos(a, "AJUSTE")).toBe(0);
    });
  });

  describe("anular un movimiento", () => {
    it("se anula con un registro nuevo y un motivo: el original queda intacto y el esperado vuelve", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "1000.00");
      const ingreso = await movimiento(m, sesionId, { importe: "300.00" });
      if (!ingreso.ok) throw new Error(ingreso.error.codigo);
      const r = await anularElMovimiento(d, ctx(m, 10), {
        claveDeIdempotencia: clave(),
        movimientoId: ingreso.dato.movimientoId,
        motivo: "Me equivoqué",
      });
      if (!r.ok) throw new Error(r.error.codigo);
      expect(
        await filas(
          "select clase, importe::text, motivo, anula_a from movimiento_caja where sesion_id = $1 and clase in ('INGRESO_MANUAL','ANULACION') order by clase",
          [sesionId],
        ),
      ).toEqual([
        {
          clase: "ANULACION",
          importe: "-300.00",
          motivo: "Me equivoqué",
          anula_a: ingreso.dato.movimientoId,
        },
        { clase: "INGRESO_MANUAL", importe: "300.00", motivo: "Cambio", anula_a: null },
      ]);
      const conteo = await cargarElConteo(d, ctx(m, 11), { sesionId });
      if (!conteo.ok) throw new Error(conteo.error.codigo);
      expect(conteo.dato.lineas[0]?.esperado.monto).toBe("1000.00");
      expect(await auditorias(m, "MOVIMIENTO_ANULADO")).toBe(1);
    });

    it("IDEMPOTENCIA y CONCURRENCIA: la misma clave dos veces (también a la vez) es una sola anulación; dos claves distintas a la vez dejan una anulada y la otra rechazada", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const a = await movimiento(m, sesionId);
      const b = await movimiento(m, sesionId);
      if (!a.ok || !b.ok) throw new Error("no se cargaron");
      const anular = (movimientoId: string, k: string) =>
        anularElMovimiento(d, ctx(m, 10), {
          claveDeIdempotencia: k,
          movimientoId,
          motivo: "Error",
        });
      const k = clave();
      const [x, y] = await Promise.all([
        anular(a.dato.movimientoId, k),
        anular(a.dato.movimientoId, k),
      ]);
      if (!x.ok || !y.ok) throw new Error(`${codigoDe(x)} ${codigoDe(y)}`);
      expect(x.dato.anulacionId).toBe(y.dato.anulacionId);
      const [p, q] = await Promise.all([
        anular(b.dato.movimientoId, clave()),
        anular(b.dato.movimientoId, clave()),
      ]);
      expect([p, q].map(codigoDe).sort()).toEqual([GENERICO, "OK"].sort());
      expect(await movimientos(m, "ANULACION")).toBe(2);
    });

    it("AUTORIZACIÓN: el operador anula solo lo que cargó él; el gerente, cualquiera; un cobro o el fondo no se anulan", async () => {
      const m = await mundo();
      const sesionId = await abrir(m);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const delOperador = conAhora(operador(), ctx(m, 5).ahora);
      const delGerente = await movimiento(m, sesionId);
      const propio = await registrarElMovimiento(d, delOperador, {
        claveDeIdempotencia: clave(),
        sesionId,
        sentido: "INGRESO",
        importe: "50.00",
        motivo: "Cambio",
      });
      if (!delGerente.ok || !propio.ok) throw new Error("no se cargaron");
      const anular = (c: typeof delOperador, movimientoId: string) =>
        anularElMovimiento(d, c, { claveDeIdempotencia: clave(), movimientoId, motivo: "Error" });
      expect(codigoDe(await anular(delOperador, delGerente.dato.movimientoId))).toBe(GENERICO);
      expect(codigoDe(await anular(delOperador, propio.dato.movimientoId))).toBe("OK");
      expect(codigoDe(await anular(ctx(m, 20), delGerente.dato.movimientoId))).toBe("OK");
      const fondo = (
        await filas<{ id: string }>(
          "select id from movimiento_caja where sesion_id = $1 and clase = 'FONDO_INICIAL'",
          [sesionId],
        )
      )[0]?.id as string;
      expect(codigoDe(await anular(ctx(m, 21), fondo))).toBe(GENERICO);
    });

    it("sin motivo no se anula; un movimiento de otra empresa es el genérico", async () => {
      const a = await mundo();
      const b = await mundo();
      const sa = await abrir(a);
      const sb = await abrir(b);
      const mb = await movimiento(b, sb);
      const ma = await movimiento(a, sa);
      if (!ma.ok || !mb.ok) throw new Error("no se cargaron");
      expect(
        codigoDe(
          await anularElMovimiento(d, ctx(a, 10), {
            claveDeIdempotencia: clave(),
            movimientoId: ma.dato.movimientoId,
            motivo: "  ",
          }),
        ),
      ).toBe(GENERICO);
      expect(
        codigoDe(
          await anularElMovimiento(d, ctx(a, 10), {
            claveDeIdempotencia: clave(),
            movimientoId: mb.dato.movimientoId,
            motivo: "Error",
          }),
        ),
      ).toBe(GENERICO);
      expect(await movimientos(a, "ANULACION")).toBe(0);
      expect(await movimientos(b, "ANULACION")).toBe(0);
    });
  });

  describe("cerrar la caja con el arqueo", () => {
    it("cierra contando el efectivo por billetes y monedas (monedas vacías = cero) y deja el arqueo con su diferencia; después la caja se ve cerrada con el resumen", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "1000.00");
      await movimiento(m, sesionId, { importe: "250.50" });
      const r = await cierre(m, sesionId, {
        conteo: {
          billetes: [
            { denominacion: 1000, cantidad: 1 },
            { denominacion: 200, cantidad: 1 },
          ],
          monedas: "40.00",
        },
      });
      if (!r.ok) throw new Error(r.error.codigo);
      expect(r.dato.yaEstabaCerrada).toBe(false);
      expect(r.dato.arqueo).toEqual([
        expect.objectContaining({
          esperado: { moneda: "ARS", monto: "1250.50" },
          contado: { moneda: "ARS", monto: "1240.00" },
          diferencia: { moneda: "ARS", monto: "-10.50" },
          conforme: false,
        }),
      ]);
      expect(await auditorias(m, "SESION_CAJA_CERRADA")).toBe(1);
      const vista = await cargarLaCaja(d, ctx(m, 70), m.sucursal);
      if (!vista.ok) throw new Error(vista.error.codigo);
      expect(vista.dato.cajas[0]?.estado).toBe("SIN_SESION");
      expect(vista.dato.cajas[0]?.ultimaSesion).toMatchObject({ sesionId });
      expect(vista.dato.cajas[0]?.ultimaSesion?.arqueo[0]).toMatchObject({
        medioTipo: "EFECTIVO",
        contado: { moneda: "ARS", monto: "1240.00" },
        diferencia: { moneda: "ARS", monto: "-10.50" },
      });
    });

    it("IDEMPOTENCIA: cerrar dos veces con el mismo conteo es un solo cierre (yaEstabaCerrada); con otro conteo, el genérico y el arqueo no cambia", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "1000.00");
      const a = await cierre(m, sesionId);
      const b = await cierre(m, sesionId);
      if (!a.ok || !b.ok) throw new Error(`${codigoDe(a)} ${codigoDe(b)}`);
      expect([a.dato.yaEstabaCerrada, b.dato.yaEstabaCerrada]).toEqual([false, true]);
      expect(await auditorias(m, "SESION_CAJA_CERRADA")).toBe(1);
      const otro = await cierre(m, sesionId, {
        conteo: { billetes: [{ denominacion: 500, cantidad: 1 }], monedas: "" },
      });
      expect(codigoDe(otro)).toBe(GENERICO);
      expect(
        await filas("select contado::text from arqueo_caja where sesion_id = $1", [sesionId]),
      ).toEqual([{ contado: "1000.00" }]);
    });

    it("CONCURRENCIA: dos cierres simultáneos (doble clic) dejan un solo arqueo y una sola auditoría", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "1000.00");
      const [a, b] = await Promise.all([cierre(m, sesionId), cierre(m, sesionId)]);
      expect([a.ok, b.ok]).toEqual([true, true]);
      expect([a, b].map((r) => (r.ok ? r.dato.yaEstabaCerrada : null)).sort()).toEqual([
        false,
        true,
      ]);
      expect(await auditorias(m, "SESION_CAJA_CERRADA")).toBe(1);
      expect(
        await contar("select count(*) as n from arqueo_caja where sesion_id = $1", [sesionId]),
      ).toBe(1);
    });

    it("CONCURRENCIA: cerrar contra registrar un movimiento a la vez: o entra el movimiento y cuenta en el arqueo, o se rechaza; nunca un movimiento en una caja ya cerrada", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "1000.00");
      const [c, mov] = await Promise.all([
        cierre(m, sesionId, {
          conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: "100.00" },
        }),
        movimiento(m, sesionId, { importe: "100.00" }, 60),
      ]);
      expect(c.ok).toBe(true);
      const esperado = Number(
        (
          await filas<{ e: string }>(
            "select esperado::text as e from arqueo_caja where sesion_id = $1",
            [sesionId],
          )
        )[0]?.e,
      );
      const entro = await movimientos(m, "INGRESO_MANUAL");
      expect(entro).toBe(mov.ok ? 1 : 0);
      expect(esperado).toBe(mov.ok ? 1100 : 1000);
    });

    it("no se cierra sin contar el efectivo (el «conforme general» no lo cubre), con billetes que no existen, repetidos o de más; y un cierre de otra empresa es el genérico", async () => {
      const m = await mundo();
      const otra = await mundo();
      const sesionId = await abrir(m, "1000.00");
      const ajena = await abrir(otra, "1000.00");
      const malos: Record<string, unknown>[] = [
        { conteo: null },
        { conteo: { billetes: [{ denominacion: 7, cantidad: 1 }], monedas: "" } },
        {
          conteo: {
            billetes: [
              { denominacion: 1000, cantidad: 1 },
              { denominacion: 1000, cantidad: 1 },
            ],
            monedas: "",
          },
        },
        { conteo: { billetes: [{ denominacion: 1000, cantidad: 100000 }], monedas: "" } },
        { conteo: { billetes: [{ denominacion: 1000, cantidad: -1 }], monedas: "" } },
        { conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: "-5" } },
        { conformeGeneral: "si" },
      ];
      for (const extra of malos) expect(codigoDe(await cierre(m, sesionId, extra))).toBe(GENERICO);
      expect(codigoDe(await cierre(m, ajena))).toBe(GENERICO);
      expect(codigoDe(await cierre(otra, sesionId))).toBe(GENERICO);
      expect(await auditorias(m, "SESION_CAJA_CERRADA")).toBe(0);
      expect(await auditorias(otra, "SESION_CAJA_CERRADA")).toBe(0);
    });

    it("una sesión cerrada no se reabre ni admite más movimientos, ajustes ni cierres de cierre", async () => {
      const m = await mundo();
      const sesionId = await abrir(m, "1000.00");
      expect((await cierre(m, sesionId)).ok).toBe(true);
      expect(codigoDe(await cancelarElCierreDeCaja(d, ctx(m, 70), { sesionId }))).toBe(GENERICO);
      expect(codigoDe(await iniciarElCierreDeCaja(d, ctx(m, 70), { sesionId }))).toBe(GENERICO);
      expect(codigoDe(await movimiento(m, sesionId, {}, 71))).toBe(GENERICO);
    });
  });
});
