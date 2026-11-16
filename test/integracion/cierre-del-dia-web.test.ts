import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cancelarElCierre,
  cerrarElDia,
  corregirElMedio,
  darElConforme,
  declararElTotal,
  empezarElCierre,
  type DependenciasDeCierreWeb,
} from "../../src/composicion/cierre-del-dia-web";
import {
  cargarElCierre,
  type CierreParaLaPantalla,
} from "../../src/composicion/lectura-del-cierre";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { ok } from "../../src/primitivas/resultado/resultado";
import { crearMundoDeCobro, type MundoDeCobro } from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  jornadaConCobros,
  ticketsFalsos,
  type CobroDePrueba,
  type JornadaLista,
  type OpcionesDeJornada,
} from "./caja-cierre-del-dia-apoyo";
import { REGLAS_DE_CAJA, armarCaja, crearEntornoDeCaja } from "./caja-configuracion-apoyo";
import { claveNueva } from "./caja-operacion-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * La pantalla «Cierre del día» de la web (`lectura-del-cierre.ts` y `cierre-del-dia-web.ts`, X5) contra una base real y los roles reales, con la caja y el cierre de verdad: qué jornada se opera (la más vieja que no
 * está cerrada), lo que la pantalla recibe en cada estado (con el correo de quién y el número del ticket), cada acción con su código público, que repetir no duplica (la misma clave, el mismo
 * cierre) y que dos a la vez no se pisan (dos cierres, dos conformes, dos declaraciones iguales), que una sucursal ajena sale como el genérico y que lo que cambió mientras se miraba no cierra.
 * Los casos de uso en sí tienen sus pruebas en `cierre-*.test.ts` y `caja-cierre-del-dia-*.test.ts`; ventas e identidad (el número del ticket y el correo) van simulados porque tienen las suyas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = "CIERRE_ACCION_NO_PERMITIDA";
const CORREO = "gerente@prueba.test";

