import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cajaParaVentas } from "../../src/modulos/caja/publico";
import { importeATexto } from "../../src/primitivas/dinero/importe";
import { REGLAS_DE_CAJA, armarCaja, crearEntornoDeCaja } from "./caja-configuracion-apoyo";
import {
  cobrarComoVentas,
  crearMundoDeCobro,
  entradaDeCobro,
  importe,
  origenNuevo,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  cerrarElDia,
  conteoDe,
  empezarElCierre,
  jornadaConCobros,
  ticketsFalsos,
  type CobroDePrueba,
  type JornadaLista,
  type OpcionesDeJornada,
} from "./caja-cierre-del-dia-apoyo";
import { claveNueva, conAhora, fechaLocal, instanteLocal, pesos } from "./caja-operacion-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * La contribución de caja al cierre del día (E3, tramo 8; e3b §4 y §5, e3 §3.11 y §5.4 #12) con una base real y los roles limitados:
 * corregir el medio de un cobro (cualquier medio a cualquier otro), declarar totales y el «conforme general», los controles que caja entrega
 * a `cierre`, la foto que congela al cerrar el día y las consultas del Cierre del día. La concurrencia está en
 * `caja-cierre-del-dia-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;
const NO_EXISTE = "99999999-9999-4999-8999-999999999999";

describe.skipIf(base === null)("cierre del día: lo que aporta caja", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  const tickets = ticketsFalsos();

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    caja = armarCaja(entorno, REGLAS_DE_CAJA, tickets);
    cierre = armarCierreConCaja(entorno, tickets);
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
  const correcciones = (m: MundoDeCobro) =>
    contar("select count(*) as n from correccion_de_medio where empresa_id = $1", [m.empresa]);

  /** Corrige el cobro `i` de la jornada al medio (y cuenta) dados. */
  const corregir = (
    m: MundoDeCobro,
    j: JornadaLista,
    i: number,
    destino: Readonly<{
      medio: keyof MundoDeCobro["medios"];
      cuenta?: keyof MundoDeCobro["cuentas"] | null;
    }>,
    cambios: Partial<Parameters<typeof caja.casos.corregirMedioDeCobro>[1]> = {},
  ) =>
    caja.casos.corregirMedioDeCobro(j.ctx(45), {
      claveDeIdempotencia: claveNueva(),
      cobroId: j.cobroIds[i] as string,
      medioDestinoId: m.medios[destino.medio],
      cuentaDestinoId:
        destino.cuenta === undefined || destino.cuenta === null ? null : m.cuentas[destino.cuenta],
      motivo: "Era otro medio",
      ...cambios,
    });
  const declarar = (
    m: MundoDeCobro,
    j: JornadaLista,
    medio: keyof MundoDeCobro["medios"],
    cuenta: keyof MundoDeCobro["cuentas"] | null,
    importe: string,
    cambios: Partial<Parameters<typeof caja.casos.declararTotal>[1]> = {},
  ) =>
    caja.casos.declararTotal(j.ctx(46), {
      claveDeIdempotencia: claveNueva(),
      ...j.entrada,
      medioDePagoId: m.medios[medio],
      cuentaDeCobroId: cuenta === null ? null : m.cuentas[cuenta],
      importe: pesos(importe),
      ...cambios,
    });
  const concil = async (j: JornadaLista, minutos = 50) => {
    const r = await caja.consultas.conciliacionDeLaJornada(j.ctx(minutos), j.entrada);
    if (!r.ok) throw new Error(`conciliación: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const lineaDe = async (
    m: MundoDeCobro,
    j: JornadaLista,
    medio: keyof MundoDeCobro["medios"],
    cuenta: keyof MundoDeCobro["cuentas"] | null = null,
  ) => {
    const c = await concil(j);
    const linea = c.lineas.find(
      (l) =>
        l.medioDePagoId === m.medios[medio] &&
        l.cuentaDeCobroId === (cuenta === null ? null : m.cuentas[cuenta]),
    );
    if (linea === undefined) throw new Error(`no hay línea de ${medio}/${String(cuenta)}`);
    return linea;
  };
  const diferenciasEn = async (m: MundoDeCobro, j: JornadaLista) =>
    (await concil(j)).lineas.map((l) => [l.medioDePagoId, l.diferencia?.monto ?? null]);

  // =============================================================================================
  describe("corregirMedioDeCobro", () => {
    it("un cobro de crédito que era débito: las dos diferencias del día quedan en 0, el cobro original no cambia y el ticket sigue cobrado por lo mismo", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "18400.00" },
      ]);
      await empezarElCierre(cierre, j);
      // La terminal de débito dice 18.400 y la de crédito 0: lo que se cargó como crédito era débito.
      expect((await declarar(m, j, "TARJETA_CREDITO", "terminal", "0.00")).ok).toBe(true);
      expect((await declarar(m, j, "TARJETA_DEBITO", "terminal", "18400.00")).ok).toBe(true);
      expect((await lineaDe(m, j, "TARJETA_CREDITO", "terminal")).diferencia?.monto).toBe(
        "-18400.00",
      );
      expect((await lineaDe(m, j, "TARJETA_DEBITO", "terminal")).diferencia?.monto).toBe(
        "18400.00",
      );

      const original = await filas(
        "select medio_de_pago_id, cuenta_de_cobro_id, importe::text as importe from movimiento_caja where id = $1",
        [j.cobroIds[0]],
      );
      const arqueoAntes = await filas(
        "select medio_de_pago_id, esperado::text, contado::text, diferencia::text from arqueo_caja where sesion_id = $1 order by medio_de_pago_id",
        [j.sesionId],
      );

      const hecha = await corregir(m, j, 0, { medio: "TARJETA_DEBITO", cuenta: "terminal" });
      expect(hecha).toMatchObject({ ok: true, valor: { secuencia: 1, yaExistia: false } });
      expect((await lineaDe(m, j, "TARJETA_CREDITO", "terminal")).diferencia?.monto).toBe("0.00");
      expect((await lineaDe(m, j, "TARJETA_DEBITO", "terminal")).diferencia?.monto).toBe("0.00");
      expect((await lineaDe(m, j, "EFECTIVO")).diferencia?.monto).toBe("0.00");
      const credito = await lineaDe(m, j, "TARJETA_CREDITO", "terminal");
      expect([credito.registrado.monto, credito.correcciones.monto]).toEqual([
        "18400.00",
        "-18400.00",
      ]);

      // El cobro original queda como estaba; el arqueo de la sesión no cambia.
      expect(
        await filas(
          "select medio_de_pago_id, cuenta_de_cobro_id, importe::text as importe from movimiento_caja where id = $1",
          [j.cobroIds[0]],
        ),
      ).toEqual(original);
      expect(
        await filas(
          "select medio_de_pago_id, esperado::text, contado::text, diferencia::text from arqueo_caja where sesion_id = $1 order by medio_de_pago_id",
          [j.sesionId],
        ),
      ).toEqual(arqueoAntes);
      // MOVIMIENTO_CON_ORIGEN sigue: la corrección no habilita anular un cobro de un ticket.
      const anulado = await caja.casos.anularMovimientoDeCaja(j.ctx(47), {
        claveDeIdempotencia: claveNueva(),
        movimientoId: j.cobroIds[0] as string,
        motivo: "Porque hay corrección",
      });
      expect(anulado).toMatchObject({ ok: false, error: { codigo: "MOVIMIENTO_CON_ORIGEN" } });
      // `cobrado` no cambia y `medioVigenteTipo` sí.
      const origen = j.origenes[0] as { tipo: string; id: string };
      const cobrado = await entorno.ejecutar(
        { contexto: j.ctx(48), soloLectura: true, aislamiento: "read committed" },
        async (tx) => ({
          ok: true as const,
          valor: await cajaParaVentas.cobrosPorOrigen(tx, j.ctx(48), origen),
        }),
      );
      expect(cobrado.ok && importeATexto(cobrado.valor.cobrado)).toBe("18400.00");
      expect(cobrado.ok && cobrado.valor.cobros[0]).toMatchObject({
        medioTipo: "TARJETA_CREDITO",
        medioVigenteTipo: "TARJETA_DEBITO",
      });
      expect(await auditorias(m, "CORRECCION_DE_MEDIO_REGISTRADA")).toBe(1);
    });

    it("un cobro de débito que era efectivo: el efectivo sobraba y el débito faltaba; la corrección deja los dos en 0, y ida y vuelta (A→B→A) deja la conciliación como al principio", async () => {
      const m = await mundo();
      // Se cargó 5.000 como débito; en el cajón hay 6.000 (1.000 de fondo + 5.000) y la terminal de débito dice 0.
      const j = await listo(
        m,
        [{ medio: "TARJETA_DEBITO", cuenta: "terminal", importe: "5000.00" }],
        {
          efectivoContado: "6000.00",
          noEfectivoContado: "0.00",
        },
      );
      await empezarElCierre(cierre, j);
      const antes = await diferenciasEn(m, j);
      expect(await lineaDe(m, j, "EFECTIVO")).toMatchObject({ diferencia: { monto: "5000.00" } });
      expect(await lineaDe(m, j, "TARJETA_DEBITO", "terminal")).toMatchObject({
        diferencia: { monto: "-5000.00" },
      });

      expect((await corregir(m, j, 0, { medio: "EFECTIVO" })).ok).toBe(true);
      expect(await lineaDe(m, j, "EFECTIVO")).toMatchObject({ diferencia: { monto: "0.00" } });
      expect(await lineaDe(m, j, "TARJETA_DEBITO", "terminal")).toMatchObject({
        diferencia: { monto: "0.00" },
      });

      // Y de vuelta al débito: la conciliación queda como al principio.
      const vuelta = await corregir(m, j, 0, { medio: "TARJETA_DEBITO", cuenta: "terminal" });
      expect(vuelta).toMatchObject({ ok: true, valor: { secuencia: 2 } });
      expect(await diferenciasEn(m, j)).toEqual(antes);
      const efectivo = await lineaDe(m, j, "EFECTIVO");
      expect(efectivo.correcciones.monto).toBe("0.00");
    });

    it("de cualquier medio a cualquier otro: transferencia a QR, con y sin cuenta, y una corrección más es una corrección desde el medio vigente (secuencia + 1)", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "TRANSFERENCIA", cuenta: "banco", importe: "700.00" }]);
      await empezarElCierre(cierre, j);
      expect(await corregir(m, j, 0, { medio: "QR", cuenta: "qr" })).toMatchObject({
        ok: true,
        valor: { secuencia: 1 },
      });
      expect(await corregir(m, j, 0, { medio: "QR" })).toMatchObject({
        ok: true,
        valor: { secuencia: 2 },
      });
      const k = await filas<{
        secuencia: number;
        medio_antes_id: string;
        cuenta_antes_id: string | null;
        medio_despues_id: string;
      }>(
        "select secuencia, medio_antes_id, cuenta_antes_id, medio_despues_id from correccion_de_medio where cobro_id = $1 order by secuencia",
        [j.cobroIds[0]],
      );
      expect(k.map((x) => x.secuencia)).toEqual([1, 2]);
      // «Antes» de la segunda es el destino de la primera (el medio vigente).
      expect([k[1]?.medio_antes_id, k[1]?.cuenta_antes_id]).toEqual([
        k[0]?.medio_despues_id,
        m.cuentas.qr,
      ]);
      expect(await auditorias(m, "CORRECCION_DE_MEDIO_REGISTRADA")).toBe(2);
    });

    it("corregir el medio de un cobro dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      await empezarElCierre(cierre, j);
      const clave = claveNueva();
      const primera = await corregir(
        m,
        j,
        0,
        { medio: "TARJETA_DEBITO", cuenta: "terminal" },
        { claveDeIdempotencia: clave },
      );
      expect(primera).toMatchObject({ ok: true, valor: { yaExistia: false } });
      const filasAntes = await correcciones(m);
      const auditadasAntes = await auditorias(m, "CORRECCION_DE_MEDIO_REGISTRADA");
      const segunda = await corregir(
        m,
        j,
        0,
        { medio: "TARJETA_DEBITO", cuenta: "terminal" },
        { claveDeIdempotencia: clave },
      );
      expect(segunda).toMatchObject({ ok: true, valor: { yaExistia: true, secuencia: 1 } });
      expect(segunda.ok && primera.ok && segunda.valor.correccionId).toBe(
        primera.ok && primera.valor.correccionId,
      );
      expect(await correcciones(m)).toBe(filasAntes);
      expect(await auditorias(m, "CORRECCION_DE_MEDIO_REGISTRADA")).toBe(auditadasAntes);
      // La misma clave con otro destino, otro motivo o el cobro de otro: CLAVE_REUTILIZADA.
      expect(
        await corregir(m, j, 0, { medio: "EFECTIVO" }, { claveDeIdempotencia: clave }),
      ).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(
        await corregir(
          m,
          j,
          0,
          { medio: "TARJETA_DEBITO", cuenta: "terminal" },
          { claveDeIdempotencia: clave, motivo: "Otro motivo" },
        ),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(
        await corregir(
          m,
          j,
          0,
          { medio: "TARJETA_DEBITO", cuenta: null },
          { claveDeIdempotencia: clave },
        ),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      // Un reintento tras cerrar el día devuelve lo hecho (la clave se mira ANTES del estado de la jornada).
      expect((await cerrarElDia(cierre, j)).ok).toBe(true);
      expect(
        await corregir(
          m,
          j,
          0,
          { medio: "TARJETA_DEBITO", cuenta: "terminal" },
          { claveDeIdempotencia: clave },
        ),
      ).toMatchObject({
        ok: true,
        valor: { yaExistia: true },
      });
      expect(await correcciones(m)).toBe(filasAntes);
    });

    it("cada error sale con su código y no escribe ni audita", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
        { medio: "EFECTIVO", importe: "50.00" },
      ]);
      await empezarElCierre(cierre, j);
      // Una cuenta de otra sucursal, una inactiva y un medio desactivado.
      const otra = (
        await filas<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Otra') returning id",
          [m.empresa],
        )
      )[0]?.id as string;
      const cuentaAjena = (
        await filas<{ id: string }>(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Ajena', $2) returning id",
          [m.empresa, otra],
        )
      )[0]?.id as string;
      const cuentaInactiva = (
        await filas<{ id: string }>(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id, activa) values ($1, 'TERMINAL', 'Vieja', $2, false) returning id",
          [m.empresa, m.sucursal],
        )
      )[0]?.id as string;
      const medioInactivo = (
        await filas<{ id: string }>(
          "insert into medio_de_pago (empresa_id, tipo, nombre, activo) values ($1, 'OTRO', 'Cheque', false) returning id",
          [m.empresa],
        )
      )[0]?.id as string;
      const antes = [await correcciones(m), await auditorias(m, "CORRECCION_DE_MEDIO_REGISTRADA")];
      const caso = (
        cambios: Partial<Parameters<typeof caja.casos.corregirMedioDeCobro>[1]>,
        i = 0,
        destino: Parameters<typeof corregir>[3] = { medio: "TARJETA_DEBITO", cuenta: "terminal" },
      ) => corregir(m, j, i, destino, cambios);
      const esperados: [string, Awaited<ReturnType<typeof caso>>, unknown][] = [
        ["cobro que no existe", await caso({ cobroId: NO_EXISTE }), "COBRO_NO_ENCONTRADO"],
        [
          "cobro que no es un UUID",
          await caso({ cobroId: "no-es-un-uuid" }),
          "COBRO_NO_ENCONTRADO",
        ],
        ["motivo vacío", await caso({ motivo: "   " }), "MOTIVO_INVALIDO"],
        [
          "motivo con un carácter no permitido",
          await caso({ motivo: "<script>" }),
          "MOTIVO_INVALIDO",
        ],
        [
          "clave inválida",
          await caso({ claveDeIdempotencia: "corta" }),
          "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
        ],
        ["medio que no existe", await caso({ medioDestinoId: NO_EXISTE }), "MEDIO_NO_ENCONTRADO"],
        ["medio que no es un UUID", await caso({ medioDestinoId: "x" }), "MEDIO_NO_ENCONTRADO"],
        [
          "cuenta que no es un UUID",
          await caso({ cuentaDestinoId: "x" }),
          "CUENTA_DE_COBRO_NO_ENCONTRADA",
        ],
        [
          "cuenta que no existe",
          await caso({ cuentaDestinoId: NO_EXISTE }),
          "CUENTA_DE_COBRO_NO_ENCONTRADA",
        ],
        [
          "medio desactivado",
          await caso({ medioDestinoId: medioInactivo, cuentaDestinoId: null }),
          "MEDIO_INACTIVO",
        ],
        [
          "cuenta de otra sucursal",
          await caso({ cuentaDestinoId: cuentaAjena }),
          "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
        ],
        [
          "cuenta desactivada",
          await caso({ cuentaDestinoId: cuentaInactiva }),
          "CUENTA_DE_COBRO_INACTIVA",
        ],
        [
          "cuenta incompatible con el medio",
          await caso({ cuentaDestinoId: m.cuentas.banco }),
          "CUENTA_DE_COBRO_INCOMPATIBLE",
        ],
        [
          "efectivo con cuenta",
          await caso({ cuentaDestinoId: m.cuentas.terminal }, 1, {
            medio: "EFECTIVO",
            cuenta: "terminal",
          }),
          "CUENTA_DE_COBRO_NO_ADMITIDA",
        ],
        [
          "al mismo medio y cuenta",
          await caso({}, 0, { medio: "TARJETA_CREDITO", cuenta: "terminal" }),
          "MEDIO_DEL_COBRO_SIN_CAMBIOS",
        ],
        [
          "al mismo medio sin cuenta (efectivo)",
          await caso({}, 1, { medio: "EFECTIVO" }),
          "MEDIO_DEL_COBRO_SIN_CAMBIOS",
        ],
      ];
      for (const [nombre, resultado, error] of esperados) {
        expect(resultado, nombre).toEqual({ ok: false, error });
      }
      expect([
        await correcciones(m),
        await auditorias(m, "CORRECCION_DE_MEDIO_REGISTRADA"),
      ]).toEqual(antes);
    });
  });

  // =============================================================================================
  describe("la jornada que no está en auditoría", () => {
    it("corregir, declarar y dar el conforme con la jornada ABIERTA dan JORNADA_NO_EN_AUDITORIA y, cerrada, JORNADA_CERRADA: no escriben ni auditan", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      const intentar = async () => [
        await corregir(m, j, 0, { medio: "TARJETA_DEBITO", cuenta: "terminal" }),
        await declarar(m, j, "TARJETA_CREDITO", "terminal", "100.00"),
        await caja.casos.darConformeGeneral(j.ctx(47), {
          claveDeIdempotencia: claveNueva(),
          ...j.entrada,
        }),
      ];
      const antes = async () => [
        await correcciones(m),
        await contar("select count(*) as n from declaracion_de_total where empresa_id = $1", [
          m.empresa,
        ]),
        await contar("select count(*) as n from conforme_de_jornada where empresa_id = $1", [
          m.empresa,
        ]),
        await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
          m.empresa,
        ]),
      ];
      const foto = await antes();
      for (const r of await intentar())
        expect(r).toEqual({ ok: false, error: "JORNADA_NO_EN_AUDITORIA" });
      expect(await antes()).toEqual(foto);

      await empezarElCierre(cierre, j);
      expect((await cerrarElDia(cierre, j)).ok).toBe(true);
      const cerrada = await antes();
      for (const r of await intentar()) expect(r).toEqual({ ok: false, error: "JORNADA_CERRADA" });
      expect(await antes()).toEqual(cerrada);

      // Tampoco con SQL directo: el disparador de la base lo rechaza también para el dueño.
      await expect(
        dueno.query(
          `insert into correccion_de_medio (empresa_id, cobro_id, secuencia, sucursal_id, fecha_negocio, medio_antes_id, cuenta_antes_id,
                                            medio_despues_id, cuenta_despues_id, motivo, corregido_en, corregido_por, clave_idempotencia, huella)
           values ($1, $2, 1, $3, $4, $5, $6, $7, $6, 'x', now(), $8, $9, $10)`,
          [
            m.empresa,
            j.cobroIds[0],
            m.sucursal,
            j.fecha,
            m.medios.TARJETA_CREDITO,
            m.cuentas.terminal,
            m.medios.TARJETA_DEBITO,
            m.persona,
            claveNueva(),
            "a".repeat(64),
          ],
        ),
      ).rejects.toThrow();
    });

    it("la jornada que no existe: JORNADA_NO_ENCONTRADA al declarar", async () => {
      const m = await mundo();
      await listo(m, [], { dias: 1 });
      const r = await caja.casos.declararTotal(m.ctx(), {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal,
        fechaDeNegocio: "2001-01-01",
        medioDePagoId: m.medios.QR,
        cuentaDeCobroId: null,
        importe: pesos("1.00"),
      });
      expect(r).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
    });
  });

  // =============================================================================================
  describe("declararTotal", () => {
    it("declarar el mismo total dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }]);
      await empezarElCierre(cierre, j);
      const clave = claveNueva();
      const primera = await declarar(m, j, "QR", "qr", "300.00", { claveDeIdempotencia: clave });
      expect(primera).toMatchObject({ ok: true, valor: { yaExistia: false } });
      const declaraciones = () =>
        contar("select count(*) as n from declaracion_de_total where empresa_id = $1", [m.empresa]);
      const auditadas = await auditorias(m, "TOTAL_DECLARADO");
      const segunda = await declarar(m, j, "QR", "qr", "300.00", { claveDeIdempotencia: clave });
      expect(segunda).toMatchObject({ ok: true, valor: { yaExistia: true } });
      expect(await declaraciones()).toBe(1);
      expect(await auditorias(m, "TOTAL_DECLARADO")).toBe(auditadas);
      // «300» y «300.00» son el mismo pedido; otro importe o par con la misma clave es otra cosa.
      expect(await declarar(m, j, "QR", "qr", "300", { claveDeIdempotencia: clave })).toMatchObject(
        { ok: true, valor: { yaExistia: true } },
      );
      expect(await declarar(m, j, "QR", "qr", "301.00", { claveDeIdempotencia: clave })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await declarar(m, j, "QR", null, "300.00", { claveDeIdempotencia: clave })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await declaraciones()).toBe(1);
    });

    it("cada error sale con su código y no escribe: efectivo no se declara, importes inválidos, par inexistente o incompatible, fecha y sucursal", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }]);
      await empezarElCierre(cierre, j);
      const antes = await contar(
        "select count(*) as n from declaracion_de_total where empresa_id = $1",
        [m.empresa],
      );
      const casos: [string, Awaited<ReturnType<typeof declarar>>, unknown][] = [
        ["efectivo", await declarar(m, j, "EFECTIVO", null, "1000.00"), "MEDIO_NO_DECLARABLE"],
        [
          "efectivo con cuenta",
          await declarar(m, j, "EFECTIVO", "qr", "1.00"),
          "CUENTA_DE_COBRO_NO_ADMITIDA",
        ],
        ["importe negativo", await declarar(m, j, "QR", "qr", "-1.00"), "IMPORTE_INVALIDO"],
        ["tres decimales", await declarar(m, j, "QR", "qr", "10.001"), "IMPORTE_INVALIDO"],
        ["notación científica", await declarar(m, j, "QR", "qr", "1e3"), "IMPORTE_INVALIDO"],
        ["sobre el tope", await declarar(m, j, "QR", "qr", "1000000000.00"), "IMPORTE_INVALIDO"],
        [
          "otra moneda",
          await declarar(m, j, "QR", "qr", "1.00", { importe: { moneda: "USD", monto: "1.00" } }),
          "MONEDA_NO_SOPORTADA",
        ],
        [
          "clave inválida",
          await declarar(m, j, "QR", "qr", "1.00", { claveDeIdempotencia: "corta" }),
          "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
        ],
        [
          "medio que no existe",
          await declarar(m, j, "QR", "qr", "1.00", { medioDePagoId: NO_EXISTE }),
          "MEDIO_NO_ENCONTRADO",
        ],
        [
          "medio que no es un UUID",
          await declarar(m, j, "QR", "qr", "1.00", { medioDePagoId: "x" }),
          "MEDIO_NO_ENCONTRADO",
        ],
        [
          "cuenta que no existe",
          await declarar(m, j, "QR", "qr", "1.00", { cuentaDeCobroId: NO_EXISTE }),
          "CUENTA_DE_COBRO_NO_ENCONTRADA",
        ],
        [
          "cuenta incompatible",
          await declarar(m, j, "QR", "banco", "1.00"),
          "CUENTA_DE_COBRO_INCOMPATIBLE",
        ],
        [
          "fecha que no existe",
          await declarar(m, j, "QR", "qr", "1.00", { fechaDeNegocio: "2026-02-30" }),
          "FECHA_INVALIDA",
        ],
        [
          "sucursal que no es un UUID",
          await declarar(m, j, "QR", "qr", "1.00", { sucursalId: "x" }),
          "SUCURSAL_NO_ENCONTRADA",
        ],
      ];
      for (const [nombre, resultado, error] of casos)
        expect(resultado, nombre).toEqual({ ok: false, error });
      expect(
        await contar("select count(*) as n from declaracion_de_total where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(antes);
    });

    it("se puede declarar un medio y una cuenta que se desactivaron después de tener actividad; otra declaración del mismo par es la secuencia + 1 y rige la última", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }]);
      await empezarElCierre(cierre, j);
      await dueno.query("update cuenta_de_cobro set activa = false where id = $1", [m.cuentas.qr]);
      await dueno.query("update medio_de_pago set activo = false where id = $1", [m.medios.QR]);
      expect((await declarar(m, j, "QR", "qr", "100.00")).ok).toBe(true);
      expect((await declarar(m, j, "QR", "qr", "280.00")).ok).toBe(true);
      expect(
        (
          await filas<{ secuencia: number }>(
            "select secuencia from declaracion_de_total where empresa_id = $1 order by secuencia",
            [m.empresa],
          )
        ).map((f) => f.secuencia),
      ).toEqual([1, 2]);
      expect(await lineaDe(m, j, "QR", "qr")).toMatchObject({
        estadoDeConteo: "DECLARADO",
        declarado: { monto: "280.00" },
        diferencia: { monto: "-20.00" },
      });
    });
  });

  // =============================================================================================
  describe("darConformeGeneral y la conciliación (decisión 164)", () => {
    it("dar el conforme general dos veces con la misma clave: el segundo devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }], {
        noEfectivoContado: "250.00",
      });
      await empezarElCierre(cierre, j);
      const clave = claveNueva();
      const dar = (c: string) =>
        caja.casos.darConformeGeneral(j.ctx(47), { claveDeIdempotencia: c, ...j.entrada });
      const primero = await dar(clave);
      expect(primero).toMatchObject({ ok: true, valor: { yaExistia: false } });
      const filasDeConforme = () =>
        contar("select count(*) as n from conforme_de_jornada where empresa_id = $1", [m.empresa]);
      const auditadas = await auditorias(m, "CONFORME_GENERAL_DADO");
      const segundo = await dar(clave);
      expect(segundo).toMatchObject({ ok: true, valor: { yaExistia: true } });
      expect(segundo.ok && primero.ok && segundo.valor.conformeId).toBe(
        primero.ok && primero.valor.conformeId,
      );
      // Otra clave (otra pestaña): ya hay conforme en la jornada, es el mismo.
      const otraClave = await dar(claveNueva());
      expect(otraClave).toMatchObject({ ok: true, valor: { yaExistia: true } });
      expect(await filasDeConforme()).toBe(1);
      expect(await auditorias(m, "CONFORME_GENERAL_DADO")).toBe(auditadas);
      expect(await dar("corta")).toEqual({ ok: false, error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA" });
      expect(
        await caja.casos.darConformeGeneral(j.ctx(47), {
          claveDeIdempotencia: clave,
          sucursalId: m.sucursal,
          fechaDeNegocio: "2026-01-01",
        }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    });

    it("el conforme cubre los medios no efectivo sin declarar, deja quién y cuándo y no muestra diferencia; el efectivo sigue CONTADO; la declaración de un par gana; el conforme sobrevive a cancelar la auditoría", async () => {
      const m = await mundo();
      const j = await listo(
        m,
        [
          { medio: "QR", cuenta: "qr", importe: "300.00" },
          { medio: "TARJETA_DEBITO", cuenta: "terminal", importe: "200.00" },
        ],
        { noEfectivoContado: "1.00" },
      );
      await empezarElCierre(cierre, j);
      // Sin conforme: lo derivado del cierre de caja (declaró 1,00 por cada medio).
      expect(await lineaDe(m, j, "QR", "qr")).toMatchObject({
        estadoDeConteo: "DECLARADO",
        diferencia: { monto: "-299.00" },
      });
      const conforme = await caja.casos.darConformeGeneral(j.ctx(47), {
        claveDeIdempotencia: claveNueva(),
        ...j.entrada,
      });
      expect(conforme.ok).toBe(true);
      expect((await declarar(m, j, "TARJETA_DEBITO", "terminal", "150.00")).ok).toBe(true);

      const qr = await lineaDe(m, j, "QR", "qr");
      expect(qr).toMatchObject({
        estadoDeConteo: "CONFORME",
        declarado: null,
        diferencia: null,
        conformePor: m.persona,
      });
      expect(qr.conformeEn).toBe(j.ctx(47).ahora.toISOString());
      // La declaración explícita de un par gana sobre el conforme.
      expect(await lineaDe(m, j, "TARJETA_DEBITO", "terminal")).toMatchObject({
        estadoDeConteo: "DECLARADO",
        declarado: { monto: "150.00" },
        diferencia: { monto: "-50.00" },
      });
      // El efectivo es siempre CONTADO: no hay conforme para él.
      expect(await lineaDe(m, j, "EFECTIVO")).toMatchObject({ estadoDeConteo: "CONTADO" });
      // Una corrección de medio sobre un par CONFORME no genera diferencia.
      expect((await corregir(m, j, 0, { medio: "TRANSFERENCIA", cuenta: "banco" })).ok).toBe(true);
      expect(await lineaDe(m, j, "QR", "qr")).toMatchObject({
        estadoDeConteo: "CONFORME",
        diferencia: null,
      });
      // Cancelar la auditoría no borra lo dado: el conforme sigue.
      expect((await cierre.casos.cancelarAuditoria(j.ctx(48), j.entrada)).ok).toBe(true);
      expect(
        await contar("select count(*) as n from conforme_de_jornada where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(1);
      await empezarElCierre(cierre, j, 49);
      expect(await lineaDe(m, j, "QR", "qr")).toMatchObject({ estadoDeConteo: "CONFORME" });
    });
    it("dos cajas en la jornada: una contada y la otra conforme sin acto del día es SIN_DATO; todas contadas es DECLARADO con la suma; todas conformes es CONFORME con quién y cuándo del último", async () => {
      const m = await mundo();
      const cajaB = (
        await filas<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja 2') returning id",
          [m.empresa, m.sucursal],
        )
      )[0]?.id as string;
      const dosCajas = async (
        dias: number,
        a: "CONTADA" | "CONFORME",
        b: "CONTADA" | "CONFORME",
      ) => {
        const ctx = (minutos: number) =>
          conAhora(m.ctx(), new Date(instanteLocal(dias, "10:00").getTime() + minutos * 60_000));
        const ids: string[] = [];
        for (const [cajaId, minutos] of [
          [m.cajaId, 0],
          [cajaB, 1],
        ] as const) {
          const abierta = await caja.casos.abrirSesion(ctx(minutos), {
            claveDeIdempotencia: claveNueva(),
            sucursalId: m.sucursal,
            cajaId,
            fondoInicial: pesos("1000.00"),
          });
          if (!abierta.ok) throw new Error(JSON.stringify(abierta.error));
          ids.push(abierta.valor.sesionId);
          const cobro = await cobrarComoVentas(
            entorno,
            ctx(5),
            entradaDeCobro(m, {
              cajaId,
              medioDePagoId: m.medios.QR,
              cuentaDeCobroId: m.cuentas.qr,
              importe: importe(minutos === 0 ? "300.00" : "200.00"),
              origen: origenNuevo("otro.tipo"),
            }),
          );
          if (!cobro.ok) throw new Error(JSON.stringify(cobro.error));
        }
        for (const [i, modo, minutos] of [
          [0, a, 30],
          [1, b, 32],
        ] as const) {
          const cerrada = await caja.casos.cerrarSesion(ctx(minutos), {
            sesionId: ids[i] as string,
            conteo: conteoDe("1000.00"),
            otros:
              modo === "CONTADA"
                ? [
                    {
                      medioDePagoId: m.medios.QR,
                      cuentaDeCobroId: m.cuentas.qr,
                      contado: pesos(i === 0 ? "300.00" : "200.00"),
                    },
                  ]
                : [],
            conformeGeneral: modo === "CONFORME",
            observacion: null,
          });
          if (!cerrada.ok) throw new Error(JSON.stringify(cerrada.error));
        }
        const entrada = {
          sucursalId: m.sucursal,
          fechaDeNegocio: fechaLocal(instanteLocal(dias, "10:00")),
        };
        const iniciada = await cierre.casos.iniciarAuditoria(ctx(40), entrada);
        if (!iniciada.ok) throw new Error(JSON.stringify(iniciada.error));
        const c = await caja.consultas.conciliacionDeLaJornada(ctx(50), entrada);
        if (!c.ok) throw new Error(JSON.stringify(c.error));
        return { linea: c.valor.lineas.find((l) => l.medioDePagoId === m.medios.QR), ctx };
      };
      const mezcla = await dosCajas(1, "CONTADA", "CONFORME");
      expect(mezcla.linea).toMatchObject({
        estadoDeConteo: "SIN_DATO",
        declarado: null,
        diferencia: null,
      });
      const contadas = await dosCajas(2, "CONTADA", "CONTADA");
      expect(contadas.linea).toMatchObject({
        estadoDeConteo: "DECLARADO",
        declarado: { monto: "500.00" },
        diferencia: { monto: "0.00" },
      });
      const conformes = await dosCajas(3, "CONFORME", "CONFORME");
      expect(conformes.linea).toMatchObject({
        estadoDeConteo: "CONFORME",
        diferencia: null,
        conformePor: m.persona,
      });
      expect(conformes.linea?.conformeEn).toBe(conformes.ctx(32).ahora.toISOString());
    });
  });
});
