import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ticketsPorCobranzaDeLaComposicion } from "../../src/composicion/cierre-de-caja";
import { controlesDelAporte } from "../../src/modulos/cierre/publico";
import {
  REGLAS_DE_CAJA,
  armarCaja,
  crearEntornoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import { crearMundoDeCobro, origenNuevo, type MundoDeCobro } from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  cerrarElDia,
  empezarElCierre,
  jornadaConCobros,
  ticketsFalsos,
  type CobroDePrueba,
  type JornadaLista,
  type OpcionesDeJornada,
} from "./caja-cierre-del-dia-apoyo";
import { claveNueva, pesos } from "./caja-operacion-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * Lo que caja entrega al cierre del día (E3, tramo 8; e3b §4.2, §4.4 a §4.6 y §5): los impedimentos y los seis controles, el cobrado contra
 * el total del ticket (con un `TicketsPorCobranza` falso y con el adaptador de la composición, que falla cerrado), la foto que caja congela
 * al cerrar el día, el ajuste posterior a una jornada cerrada, las consultas del Cierre del día, los permisos de los tres roles, «solo
 * lectura» por baja de plan y el aislamiento entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("cierre del día: el aporte de caja", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  let cierreSinVentas: ReturnType<typeof armarCierreConCaja>;
  let cajaSinVentas: ReturnType<typeof armarCaja>;
  let fallaAlCongelar = false;
  const tickets = ticketsFalsos();

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8, (tx): TxDeCajaDePrueba => ({
      ...tx,
      fotos: {
        ...tx.fotos,
        guardar: async (foto) => {
          await tx.fotos.guardar(foto);
          if (fallaAlCongelar) throw new Error("falla inyectada después de la foto");
        },
      },
    }));
    caja = armarCaja(entorno, REGLAS_DE_CAJA, tickets);
    cierre = armarCierreConCaja(entorno, tickets);
    cajaSinVentas = armarCaja(entorno, REGLAS_DE_CAJA, ticketsPorCobranzaDeLaComposicion);
    cierreSinVentas = armarCierreConCaja(entorno, ticketsPorCobranzaDeLaComposicion);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones = {}) => crearMundoDeCobro(entornoBase, dueno, caja, opciones);
  const listo = (
    m: MundoDeCobro,
    cobros: readonly CobroDePrueba[],
    opciones: OpcionesDeJornada = {},
  ) => jornadaConCobros(entorno, caja, m, cobros, { tickets, ...opciones });
  const auditorias = (m: MundoDeCobro, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const controles = async (j: JornadaLista, minutos = 50) => {
    const r = await cierre.consultas.controlesDeLaJornada(j.ctx(minutos), j.entrada);
    if (!r.ok) throw new Error(`controles: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const control = async (j: JornadaLista, clave: string) => {
    const c = (await controles(j)).controles.find((x) => x.clave === clave);
    if (c === undefined) throw new Error(`falta el control ${clave}`);
    return c;
  };
  const corregir = (
    m: MundoDeCobro,
    j: JornadaLista,
    i: number,
    medio: keyof MundoDeCobro["medios"],
    cuenta: keyof MundoDeCobro["cuentas"] | null = null,
  ) =>
    caja.casos.corregirMedioDeCobro(j.ctx(45), {
      claveDeIdempotencia: claveNueva(),
      cobroId: j.cobroIds[i] as string,
      medioDestinoId: m.medios[medio],
      cuentaDestinoId: cuenta === null ? null : m.cuentas[cuenta],
      motivo: "Era otro medio",
    });
  const concil = async (j: JornadaLista, minutos = 50) => {
    const r = await caja.consultas.conciliacionDeLaJornada(j.ctx(minutos), j.entrada);
    if (!r.ok) throw new Error(`conciliación: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  // =============================================================================================
  describe("impedimentos y controles", () => {
    it("una sesión abierta o en cierre impide empezar el cierre (caja.sesiones_sin_cerrar); con todas cerradas se empieza", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "EFECTIVO", importe: "50.00" }], { sinCerrar: true });
      const intento = () => cierre.casos.iniciarAuditoria(j.ctx(40), j.entrada);
      const impedida = await intento();
      expect(impedida).toMatchObject({ ok: false, error: { codigo: "JORNADA_CON_IMPEDIMENTOS" } });
      expect(JSON.stringify(impedida)).toContain("caja.sesiones_sin_cerrar");
      expect((await caja.casos.iniciarCierre(j.ctx(41), { sesionId: j.sesionId })).ok).toBe(true);
      expect(await intento()).toMatchObject({
        ok: false,
        error: { codigo: "JORNADA_CON_IMPEDIMENTOS" },
      });
      const cerrada = await caja.casos.cerrarSesion(j.ctx(42), {
        sesionId: j.sesionId,
        conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: pesos("50.00") },
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(cerrada.ok).toBe(true);
      expect(await intento()).toEqual({ ok: true, valor: { yaEstabaEnAuditoria: false } });
    });

    it("los seis controles, con la severidad del documento y el contrato de `cierre`; solo las cajas sin cerrar bloquean", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      await empezarElCierre(cierre, j);
      const { controles: lista } = await controles(j);
      expect(lista.map((c) => [c.clave, c.severidad, c.cantidad])).toEqual([
        ["caja.ajustes_a_jornadas_cerradas", "INFORMA", 0],
        ["caja.cobrado_contra_ticket", "RECONOCIBLE", 0],
        ["caja.cobros_corregidos", "INFORMA", 0],
        ["caja.conciliacion_por_medio", "RECONOCIBLE", 0],
        ["caja.diferencia_de_arqueo", "RECONOCIBLE", 0],
        ["caja.sesiones_sin_cerrar", "BLOQUEA", 0],
      ]);
      expect(
        controlesDelAporte(
          "caja",
          lista.map((c) => ({ ...c, huellaDelDetalle: "a".repeat(64) })),
        ).ok,
      ).toBe(true);
    });

    it("son deterministas (la misma huella con los mismos datos) y la huella cambia con una corrección, una declaración y el conforme", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      await empezarElCierre(cierre, j);
      const h0 = (await controles(j)).huella;
      expect((await controles(j, 51)).huella).toBe(h0);
      expect((await controles(j, 52)).huella).toBe(h0);
      expect((await corregir(m, j, 0, "TARJETA_DEBITO", "terminal")).ok).toBe(true);
      const h1 = (await controles(j)).huella;
      expect(h1).not.toBe(h0);
      expect((await controles(j, 53)).huella).toBe(h1);
      expect(await control(j, "caja.cobros_corregidos")).toMatchObject({
        cantidad: 1,
        severidad: "INFORMA",
      });
      // La sesión declaró 100 de crédito; con la corrección el crédito queda 100 por encima y el débito (declarado en 90) 10 por debajo.
      const declarada = await caja.casos.declararTotal(j.ctx(46), {
        claveDeIdempotencia: claveNueva(),
        ...j.entrada,
        medioDePagoId: m.medios.TARJETA_DEBITO,
        cuentaDeCobroId: m.cuentas.terminal,
        importe: pesos("90.00"),
      });
      expect(declarada.ok).toBe(true);
      const h2 = (await controles(j)).huella;
      expect(h2).not.toBe(h1);
      expect(await control(j, "caja.conciliacion_por_medio")).toMatchObject({ cantidad: 2 });
      const conforme = await caja.casos.darConformeGeneral(j.ctx(47), {
        claveDeIdempotencia: claveNueva(),
        ...j.entrada,
      });
      expect(conforme.ok).toBe(true);
      expect((await controles(j)).huella).not.toBe(h2);
    });

    it("diferencia de arqueo: cuenta las sesiones cerradas con una línea de diferencia", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "EFECTIVO", importe: "50.00" }], {
        efectivoContado: "1000.00",
      });
      await empezarElCierre(cierre, j);
      expect(await control(j, "caja.diferencia_de_arqueo")).toMatchObject({
        cantidad: 1,
        referencias: [j.sesionId],
      });
      const sesiones = await caja.consultas.sesionesDeLaJornada(j.ctx(50), j.entrada);
      expect(sesiones).toMatchObject({ ok: true });
      expect(sesiones.ok && sesiones.valor.sesiones.map((s) => s.sesion.id)).toEqual([j.sesionId]);
      const ficha = sesiones.ok ? sesiones.valor.sesiones[0] : undefined;
      expect(ficha?.sesion).toMatchObject({
        abiertaPor: m.persona,
        cerradaPor: m.persona,
        estado: "CERRADA",
      });
      expect(ficha?.arqueo.find((l) => l.diferencia?.monto === "-50.00")).toBeDefined();
      expect(ficha?.billetes).toEqual([{ denominacion: 1000, cantidad: 1 }]);
    });
  });

  // =============================================================================================
  describe("cobrado contra el total del ticket (e3b §4.6)", () => {
    it("un ticket de 10.000 cobrado y corregido a 8.000: diferencia 2.000,00; el que no tiene diferencia no aparece; el anulado (total 0) da todo lo cobrado", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "EFECTIVO", importe: "10000.00", totalDelTicket: "8000.00" },
        { medio: "EFECTIVO", importe: "500.00" },
        { medio: "QR", cuenta: "qr", importe: "70.00", totalDelTicket: "0.00" },
      ]);
      await empezarElCierre(cierre, j);
      const c = await concil(j);
      expect(c.enVivo).toBe(true);
      expect(c.cobradoContraTicket).toHaveLength(2);
      const delPrimero = c.cobradoContraTicket.find((x) => x.origen.id === j.origenes[0]?.id);
      expect(delPrimero).toMatchObject({
        cobrado: { monto: "10000.00" },
        totalDelTicket: { monto: "8000.00" },
        diferencia: { monto: "2000.00" },
      });
      const anulado = c.cobradoContraTicket.find((x) => x.origen.id === j.origenes[2]?.id);
      expect(anulado).toMatchObject({
        cobrado: { monto: "70.00" },
        totalDelTicket: { monto: "0.00" },
        diferencia: { monto: "70.00" },
      });
      expect(c.cobradoContraTicket.some((x) => x.origen.id === j.origenes[1]?.id)).toBe(false);
      expect(await control(j, "caja.cobrado_contra_ticket")).toMatchObject({
        cantidad: 2,
        severidad: "RECONOCIBLE",
      });
      // Una corrección de medio no cambia lo cobrado por origen: la diferencia sigue igual.
      expect((await corregir(m, j, 0, "TARJETA_DEBITO", "terminal")).ok).toBe(true);
      expect(
        (await concil(j)).cobradoContraTicket.find((x) => x.origen.id === j.origenes[0]?.id)
          ?.diferencia.monto,
      ).toBe("2000.00");
      // Caja pregunta solo por los orígenes de ventas, todos juntos.
      expect(tickets.preguntas.at(-1)?.slice().sort()).toEqual(
        [j.origenes[0]?.id, j.origenes[1]?.id, j.origenes[2]?.id].sort(),
      );
    });

    it("un origen que no es de ventas no se compara con ningún ticket y no se le pregunta nada a ventas", async () => {
      const m = await mundo();
      const llamadasAntes = tickets.preguntas.length;
      const j = await listo(m, [
        { medio: "EFECTIVO", importe: "50.00", origen: origenNuevo("otro.tipo") },
      ]);
      await empezarElCierre(cierre, j);
      expect((await concil(j)).cobradoContraTicket).toEqual([]);
      expect(await control(j, "caja.cobrado_contra_ticket")).toMatchObject({ cantidad: 0 });
      expect(tickets.preguntas.length).toBe(llamadasAntes);
    });

    it("si ventas no responde, devuelve algo incompleto o no hay quien lo implemente: APORTE_NO_DISPONIBLE (controles, conciliación y cierre); con cero cobros de ventas no bloquea", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "EFECTIVO", importe: "50.00" }]);
      await empezarElCierre(cierre, j);
      const huellaBuena = (await controles(j)).huella;
      for (const falla of ["LANZA", "DEVUELVE_VACIO"] as const) {
        tickets.modo.falla = falla;
        try {
          expect(await cierre.consultas.controlesDeLaJornada(j.ctx(50), j.entrada), falla).toEqual({
            ok: false,
            error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "caja" },
          });
          expect(await caja.consultas.conciliacionDeLaJornada(j.ctx(50), j.entrada), falla).toEqual(
            {
              ok: false,
              error: "APORTE_NO_DISPONIBLE",
            },
          );
          const cerrar = await cierre.casos.cerrarJornada(j.ctx(60), {
            ...j.entrada,
            huellaVista: huellaBuena,
            reconocimientos: [],
            observacion: null,
          });
          expect(cerrar, falla).toEqual({
            ok: false,
            error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "caja" },
          });
        } finally {
          tickets.modo.falla = "NINGUNA";
        }
      }
      expect(
        await filas("select estado from jornada_de_sucursal where empresa_id = $1", [m.empresa]),
      ).toEqual([{ estado: "EN_AUDITORIA" }]);

      // El adaptador de la composición (sin ventas todavía) falla cerrado SOLO con cobros de ventas en la jornada.
      const sinVentas = await mundo();
      const conCobroDeVentas = await jornadaConCobros(entorno, cajaSinVentas, sinVentas, [
        { medio: "EFECTIVO", importe: "10.00" },
      ]);
      await empezarElCierre(cierreSinVentas, conCobroDeVentas);
      expect(
        await cierreSinVentas.consultas.controlesDeLaJornada(
          conCobroDeVentas.ctx(50),
          conCobroDeVentas.entrada,
        ),
      ).toEqual({
        ok: false,
        error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "caja" },
      });
      const sinCobrosDeVentas = await mundo();
      const otra = await jornadaConCobros(entorno, cajaSinVentas, sinCobrosDeVentas, [
        { medio: "EFECTIVO", importe: "10.00", origen: origenNuevo("otro.tipo") },
      ]);
      await empezarElCierre(cierreSinVentas, otra);
      expect(
        (await cierreSinVentas.consultas.controlesDeLaJornada(otra.ctx(50), otra.entrada)).ok,
      ).toBe(true);
      expect((await cerrarElDia(cierreSinVentas, otra)).ok).toBe(true);
    });
  });

  // =============================================================================================
  describe("al cerrar el día caja congela su foto", () => {
    const preparar = async () => {
      const m = await mundo();
      const j = await listo(
        m,
        [
          {
            medio: "TARJETA_CREDITO",
            cuenta: "terminal",
            importe: "18400.00",
            totalDelTicket: "15000.00",
          },
          { medio: "QR", cuenta: "qr", importe: "300.00" },
          { medio: "EFECTIVO", importe: "50.00" },
        ],
        { conforme: true },
      );
      await empezarElCierre(cierre, j);
      // La terminal de crédito dice 17.000: una línea con diferencia (a explicar) y las demás conformes o contadas.
      const declarada = await caja.casos.declararTotal(j.ctx(46), {
        claveDeIdempotencia: claveNueva(),
        ...j.entrada,
        medioDePagoId: m.medios.TARJETA_CREDITO,
        cuentaDeCobroId: m.cuentas.terminal,
        importe: pesos("17000.00"),
      });
      expect(declarada.ok).toBe(true);
      expect((await corregir(m, j, 1, "TRANSFERENCIA", "banco")).ok).toBe(true);
      return { m, j };
    };

    it("cabecera y una línea por (medio, cuenta) con lo calculado en esa transacción, con quién y cuándo del conforme y la explicación copiada solo a lo que había que explicar", async () => {
      const { m, j } = await preparar();
      const enVivo = await concil(j);
      const cerrada = await cerrarElDia(cierre, j, { texto: "Propina de la terminal" });
      expect(cerrada.ok).toBe(true);

      expect(
        await contar("select count(*) as n from cierre_de_caja_de_jornada where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(1);
      const guardadas = await caja.consultas.conciliacionDeLaJornada(j.ctx(70), j.entrada);
      expect(guardadas).toMatchObject({
        ok: true,
        valor: { enVivo: false, estadoDeLaJornada: "CERRADA" },
      });
      if (!guardadas.ok) return;
      // Lo guardado es lo que se veía (mismos importes y estado) para cada línea.
      const sinExplicacion = (l: (typeof enVivo.lineas)[number]) => ({ ...l, explicacion: null });
      expect(guardadas.valor.lineas.map(sinExplicacion)).toEqual(enVivo.lineas.map(sinExplicacion));
      for (const linea of guardadas.valor.lineas) {
        const porExplicar =
          linea.estadoDeConteo === "SIN_DATO" ||
          (linea.diferencia !== null && linea.diferencia.monto !== "0.00");
        expect(linea.explicacion, `${linea.medioDePagoId}`).toBe(
          porExplicar ? "Propina de la terminal" : null,
        );
      }
      const credito = guardadas.valor.lineas.find(
        (l) => l.medioDePagoId === m.medios.TARJETA_CREDITO,
      );
      expect(credito).toMatchObject({
        estadoDeConteo: "DECLARADO",
        declarado: { monto: "17000.00" },
        diferencia: { monto: "-1400.00" },
      });
      const qr = guardadas.valor.lineas.find((l) => l.medioDePagoId === m.medios.QR);
      expect(qr).toMatchObject({
        estadoDeConteo: "CONFORME",
        conformePor: m.persona,
        diferencia: null,
        correcciones: { monto: "-300.00" },
        explicacion: null,
      });
      expect(qr?.conformeEn).toBe(j.ctx(30).ahora.toISOString());
      // El cobrado contra el ticket: 18.400 contra 15.000, con la misma explicación, inmutable.
      expect(guardadas.valor.cobradoContraTicket).toMatchObject([
        {
          cobrado: { monto: "18400.00" },
          totalDelTicket: { monto: "15000.00" },
          diferencia: { monto: "3400.00" },
          explicacion: "Propina de la terminal",
        },
      ]);
      expect(await auditorias(m, "CIERRE_DE_CAJA_CONGELADO")).toBe(1);

      // Lo congelado no cambia aunque ventas cambie su respuesta después, ni con SQL directo (tampoco para el dueño).
      tickets.tickets.set(j.origenes[0]?.id as string, { ticketId: "otro", total: "18400.00" });
      const despues = await caja.consultas.conciliacionDeLaJornada(j.ctx(80), j.entrada);
      expect(despues).toEqual(guardadas);
      await expect(
        dueno.query("update conciliacion_de_jornada set registrado = 0 where empresa_id = $1", [
          m.empresa,
        ]),
      ).rejects.toThrow();
      await expect(
        dueno.query("delete from conciliacion_de_cobro_por_origen where empresa_id = $1", [
          m.empresa,
        ]),
      ).rejects.toThrow();
      await expect(
        dueno.query("delete from cierre_de_caja_de_jornada where empresa_id = $1", [m.empresa]),
      ).rejects.toThrow();
    });

    it("reconocer sin escribir ninguna explicación cierra y la diferencia queda registrada sin texto; los controles que solo informan nunca frenan", async () => {
      const { m, j } = await preparar();
      expect(await control(j, "caja.cobros_corregidos")).toMatchObject({
        cantidad: 1,
        severidad: "INFORMA",
      });
      const cerrada = await cerrarElDia(cierre, j, { texto: null });
      expect(cerrada.ok).toBe(true);
      const filasGuardadas = await filas<{ explicacion: string | null }>(
        "select explicacion from conciliacion_de_jornada where empresa_id = $1",
        [m.empresa],
      );
      expect(filasGuardadas.length).toBeGreaterThan(0);
      expect(filasGuardadas.every((f) => f.explicacion === null)).toBe(true);
      expect(
        await contar(
          "select count(*) as n from conciliacion_de_cobro_por_origen where empresa_id = $1 and explicacion is null",
          [m.empresa],
        ),
      ).toBe(1);
    });

    it("una falla después de guardar la foto deja la jornada en auditoría y ningún dato congelado: todo o nada", async () => {
      const { m, j } = await preparar();
      fallaAlCongelar = true;
      try {
        await expect(cerrarElDia(cierre, j)).rejects.toThrow("falla inyectada después de la foto");
      } finally {
        fallaAlCongelar = false;
      }
      expect(
        await filas("select estado from jornada_de_sucursal where empresa_id = $1", [m.empresa]),
      ).toEqual([{ estado: "EN_AUDITORIA" }]);
      for (const tabla of [
        "cierre_de_caja_de_jornada",
        "conciliacion_de_jornada",
        "conciliacion_de_cobro_por_origen",
        "control_de_jornada_cerrada",
      ]) {
        expect(
          await contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [m.empresa]),
          tabla,
        ).toBe(0);
      }
      expect(await auditorias(m, "CIERRE_DE_CAJA_CONGELADO")).toBe(0);
      // Y se puede volver a cerrar.
      expect((await cerrarElDia(cierre, j)).ok).toBe(true);
    });
  });

  // =============================================================================================
  describe("un error de una jornada cerrada se corrige con un ajuste de hoy (e3 §3.11.3)", () => {
    it("el ajuste posterior es visible en la jornada de hoy, en la cerrada (ajustesPosteriores) y entre los controles; no altera lo congelado", async () => {
      const m = await mundo();
      const ayer = await listo(m, [{ medio: "EFECTIVO", importe: "50.00" }], { dias: 1 });
      await empezarElCierre(cierre, ayer);
      expect((await cerrarElDia(cierre, ayer)).ok).toBe(true);
      const congelada = await concil(ayer, 70);

      const hoy = await listo(m, [{ medio: "EFECTIVO", importe: "10.00" }], {
        dias: 2,
        sinCerrar: true,
      });
      const ajuste = await caja.casos.registrarAjuste(hoy.ctx(20), {
        claveDeIdempotencia: claveNueva(),
        sesionId: hoy.sesionId,
        medioDePagoId: m.medios.EFECTIVO,
        cuentaDeCobroId: null,
        importe: pesos("-250.00"),
        motivo: "Faltante de ayer",
        corrigeJornada: ayer.fecha,
      });
      expect(ajuste.ok).toBe(true);

      const manuales = await caja.consultas.movimientosManualesDeLaJornada(
        hoy.ctx(25),
        hoy.entrada,
      );
      expect(manuales).toMatchObject({ ok: true, valor: { hayMas: false } });
      expect(
        manuales.ok &&
          manuales.valor.movimientos.map((x) => [
            x.clase,
            x.importe.monto,
            x.motivo,
            x.corrigeJornada,
            x.registradoPor,
          ]),
      ).toEqual([["AJUSTE", "-250.00", "Faltante de ayer", ayer.fecha, m.persona]]);
      const deHoy = await concil(hoy, 26);
      expect(deHoy.ajustesQueCorrigenJornadasCerradas).toMatchObject([
        {
          corrigeJornada: ayer.fecha,
          fechaDeNegocio: hoy.fecha,
          motivo: "Faltante de ayer",
          importe: { monto: "-250.00" },
        },
      ]);
      expect(deHoy.ajustesPosteriores).toEqual([]);

      const deAyer = await concil(ayer, 27);
      expect(deAyer.ajustesPosteriores).toMatchObject([
        { corrigeJornada: ayer.fecha, fechaDeNegocio: hoy.fecha, motivo: "Faltante de ayer" },
      ]);
      // Lo congelado de ayer no cambia.
      expect({ ...deAyer, ajustesPosteriores: [] }).toEqual({
        ...congelada,
        ajustesPosteriores: [],
      });

      // Entre los controles de hoy, al cerrar su caja y empezar su cierre.
      const cerrada = await caja.casos.cerrarSesion(hoy.ctx(30), {
        sesionId: hoy.sesionId,
        conteo: { billetes: [{ denominacion: 500, cantidad: 2 }], monedas: pesos("10.00") },
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(cerrada.ok).toBe(true);
      await empezarElCierre(cierre, hoy);
      expect(await control(hoy, "caja.ajustes_a_jornadas_cerradas")).toMatchObject({
        cantidad: 1,
        severidad: "INFORMA",
      });
    });
  });
});