describe.skipIf(base === null)("cierre del día de la web", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  let d: DependenciasDeCierreWeb;
  const tickets = ticketsFalsos();
  const registrados: string[] = [];
  const personas = new Map<string, string>();

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    caja = armarCaja(entorno, REGLAS_DE_CAJA, tickets);
    cierre = armarCierreConCaja(entorno, tickets);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    d = {
      casosDeCierre: () => cierre.casos,
      consultasDeCierre: () => cierre.consultas,
      casosDeCaja: () => caja.casos,
      consultasDeCaja: () => caja.consultas,
      // Ventas: la lista de tickets de la jornada con el número que la pantalla une con «Cobrado contra el ticket».
      consultasDeVentas: () =>
        ({
          listarTickets: () =>
            Promise.resolve(
              ok(
                [...tickets.tickets.values()].map((t, i) => ({
                  ticketId: t.ticketId,
                  numero: 7 + i,
                })),
              ),
            ),
        }) as unknown as ReturnType<DependenciasDeCierreWeb["consultasDeVentas"]>,
      // Identidad: el correo de las personas pedidas que conoce.
      consultasDeIdentidad: () =>
        ({
          personasParaMostrar: (_contexto: unknown, entrada: { ids: readonly string[] }) =>
            Promise.resolve(
              ok(
                new Map(
                  entrada.ids.flatMap((id) => {
                    const correo = personas.get(id);
                    return correo === undefined ? [] : [[id, correo] as const];
                  }),
                ),
              ),
            ),
        }) as unknown as ReturnType<DependenciasDeCierreWeb["consultasDeIdentidad"]>,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query<{ n: string }>(texto, parametros)).rows[0] ?? { n: "0" }).n);
  const mundo = async () => {
    const m = await crearMundoDeCobro(entornoBase, dueno, caja);
    personas.set(m.persona, CORREO);
    return m;
  };
  const listo = (
    m: MundoDeCobro,
    cobros: readonly CobroDePrueba[],
    opciones: OpcionesDeJornada = {},
  ) => jornadaConCobros(entorno, caja, m, cobros, { tickets, ...opciones });
  const entrada = (j: JornadaLista) => ({ fechaDeNegocio: j.fecha });
  const dato = async <T>(promesa: Promise<Respuesta<T>>): Promise<T> => {
    const r = await promesa;
    if (!r.ok) throw new Error(`se esperaba un dato y vino ${r.error.codigo}`);
    return r.dato;
  };
  const codigoDe = (r: Respuesta<unknown>): string => (r.ok ? "OK" : r.error.codigo);
  const cargar = (m: MundoDeCobro, j: JornadaLista, minutos = 50): Promise<CierreParaLaPantalla> =>
    dato(cargarElCierre(d, j.ctx(minutos), m.sucursal));
  const empezar = (m: MundoDeCobro, j: JornadaLista) =>
    empezarElCierre(d, j.ctx(45), m.sucursal, entrada(j));

  it("jornada abierta: muestra la fecha, el estado y los controles, sin conciliación ni cobros; empezar el cierre es idempotente", async () => {
    const m = await mundo();
    const j = await listo(m, [
      { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "18400.00" },
      { medio: "EFECTIVO", importe: "50.00" },
    ]);
    const antes = await cargar(m, j);
    expect(antes).toMatchObject({
      fechaDeNegocio: j.fecha,
      estado: "ABIERTA",
      cerradaPor: null,
      conciliacion: null,
      cobros: null,
      medios: [],
    });
    expect(antes.huella).toMatch(/^[0-9a-f]{64}$/);

    expect(await dato(empezar(m, j))).toEqual({ yaEstabaEnAuditoria: false });
    expect(await dato(empezar(m, j))).toEqual({ yaEstabaEnAuditoria: true });
    expect(
      await contar(
        "select count(*) as n from auditoria_empresa where accion = 'JORNADA_EN_AUDITORIA' and entidad_id like $1",
        [`%${j.fecha}%`],
      ),
    ).toBe(1);
  });

  it("en cierre: lee la conciliación por medio, los cobros con quién los registró, las opciones de «Corregir medio» y el número del ticket", async () => {
    const m = await mundo();
    const j = await listo(m, [
      { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "18400.00" },
      { medio: "EFECTIVO", importe: "50.00", totalDelTicket: "30.00" },
    ]);
    await dato(empezar(m, j));
    const c = await cargar(m, j);
    expect(c.estado).toBe("EN_AUDITORIA");
    expect(c.conciliacion?.enVivo).toBe(true);
    // Cada medio con su estado de conteo: el efectivo, contado por billetes; la tarjeta, declarada al cerrar la caja.
    expect(c.conciliacion?.lineas.map((l) => [l.medioTipo, l.estadoDeConteo])).toEqual(
      expect.arrayContaining([
        ["EFECTIVO", "CONTADO"],
        ["TARJETA_CREDITO", "DECLARADO"],
      ]),
    );
    expect(c.conciliacion?.lineas).toHaveLength(2);
    expect(c.cobros?.hayMas).toBe(false);
    expect(
      c.cobros?.cobros.map((x) => [x.importe, x.medioTipo, x.registradoPor, x.correccionPosible]),
    ).toEqual([
      ["18400.00", "TARJETA_CREDITO", CORREO, true],
      ["50.00", "EFECTIVO", CORREO, true],
    ]);
    // El número del ticket se une con ventas; la diferencia es lo cobrado menos el total del ticket.
    const ticket = tickets.tickets.get(j.origenes[1]?.id ?? "");
    const numero =
      7 + [...tickets.tickets.values()].findIndex((t) => t.ticketId === ticket?.ticketId);
    expect(c.conciliacion?.cobradoContraTicket).toEqual([
      { ticketNumero: numero, diferencia: "20.00" },
    ]);
    // Las opciones del diálogo: medios activos y, de cada uno, las cuentas activas de la sucursal que admite (el efectivo, ninguna).
    const efectivo = c.medios.find((x) => x.tipo === "EFECTIVO");
    const credito = c.medios.find((x) => x.tipo === "TARJETA_CREDITO");
    expect(efectivo?.cuentas).toEqual([]);
    expect(credito?.cuentas.map((x) => x.cuentaDeCobroId)).toEqual([m.cuentas.terminal]);
    expect(
      c.controles.some((x) => x.clave === "caja.cobrado_contra_ticket" && x.cantidad === 1),
    ).toBe(true);
  });

  it("corregir el medio: la misma clave dos veces es UNA corrección y una a la vez también; otro par igual al vigente es el genérico", async () => {
    const m = await mundo();
    const j = await listo(m, [
      { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "18400.00" },
    ]);
    await dato(empezar(m, j));
    const pedido = (clave: string, cambios: Record<string, unknown> = {}) => ({
      claveDeIdempotencia: clave,
      cobroId: j.cobroIds[0],
      medioDestinoId: m.medios.TARJETA_DEBITO,
      cuentaDestinoId: m.cuentas.terminal,
      motivo: "Se cobró con crédito y era débito",
      ...cambios,
    });
    const clave = claveNueva();
    const primera = await dato(corregirElMedio(d, j.ctx(46), pedido(clave)));
    const segunda = await dato(corregirElMedio(d, j.ctx(46), pedido(clave)));
    expect([primera.yaExistia, segunda.yaExistia]).toEqual([false, true]);

    const aLaVez = claveNueva();
    const [a, b] = await Promise.all([
      corregirElMedio(
        d,
        j.ctx(47),
        pedido(aLaVez, { medioDestinoId: m.medios.QR, cuentaDestinoId: m.cuentas.qr }),
      ),
      corregirElMedio(
        d,
        j.ctx(47),
        pedido(aLaVez, { medioDestinoId: m.medios.QR, cuentaDestinoId: m.cuentas.qr }),
      ),
    ]);
    expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
    expect(
      await contar("select count(*) as n from correccion_de_medio where cobro_id = $1", [
        j.cobroIds[0],
      ]),
    ).toBe(2);

    // Otra corrección al MISMO par que ya rige: el genérico.
    expect(
      codigoDe(
        await corregirElMedio(
          d,
          j.ctx(48),
          pedido(claveNueva(), { medioDestinoId: m.medios.QR, cuentaDestinoId: m.cuentas.qr }),
        ),
      ),
    ).toBe(GENERICO);

    const c = await cargar(m, j);
    expect(c.cobros?.cobros[0]).toMatchObject({
      medioTipo: "QR",
      ultimaCorreccion: { por: CORREO, motivo: "Se cobró con crédito y era débito" },
    });
  });

  it("declarar el total y el conforme general: repetir con la misma clave o a la vez deja una sola fila; el importe viaja como texto y el efectivo no se declara", async () => {
    const m = await mundo();
    const j = await listo(
      m,
      [
        { medio: "TARJETA_DEBITO", cuenta: "terminal", importe: "1000.00" },
        { medio: "TRANSFERENCIA", cuenta: "banco", importe: "500.00" },
      ],
      { conforme: true },
    );
    await dato(empezar(m, j));
    const declarar = (clave: string, cambios: Record<string, unknown> = {}) =>
      declararElTotal(d, j.ctx(46), m.sucursal, {
        claveDeIdempotencia: clave,
        fechaDeNegocio: j.fecha,
        medioDePagoId: m.medios.TARJETA_DEBITO,
        cuentaDeCobroId: m.cuentas.terminal,
        importe: "1000.00",
        ...cambios,
      });
    const clave = claveNueva();
    const [uno, dos] = await Promise.all([declarar(clave), declarar(clave)]);
    expect([codigoDe(uno), codigoDe(dos)]).toEqual(["OK", "OK"]);
    expect(
      await contar("select count(*) as n from declaracion_de_total where medio_de_pago_id = $1", [
        m.medios.TARJETA_DEBITO,
      ]),
    ).toBe(1);
    // El efectivo se cuenta por billetes: declararlo es el genérico.
    expect(
      codigoDe(
        await declarar(claveNueva(), { medioDePagoId: m.medios.EFECTIVO, cuentaDeCobroId: null }),
      ),
    ).toBe(GENERICO);
    // Un importe que no es un importe: el genérico, sin escribir nada.
    expect(codigoDe(await declarar(claveNueva(), { importe: "mil pesos" }))).toBe(GENERICO);

    const [c1, c2] = await Promise.all([
      darElConforme(d, j.ctx(47), m.sucursal, {
        claveDeIdempotencia: claveNueva(),
        fechaDeNegocio: j.fecha,
      }),
      darElConforme(d, j.ctx(47), m.sucursal, {
        claveDeIdempotencia: claveNueva(),
        fechaDeNegocio: j.fecha,
      }),
    ]);
    expect([codigoDe(c1), codigoDe(c2)]).toEqual(["OK", "OK"]);
    expect(
      await contar("select count(*) as n from conforme_de_jornada where fecha_negocio = $1", [
        j.fecha,
      ]),
    ).toBe(1);
  });

  it("cerrar el día: sin reconocer lo que hay que reconocer es el genérico; con otra huella, «cambiaron»; bien, cierra UNA vez aunque lleguen dos a la vez, y queda con quién y cuándo", async () => {
    const m = await mundo();
    const j = await listo(
      m,
      [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "18400.00" },
        { medio: "EFECTIVO", importe: "50.00", totalDelTicket: "30.00" },
      ],
      { conforme: true },
    );
    await dato(empezar(m, j));
    const visto = await cargar(m, j);
    const reconocimientos = visto.controles
      .filter((c) => c.severidad === "RECONOCIBLE" && c.cantidad > 0)
      .map((c) => ({
        modulo: c.modulo,
        clave: c.clave,
        texto: c.clave === "caja.cobrado_contra_ticket" ? "Ya se habló con el cliente" : "",
      }));
    expect(reconocimientos.length).toBeGreaterThan(0);
    const cerrar = (cambios: Record<string, unknown> = {}, minutos = 60) =>
      cerrarElDia(d, j.ctx(minutos), m.sucursal, {
        fechaDeNegocio: j.fecha,
        huellaVista: visto.huella,
        reconocimientos,
        ...cambios,
      });

    expect(codigoDe(await cerrar({ reconocimientos: [] }))).toBe(GENERICO);
    expect(codigoDe(await cerrar({ huellaVista: "0".repeat(64) }))).toBe(
      "CIERRE_CONTROLES_CAMBIARON",
    );
    expect(codigoDe(await cerrar({ fechaDeNegocio: "no es una fecha" }))).toBe(GENERICO);
    expect(
      await contar(
        "select count(*) as n from auditoria_empresa where accion = 'JORNADA_CERRADA' and entidad_id like $1",
        [`%${j.fecha}%`],
      ),
    ).toBe(0);

    const [a, b] = await Promise.all([cerrar(), cerrar()]);
    expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
    expect([a, b].filter((r) => r.ok && r.dato.yaEstabaCerrada).length).toBe(1);
    expect(
      await contar(
        "select count(*) as n from auditoria_empresa where accion = 'JORNADA_CERRADA' and entidad_id like $1",
        [`%${j.fecha}%`],
      ),
    ).toBe(1);

    const cerrada = await cargar(m, j, 70);
    expect(cerrada).toMatchObject({ estado: "CERRADA", cerradaPor: CORREO });
    expect(cerrada.cerradaEn).not.toBeNull();
    const reconocido = cerrada.controles.find((c) => c.clave === "caja.cobrado_contra_ticket");
    expect(reconocido).toMatchObject({
      reconocido: true,
      reconocidoPor: CORREO,
      texto: "Ya se habló con el cliente",
    });
    // Cerrada: la conciliación es la foto guardada y ya no se puede corregir ni declarar.
    expect(cerrada.conciliacion?.enVivo).toBe(false);
    expect(cerrada.cobros?.cobros.every((x) => !x.correccionPosible)).toBe(true);
    expect(cerrada.medios).toEqual([]);
    // Repetir el mismo pedido sobre la jornada cerrada es el mismo cierre; otro contenido, el genérico.
    expect((await cerrar({}, 71)).ok).toBe(true);
    expect(codigoDe(await cerrar({ reconocimientos: [] }, 72))).toBe(GENERICO);
  });

  it("cancelar el cierre vuelve a «Abierta» y lo corregido queda; cancelarlo dos veces es lo mismo", async () => {
    const m = await mundo();
    const j = await listo(m, [{ medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" }]);
    await dato(empezar(m, j));
    expect(await dato(cancelarElCierre(d, j.ctx(46), m.sucursal, entrada(j)))).toEqual({
      yaEstabaAbierta: false,
    });
    expect(await dato(cancelarElCierre(d, j.ctx(46), m.sucursal, entrada(j)))).toEqual({
      yaEstabaAbierta: true,
    });
    expect((await cargar(m, j)).estado).toBe("ABIERTA");
  });

  it("opera la jornada más vieja sin cerrar: con ayer abierto no se ve hoy; al cerrar ayer, aparece hoy", async () => {
    const m = await mundo();
    const ayer = await listo(m, [{ medio: "EFECTIVO", importe: "10.00" }], { dias: 1 });
    const hoy = await listo(m, [{ medio: "EFECTIVO", importe: "20.00" }], { dias: 2 });
    // El contexto de HOY (dos días adelante): igual se opera la de ayer, que sigue abierta.
    expect((await dato(cargarElCierre(d, hoy.ctx(50), m.sucursal))).fechaDeNegocio).toBe(
      ayer.fecha,
    );
    await dato(empezar(m, ayer));
    const visto = await cargar(m, ayer);
    expect(
      (
        await cerrarElDia(d, ayer.ctx(60), m.sucursal, {
          fechaDeNegocio: ayer.fecha,
          huellaVista: visto.huella,
          reconocimientos: [],
        })
      ).ok,
    ).toBe(true);
    expect((await dato(cargarElCierre(d, hoy.ctx(50), m.sucursal))).fechaDeNegocio).toBe(hoy.fecha);
  });

  it("aislamiento: la sucursal de otra empresa sale como el genérico, sin pistas, y una acción sin sesión de caja ni jornada tampoco escribe", async () => {
    const m = await mundo();
    const otra = await mundo();
    const j = await listo(m, [{ medio: "EFECTIVO", importe: "10.00" }]);
    const ajena = await cargarElCierre(d, j.ctx(50), otra.sucursal);
    expect(codigoDe(ajena)).toBe(GENERICO);
    expect(codigoDe(await empezarElCierre(d, j.ctx(50), otra.sucursal, entrada(j)))).toBe(GENERICO);
    // Un pedido con otra forma (la sucursal no se lee del pedido; un campo de más se descarta; uno de menos es el genérico).
    expect(codigoDe(await empezarElCierre(d, j.ctx(50), m.sucursal, {}))).toBe(GENERICO);
    expect(
      codigoDe(
        await empezarElCierre(d, j.ctx(50), m.sucursal, {
          fechaDeNegocio: j.fecha,
          sucursalId: otra.sucursal,
        }),
      ),
    ).toBe("OK");
    expect((await cargar(m, j)).estado).toBe("EN_AUDITORIA");
    expect(registrados).toEqual([]);
  });
});
