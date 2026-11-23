import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cancelarElCierre,
  cerrarElDia,
  corregirElMedio,
  darElConforme,
  declararElTotal,
  empezarElCierre,
  type DependenciasDeCierreWeb,
} from "./cierre-del-dia-web";
import { cargarElCierre } from "./lectura-del-cierre";
import type { ContextoOperativo } from "../contexto/contexto";

/**
 * La pantalla «Cierre del día» en la composición, con lo que devuelven los casos de uso y las consultas simulado: qué jornada se opera, qué se lee en cada estado (y qué NO), cómo se
 * arma lo que la pantalla recibe, que cualquier lectura que falla corta todo (nunca un día a medias) y que cada acción manda al caso de uso la sucursal del SERVIDOR y no la del pedido. Con
 * la base y los roles de verdad: `test/integracion/cierre-del-dia-web.test.ts`.
 */

const CONTEXTO = { empresaId: "empresa-1", personaId: "persona-1" } as unknown as ContextoOperativo;
const SUCURSAL = "5e1f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const HOY = "2026-11-09";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const P3 = "00000000-0000-4000-8000-000000000003";
const pesos = (monto: string) => ({ moneda: "ARS", monto });
const GENERICO = "CIERRE_ACCION_NO_PERMITIDA";

type Estado = "SIN_ACTIVIDAD" | "ABIERTA" | "EN_AUDITORIA" | "CERRADA";
type Cambios = Partial<{
  hoy: unknown;
  jornadas: unknown;
  estado: unknown;
  controles: unknown;
  conciliacion: unknown;
  cobros: unknown;
  medios: unknown;
  cuentas: unknown;
  tickets: unknown;
  personas: unknown;
}>;

const estadoDe = (estado: Estado, mas: Record<string, unknown> = {}) =>
  ok({
    estado,
    auditoriaIniciadaEn: null,
    auditoriaIniciadaPor: null,
    cerradaEn: null,
    cerradaPor: null,
    observacion: null,
    ...mas,
  });

function armar(cambios: Cambios = {}) {
  const f = {
    jornadaDeHoy: vi.fn(() =>
      Promise.resolve(cambios.hoy ?? ok({ fechaDeNegocio: HOY, estado: "ABIERTA" })),
    ),
    listarJornadas: vi.fn(() => Promise.resolve(cambios.jornadas ?? ok([]))),
    estadoDeJornada: vi.fn(() => Promise.resolve(cambios.estado ?? estadoDe("ABIERTA"))),
    controlesDeLaJornada: vi.fn(() =>
      Promise.resolve(
        cambios.controles ?? ok({ estado: "ABIERTA", huella: "huella-1", controles: [] }),
      ),
    ),
    conciliacionDeLaJornada: vi.fn(() =>
      Promise.resolve(
        cambios.conciliacion ??
          ok({
            estadoDeLaJornada: "EN_AUDITORIA",
            enVivo: true,
            lineas: [],
            cobradoContraTicket: [],
            ajustesQueCorrigenJornadasCerradas: [],
            ajustesPosteriores: [],
          }),
      ),
    ),
    cobrosDeLaJornada: vi.fn(() =>
      Promise.resolve(cambios.cobros ?? ok({ cobros: [], siguiente: null })),
    ),
    listarMediosDePago: vi.fn(() => Promise.resolve(cambios.medios ?? ok({ medios: [] }))),
    listarCuentasDeCobro: vi.fn(() => Promise.resolve(cambios.cuentas ?? ok({ cuentas: [] }))),
    listarTickets: vi.fn(() => Promise.resolve(cambios.tickets ?? ok([]))),
    personasParaMostrar: vi.fn(() => Promise.resolve(cambios.personas ?? ok(new Map()))),
    iniciarAuditoria: vi.fn(() => Promise.resolve(ok({ yaEstabaEnAuditoria: false }))),
    cancelarAuditoria: vi.fn(() => Promise.resolve(ok({ yaEstabaAbierta: true }))),
    cerrarJornada: vi.fn(() => Promise.resolve(ok({ controles: [], yaEstabaCerrada: false }))),
    corregirMedioDeCobro: vi.fn(() =>
      Promise.resolve(ok({ correccionId: "c", secuencia: 1, yaExistia: true })),
    ),
    declararTotal: vi.fn(() => Promise.resolve(ok({ declaracionId: "d", yaExistia: false }))),
    darConformeGeneral: vi.fn(() => Promise.resolve(ok({ conformeId: "k", yaExistia: true }))),
  };
  const registrados: string[] = [];
  const d = {
    casosDeCierre: () => f,
    consultasDeCierre: () => f,
    casosDeCaja: () => f,
    consultasDeCaja: () => f,
    consultasDeVentas: () => f,
    consultasDeIdentidad: () => f,
    respuesta: {
      registrar: (x: string) => registrados.push(x),
      azar: () => new Uint8Array([9, 9, 9, 9]),
    },
  } as unknown as DependenciasDeCierreWeb;
  return { f, d, registrados };
}

const cargar = (d: DependenciasDeCierreWeb) => cargarElCierre(d, CONTEXTO, SUCURSAL);
const dato = async (r: ReturnType<typeof cargar>) => {
  const x = await r;
  if (!x.ok) throw new Error(`se esperaba un dato y vino ${x.error.codigo}`);
  return x.dato;
};
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : r.error?.codigo;

const jornada = (fechaDeNegocio: string, estado: string) => ({
  fechaDeNegocio,
  estado,
  cerradaEn: null,
  cerradaPor: null,
});

const control = (cambios: Record<string, unknown> = {}) => ({
  modulo: "caja",
  clave: "caja.diferencia_de_arqueo",
  severidad: "RECONOCIBLE",
  cantidad: 1,
  referencias: [],
  ...cambios,
});

const linea = (cambios: Record<string, unknown> = {}) => ({
  medioDePagoId: "m1",
  medioTipo: "TARJETA_DEBITO",
  medioNombre: null,
  cuentaDeCobroId: "c1",
  cuentaNombre: "Posnet 1",
  registrado: pesos("7070.00"),
  correcciones: pesos("0.00"),
  declarado: null,
  estadoDeConteo: "SIN_DATO",
  conformePor: null,
  conformeEn: null,
  diferencia: null,
  explicacion: null,
  ...cambios,
});

const cobro = (cambios: Record<string, unknown> = {}) => ({
  cobroId: "cobro-1",
  sesionId: "s1",
  importe: pesos("18400.00"),
  original: {
    medioDePagoId: "m1",
    medioTipo: "TARJETA_CREDITO",
    medioNombre: null,
    cuentaDeCobroId: "c1",
    cuentaNombre: "Posnet 1",
  },
  vigente: {
    medioDePagoId: "m1",
    medioTipo: "TARJETA_CREDITO",
    medioNombre: null,
    cuentaDeCobroId: "c1",
    cuentaNombre: "Posnet 1",
  },
  origen: { tipo: "ventas.cobranza_de_ticket", id: "o1", orden: 1 },
  registradoEn: "2026-11-09T20:00:00.000Z",
  registradoPor: P1,
  correcciones: [],
  correccionPosible: true,
  ...cambios,
});

const conciliacion = (cambios: Record<string, unknown> = {}) =>
  ok({
    estadoDeLaJornada: "EN_AUDITORIA",
    enVivo: true,
    lineas: [],
    cobradoContraTicket: [],
    ajustesQueCorrigenJornadasCerradas: [],
    ajustesPosteriores: [],
    ...cambios,
  });

describe("qué jornada opera la pantalla", () => {
  it("pide la de hoy y las jornadas de la sucursal desde el piso del calendario hasta hoy, y trabaja con la MÁS VIEJA que no está cerrada", async () => {
    const { f, d } = armar({
      jornadas: ok([
        jornada("2026-11-09", "ABIERTA"),
        jornada("2026-11-08", "EN_AUDITORIA"),
        jornada("2026-11-07", "CERRADA"),
        jornada("2026-11-06", "ABIERTA"),
        jornada("2026-11-05", "CERRADA"),
      ]),
    });
    const c = await dato(cargar(d));
    expect(c.fechaDeNegocio).toBe("2026-11-06");
    expect(f.jornadaDeHoy).toHaveBeenCalledWith(CONTEXTO, { sucursalId: SUCURSAL });
    expect(f.listarJornadas).toHaveBeenCalledWith(CONTEXTO, {
      sucursalId: SUCURSAL,
      desde: "1900-01-01",
      hasta: HOY,
    });
    const entrada = { sucursalId: SUCURSAL, fechaDeNegocio: "2026-11-06" };
    expect(f.estadoDeJornada).toHaveBeenCalledWith(CONTEXTO, entrada);
    expect(f.controlesDeLaJornada).toHaveBeenCalledWith(CONTEXTO, entrada);
  });

  it("no depende del orden en que llegan: la más vieja sin cerrar sale sea cual sea su posición", async () => {
    for (const orden of [
      [jornada("2026-11-05", "ABIERTA"), jornada("2026-11-07", "ABIERTA")],
      [jornada("2026-11-07", "ABIERTA"), jornada("2026-11-05", "ABIERTA")],
      [
        jornada("2026-11-07", "EN_AUDITORIA"),
        jornada("2026-11-05", "EN_AUDITORIA"),
        jornada("2026-11-06", "ABIERTA"),
      ],
    ]) {
      const { d } = armar({ jornadas: ok(orden) });
      expect((await dato(cargar(d))).fechaDeNegocio).toBe("2026-11-05");
    }
  });

  it("si todas están cerradas o no hay ninguna, es la de hoy", async () => {
    for (const jornadas of [
      ok([]),
      ok([jornada("2026-11-08", "CERRADA"), jornada("2026-11-07", "CERRADA")]),
    ]) {
      const { d } = armar({ jornadas });
      expect((await dato(cargar(d))).fechaDeNegocio).toBe(HOY);
    }
  });

  it("si la de hoy o la lista fallan, la pantalla sale con el error ya traducido y no lee nada más", async () => {
    const a = armar({ hoy: err("SIN_PERMISO") });
    expect(codigoDe(await cargar(a.d))).toBe("SIN_PERMISO");
    expect(a.f.listarJornadas).not.toHaveBeenCalled();
    expect(a.f.controlesDeLaJornada).not.toHaveBeenCalled();
    const b = armar({ jornadas: err("SUCURSAL_FUERA_DE_ALCANCE") });
    expect(codigoDe(await cargar(b.d))).toBe(GENERICO);
    expect(b.f.estadoDeJornada).not.toHaveBeenCalled();
  });
});

describe("qué se lee en cada estado de la jornada", () => {
  it.each(["SIN_ACTIVIDAD", "ABIERTA"] as const)(
    "%s: solo el estado y los controles; sin conciliación, cobros, medios ni tickets",
    async (estado) => {
      const { f, d } = armar({
        estado: estadoDe(estado),
        controles: ok({
          estado,
          huella: "h-1",
          controles: [control({ clave: "caja.sesiones_sin_cerrar", severidad: "BLOQUEA" })],
        }),
      });
      const c = await dato(cargar(d));
      expect(c).toMatchObject({
        fechaDeNegocio: HOY,
        estado,
        cerradaPor: null,
        cerradaEn: null,
        huella: "h-1",
        conciliacion: null,
        cobros: null,
        medios: [],
      });
      expect(c.controles).toEqual([
        {
          modulo: "caja",
          clave: "caja.sesiones_sin_cerrar",
          severidad: "BLOQUEA",
          cantidad: 1,
          reconocido: false,
          reconocidoPor: null,
          reconocidoEn: null,
          texto: null,
        },
      ]);
      expect(f.conciliacionDeLaJornada).not.toHaveBeenCalled();
      expect(f.cobrosDeLaJornada).not.toHaveBeenCalled();
      expect(f.listarMediosDePago).not.toHaveBeenCalled();
      expect(f.listarCuentasDeCobro).not.toHaveBeenCalled();
      expect(f.listarTickets).not.toHaveBeenCalled();
    },
  );

  it("EN_AUDITORIA: lee la conciliación y los cobros de la misma jornada; sin ningún cobro corregible no pide medios ni cuentas", async () => {
    const { f, d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({ cobros: [cobro({ correccionPosible: false })], siguiente: null }),
    });
    const c = await dato(cargar(d));
    expect(c.estado).toBe("EN_AUDITORIA");
    expect(c.conciliacion).toEqual({ enVivo: true, lineas: [], cobradoContraTicket: [] });
    expect(c.medios).toEqual([]);
    const entrada = { sucursalId: SUCURSAL, fechaDeNegocio: HOY };
    expect(f.conciliacionDeLaJornada).toHaveBeenCalledWith(CONTEXTO, entrada);
    expect(f.cobrosDeLaJornada).toHaveBeenCalledWith(CONTEXTO, entrada);
    expect(f.listarMediosDePago).not.toHaveBeenCalled();
    expect(f.listarCuentasDeCobro).not.toHaveBeenCalled();
  });

  it("EN_AUDITORIA con un cobro corregible pide los medios activos de la empresa y las cuentas de LA sucursal", async () => {
    const { f, d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({ cobros: [cobro()], siguiente: null }),
    });
    await dato(cargar(d));
    expect(f.listarMediosDePago).toHaveBeenCalledWith(CONTEXTO, {});
    expect(f.listarCuentasDeCobro).toHaveBeenCalledWith(CONTEXTO, { sucursalId: SUCURSAL });
  });

  it("EN_AUDITORIA con UN cobro corregible entre varios que no lo son también pide los medios (alcanza con uno)", async () => {
    const { f, d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({
        cobros: [cobro({ correccionPosible: false }), cobro({ cobroId: "cobro-2" })],
        siguiente: null,
      }),
    });
    await dato(cargar(d));
    expect(f.listarMediosDePago).toHaveBeenCalledTimes(1);
  });

  it("CERRADA: lee el detalle (la foto guardada) pero no ofrece medios aunque un cobro figure como corregible", async () => {
    const { f, d } = armar({
      estado: estadoDe("CERRADA", { cerradaEn: new Date("2026-11-10T01:30:00Z"), cerradaPor: P1 }),
      conciliacion: conciliacion({ enVivo: false }),
      cobros: ok({ cobros: [cobro()], siguiente: null }),
      personas: ok(new Map([[P1, "lucia@ejemplo.com"]])),
    });
    const c = await dato(cargar(d));
    expect(c).toMatchObject({
      estado: "CERRADA",
      cerradaPor: "lucia@ejemplo.com",
      cerradaEn: "2026-11-10T01:30:00.000Z",
      medios: [],
    });
    expect(c.conciliacion?.enVivo).toBe(false);
    expect(f.listarMediosDePago).not.toHaveBeenCalled();
  });

  it("pide los números de ticket solo si hay «Cobrado contra el ticket» y los une por id; un ticket que ventas no devuelve queda sin número", async () => {
    const sin = armar({ estado: estadoDe("EN_AUDITORIA") });
    await dato(cargar(sin.d));
    expect(sin.f.listarTickets).not.toHaveBeenCalled();

    const { f, d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      conciliacion: conciliacion({
        cobradoContraTicket: [
          {
            origen: { tipo: "t", id: "o1" },
            ticketId: "t-7",
            cobrado: pesos("50.00"),
            totalDelTicket: pesos("30.00"),
            diferencia: pesos("20.00"),
            explicacion: null,
          },
          {
            origen: { tipo: "t", id: "o2" },
            ticketId: "t-de-ayer",
            cobrado: pesos("10.00"),
            totalDelTicket: pesos("12.00"),
            diferencia: pesos("-2.00"),
            explicacion: null,
          },
        ],
      }),
      tickets: ok([
        { ticketId: "t-7", numero: 7 },
        { ticketId: "t-8", numero: 8 },
      ]),
    });
    const c = await dato(cargar(d));
    expect(f.listarTickets).toHaveBeenCalledWith(CONTEXTO, {
      sucursalId: SUCURSAL,
      fechaNegocio: HOY,
    });
    expect(c.conciliacion?.cobradoContraTicket).toEqual([
      { ticketNumero: 7, diferencia: "20.00" },
      { ticketNumero: null, diferencia: "-2.00" },
    ]);
  });
});

describe("lo que la pantalla recibe", () => {
  it("los controles con quién y cuándo reconoció (correo y ISO), el texto y lo que no se reconoció", async () => {
    const { d } = armar({
      estado: estadoDe("CERRADA"),
      controles: ok({
        estado: "CERRADA",
        huella: "h",
        controles: [
          control({
            referencias: [],
            reconocido: true,
            reconocidoPor: P2,
            reconocidoEn: new Date("2026-11-10T01:40:00Z"),
            texto: "Se explicó",
          }),
          control({
            clave: "ventas.cortesias",
            modulo: "ventas",
            cantidad: 3,
            reconocido: false,
            reconocidoPor: null,
            reconocidoEn: null,
            texto: null,
          }),
          control({ clave: "caja.cobros_corregidos", severidad: "INFORMA", cantidad: 0 }),
        ],
      }),
      conciliacion: conciliacion({ enVivo: false }),
      personas: ok(new Map([[P2, "tomas@ejemplo.com"]])),
    });
    const c = await dato(cargar(d));
    expect(c.controles).toEqual([
      {
        modulo: "caja",
        clave: "caja.diferencia_de_arqueo",
        severidad: "RECONOCIBLE",
        cantidad: 1,
        reconocido: true,
        reconocidoPor: "tomas@ejemplo.com",
        reconocidoEn: "2026-11-10T01:40:00.000Z",
        texto: "Se explicó",
      },
      {
        modulo: "ventas",
        clave: "ventas.cortesias",
        severidad: "RECONOCIBLE",
        cantidad: 3,
        reconocido: false,
        reconocidoPor: null,
        reconocidoEn: null,
        texto: null,
      },
      {
        modulo: "caja",
        clave: "caja.cobros_corregidos",
        severidad: "INFORMA",
        cantidad: 0,
        reconocido: false,
        reconocidoPor: null,
        reconocidoEn: null,
        texto: null,
      },
    ]);
  });

  it("las líneas de la conciliación con sus importes como texto y los nombres de medio y cuenta", async () => {
    const { d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      conciliacion: conciliacion({
        lineas: [
          linea({
            medioTipo: "EFECTIVO",
            medioNombre: null,
            cuentaDeCobroId: null,
            cuentaNombre: null,
            registrado: pesos("1250.00"),
            declarado: pesos("1300.00"),
            estadoDeConteo: "CONTADO",
            diferencia: pesos("50.00"),
          }),
          linea({
            medioDePagoId: "m2",
            medioNombre: "Visa",
            declarado: pesos("7070.00"),
            correcciones: pesos("-18.40"),
            estadoDeConteo: "DECLARADO",
            diferencia: pesos("0.00"),
          }),
          linea({ medioDePagoId: "m3", estadoDeConteo: "CONFORME", diferencia: null }),
        ],
      }),
    });
    const lineas = (await dato(cargar(d))).conciliacion?.lineas;
    expect(lineas).toEqual([
      {
        medioDePagoId: "m1",
        cuentaDeCobroId: null,
        medioTipo: "EFECTIVO",
        medioNombre: null,
        cuentaNombre: null,
        registrado: "1250.00",
        correcciones: "0.00",
        declarado: "1300.00",
        estadoDeConteo: "CONTADO",
        diferencia: "50.00",
      },
      {
        medioDePagoId: "m2",
        cuentaDeCobroId: "c1",
        medioTipo: "TARJETA_DEBITO",
        medioNombre: "Visa",
        cuentaNombre: "Posnet 1",
        registrado: "7070.00",
        correcciones: "-18.40",
        declarado: "7070.00",
        estadoDeConteo: "DECLARADO",
        diferencia: "0.00",
      },
      {
        medioDePagoId: "m3",
        cuentaDeCobroId: "c1",
        medioTipo: "TARJETA_DEBITO",
        medioNombre: null,
        cuentaNombre: "Posnet 1",
        registrado: "7070.00",
        correcciones: "0.00",
        declarado: null,
        estadoDeConteo: "CONFORME",
        diferencia: null,
      },
    ]);
  });

  it("los cobros con el medio vigente, quién lo registró y la ÚLTIMA corrección con su motivo; «hay más» si el servidor da cursor", async () => {
    const corregido = cobro({
      cobroId: "cobro-2",
      registradoPor: P2,
      vigente: {
        medioDePagoId: "m9",
        medioTipo: "TARJETA_DEBITO",
        medioNombre: "Naranja",
        cuentaDeCobroId: "c9",
        cuentaNombre: "Posnet 2",
      },
      correccionPosible: false,
      correcciones: [
        {
          id: "x1",
          secuencia: 1,
          motivo: "Primero",
          corregidaEn: "2026-11-09T20:10:00.000Z",
          corregidaPor: P1,
          medioDePagoId: "m5",
          medioTipo: "QR",
          medioNombre: null,
          cuentaDeCobroId: null,
          cuentaNombre: null,
        },
        {
          id: "x2",
          secuencia: 2,
          motivo: "Era débito",
          corregidaEn: "2026-11-09T20:20:00.000Z",
          corregidaPor: P3,
          medioDePagoId: "m9",
          medioTipo: "TARJETA_DEBITO",
          medioNombre: "Naranja",
          cuentaDeCobroId: "c9",
          cuentaNombre: "Posnet 2",
        },
      ],
    });
    const { d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({
        cobros: [cobro(), corregido],
        siguiente: { registradoEn: "2026-11-09T21:00:00.000Z", id: "z" },
      }),
      personas: ok(
        new Map([
          [P1, "uno@ej.com"],
          [P2, "dos@ej.com"],
        ]),
      ),
    });
    const c = await dato(cargar(d));
    expect(c.cobros).toEqual({
      hayMas: true,
      cobros: [
        {
          cobroId: "cobro-1",
          importe: "18400.00",
          medioDePagoId: "m1",
          cuentaDeCobroId: "c1",
          medioTipo: "TARJETA_CREDITO",
          medioNombre: null,
          cuentaNombre: "Posnet 1",
          registradoPor: "uno@ej.com",
          correccionPosible: true,
          ultimaCorreccion: null,
        },
        {
          cobroId: "cobro-2",
          importe: "18400.00",
          medioDePagoId: "m9",
          cuentaDeCobroId: "c9",
          medioTipo: "TARJETA_DEBITO",
          medioNombre: "Naranja",
          cuentaNombre: "Posnet 2",
          registradoPor: "dos@ej.com",
          correccionPosible: false,
          ultimaCorreccion: { por: null, en: "2026-11-09T20:20:00.000Z", motivo: "Era débito" },
        },
      ],
    });
  });

  it("sin cursor, no hay más cobros", async () => {
    const { d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({ cobros: [], siguiente: null }),
    });
    expect((await dato(cargar(d))).cobros).toEqual({ cobros: [], hayMas: false });
  });
});

describe("los medios y cuentas que ofrece «Corregir medio»", () => {
  const medio = (cambios: Record<string, unknown> = {}) => ({
    id: "m1",
    tipo: "TARJETA_DEBITO",
    nombre: null,
    activo: true,
    datos: {},
    version: 1,
    ...cambios,
  });
  const cuenta = (cambios: Record<string, unknown> = {}) => ({
    id: "c1",
    tipo: "TERMINAL",
    nombre: "Posnet 1",
    identificadorExterno: null,
    sucursalId: SUCURSAL,
    activa: true,
    version: 1,
    ...cambios,
  });
  const conCobroCorregible = (medios: unknown[], cuentas: unknown[]) =>
    armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({ cobros: [cobro()], siguiente: null }),
      medios: ok({ medios }),
      cuentas: ok({ cuentas }),
    });

  it("cada medio activo con las cuentas activas que admite: el efectivo ninguna; una cuenta de otro tipo, inactiva o de un tipo desconocido no se ofrece", async () => {
    const { d } = conCobroCorregible(
      [
        medio({ id: "ef", tipo: "EFECTIVO" }),
        medio({ id: "de", tipo: "TARJETA_DEBITO", nombre: "Visa débito" }),
        medio({ id: "qr", tipo: "QR" }),
        medio({ id: "baja", tipo: "TRANSFERENCIA", activo: false }),
        medio({ id: "raro", tipo: "CRIPTO" }),
      ],
      [
        cuenta({ id: "t1", tipo: "TERMINAL", nombre: "Posnet 1" }),
        cuenta({ id: "t2", tipo: "TERMINAL", nombre: "Posnet viejo", activa: false }),
        cuenta({ id: "b1", tipo: "CUENTA_BANCARIA", nombre: "Banco" }),
        cuenta({ id: "q1", tipo: "QR", nombre: "QR del local" }),
        cuenta({ id: "x1", tipo: "ALGO_NUEVO", nombre: "Rara" }),
      ],
    );
    const c = await dato(cargar(d));
    expect(c.medios).toEqual([
      { medioDePagoId: "ef", tipo: "EFECTIVO", nombre: null, cuentas: [] },
      {
        medioDePagoId: "de",
        tipo: "TARJETA_DEBITO",
        nombre: "Visa débito",
        cuentas: [{ cuentaDeCobroId: "t1", nombre: "Posnet 1" }],
      },
      {
        medioDePagoId: "qr",
        tipo: "QR",
        nombre: null,
        // Un QR admite las cuentas de tipo QR y las terminales (`CUENTAS_ADMITIDAS`).
        cuentas: [
          { cuentaDeCobroId: "t1", nombre: "Posnet 1" },
          { cuentaDeCobroId: "q1", nombre: "QR del local" },
        ],
      },
    ]);
  });
});

describe("las personas: «quién» es el correo", () => {
  it("pide una sola vez los ids de quien cerró, reconoció, corrigió y registró, sin repetidos y sin nulos", async () => {
    const { f, d } = armar({
      estado: estadoDe("CERRADA", { cerradaPor: P1, cerradaEn: new Date("2026-11-10T01:30:00Z") }),
      controles: ok({
        estado: "CERRADA",
        huella: "h",
        controles: [
          control({ reconocido: true, reconocidoPor: P2, reconocidoEn: new Date() }),
          control({ clave: "ventas.cortesias", reconocido: false, reconocidoPor: null }),
        ],
      }),
      conciliacion: conciliacion({ enVivo: false }),
      cobros: ok({
        cobros: [
          cobro({
            registradoPor: P1,
            correcciones: [
              {
                id: "a",
                secuencia: 1,
                motivo: "m",
                corregidaEn: "2026-11-09T20:00:00.000Z",
                corregidaPor: P3,
                medioDePagoId: "m",
                medioTipo: "QR",
                medioNombre: null,
                cuentaDeCobroId: null,
                cuentaNombre: null,
              },
            ],
          }),
          cobro({ cobroId: "c2", registradoPor: P2 }),
        ],
        siguiente: null,
      }),
    });
    await dato(cargar(d));
    expect(f.personasParaMostrar).toHaveBeenCalledTimes(1);
    expect(f.personasParaMostrar).toHaveBeenCalledWith(CONTEXTO, { ids: [P1, P2, P3] });
  });

  it("sin ninguna persona que mostrar no consulta nada", async () => {
    const { f, d } = armar();
    await dato(cargar(d));
    expect(f.personasParaMostrar).not.toHaveBeenCalled();
  });

  it("pide de a 200 (el tope de la consulta): 401 personas son tres pedidos de 200, 200 y 1; las que no devuelve quedan sin nombre", async () => {
    const ids = Array.from(
      { length: 401 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const llamadas: string[][] = [];
    const { f, d } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({
        cobros: ids.map((id, i) =>
          cobro({ cobroId: `k${i}`, registradoPor: id, correccionPosible: false }),
        ),
        siguiente: null,
      }),
    });
    f.personasParaMostrar.mockImplementation(((_c: unknown, e: { ids: string[] }) => {
      llamadas.push(e.ids);
      return Promise.resolve(
        ok(
          new Map(
            e.ids.filter((id) => id !== ids[250]).map((id) => [id, `correo-de-${id.slice(-3)}`]),
          ),
        ),
      );
    }) as never);
    const c = await dato(cargar(d));
    expect(llamadas.map((l) => l.length)).toEqual([200, 200, 1]);
    expect(llamadas.flat()).toEqual(ids);
    expect(c.cobros?.cobros[0]?.registradoPor).toBe("correo-de-000");
    expect(c.cobros?.cobros[400]?.registradoPor).toBe("correo-de-400");
    expect(c.cobros?.cobros[250]?.registradoPor).toBeNull();
  });

  it("un id que la consulta no conoce no inventa un nombre", async () => {
    const { d } = armar({
      estado: estadoDe("CERRADA", { cerradaPor: P1, cerradaEn: new Date("2026-11-10T01:30:00Z") }),
      conciliacion: conciliacion({ enVivo: false }),
      personas: ok(new Map()),
    });
    expect(await dato(cargar(d))).toMatchObject({ cerradaPor: null });
  });
});

describe("todo o nada: una lectura que falla corta la pantalla entera", () => {
  const rechazos: [string, Cambios, string][] = [
    ["el estado", { estado: err("SIN_PERMISO") }, "SIN_PERMISO"],
    [
      "los controles",
      { controles: err({ codigo: "APORTE_NO_DISPONIBLE", modulo: "caja" }) },
      GENERICO,
    ],
    [
      "la conciliación",
      { estado: estadoDe("EN_AUDITORIA"), conciliacion: err("MODULO_EN_DESARROLLO") },
      "MODULO_EN_DESARROLLO",
    ],
    ["los cobros", { estado: estadoDe("EN_AUDITORIA"), cobros: err("CURSOR_INVALIDO") }, GENERICO],
    [
      "los tickets",
      {
        estado: estadoDe("EN_AUDITORIA"),
        conciliacion: conciliacion({
          cobradoContraTicket: [{ ticketId: "t", diferencia: pesos("1.00") }],
        }),
        tickets: err("SIN_PERMISO"),
      },
      "SIN_PERMISO",
    ],
    [
      "los medios",
      {
        estado: estadoDe("EN_AUDITORIA"),
        cobros: ok({ cobros: [cobro()], siguiente: null }),
        medios: err("SIN_PERMISO"),
      },
      "SIN_PERMISO",
    ],
    [
      "las cuentas",
      {
        estado: estadoDe("EN_AUDITORIA"),
        cobros: ok({ cobros: [cobro()], siguiente: null }),
        cuentas: err("SIN_PERMISO"),
      },
      "SIN_PERMISO",
    ],
    [
      "las personas",
      {
        estado: estadoDe("CERRADA", { cerradaPor: P1, cerradaEn: new Date() }),
        conciliacion: conciliacion(),
        personas: err("ENTRADA_INVALIDA"),
      },
      GENERICO,
    ],
  ];
  it.each(rechazos)(
    "si falla %s, sale el error traducido y ningún dato",
    async (_cual, cambios, esperado) => {
      const { d } = armar(cambios);
      const r = await cargar(d);
      expect(r.ok).toBe(false);
      expect(codigoDe(r)).toBe(esperado);
    },
  );

  it("una excepción sale sin detalle y con referencia, y el detalle va al registro", async () => {
    const { f, d, registrados } = armar();
    f.controlesDeLaJornada.mockRejectedValue(new Error("la base se cayó: host=interno"));
    const r = await cargar(d);
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO", presentacion: "INESPERADO" },
    });
    expect(JSON.stringify(r)).not.toContain("interno");
    expect(registrados).toHaveLength(1);
  });

  it("un importe que no es en pesos es un defecto: sale inesperado, no se muestra otra moneda como pesos", async () => {
    const { d, registrados } = armar({
      estado: estadoDe("EN_AUDITORIA"),
      cobros: ok({
        cobros: [cobro({ importe: { moneda: "USD", monto: "10.00" } })],
        siguiente: null,
      }),
    });
    expect(codigoDe(await cargar(d))).toBe("ERROR_INTERNO");
    expect(registrados[0]).toContain("pesos");
    for (const [campo, valor] of [
      ["registrado", { moneda: "USD", monto: "1.00" }],
      ["correcciones", { moneda: "USD", monto: "1.00" }],
      ["declarado", { moneda: "USD", monto: "1.00" }],
      ["diferencia", { moneda: "USD", monto: "1.00" }],
    ] as const) {
      const otro = armar({
        estado: estadoDe("EN_AUDITORIA"),
        conciliacion: conciliacion({ lineas: [linea({ [campo]: valor })] }),
      });
      expect(codigoDe(await cargar(otro.d)), campo).toBe("ERROR_INTERNO");
    }
    const ticket = armar({
      estado: estadoDe("EN_AUDITORIA"),
      conciliacion: conciliacion({
        cobradoContraTicket: [{ ticketId: "t", diferencia: { moneda: "EUR", monto: "1.00" } }],
      }),
    });
    expect(codigoDe(await cargar(ticket.d))).toBe("ERROR_INTERNO");
  });
});

describe("las acciones: la sucursal es la del servidor, nunca la del pedido", () => {
  const pedido = { fechaDeNegocio: HOY };

  it("empezar el cierre manda la sucursal y la fecha al caso de uso y devuelve solo si ya estaba", async () => {
    const { f, d } = armar();
    const r = await empezarElCierre(d, CONTEXTO, SUCURSAL, { ...pedido, sucursalId: "otra" });
    expect(r).toEqual({ ok: true, dato: { yaEstabaEnAuditoria: false } });
    expect(f.iniciarAuditoria).toHaveBeenCalledWith(CONTEXTO, {
      sucursalId: SUCURSAL,
      fechaDeNegocio: HOY,
    });
  });

  it("cancelar el cierre, igual", async () => {
    const { f, d } = armar();
    const r = await cancelarElCierre(d, CONTEXTO, SUCURSAL, { ...pedido, sucursalId: "otra" });
    expect(r).toEqual({ ok: true, dato: { yaEstabaAbierta: true } });
    expect(f.cancelarAuditoria).toHaveBeenCalledWith(CONTEXTO, {
      sucursalId: SUCURSAL,
      fechaDeNegocio: HOY,
    });
  });

  it("cerrar el día manda la huella y lo reconocido; la observación general es siempre null (no hay campo)", async () => {
    const { f, d } = armar();
    const r = await cerrarElDia(d, CONTEXTO, SUCURSAL, {
      ...pedido,
      huellaVista: "h-1",
      reconocimientos: [{ modulo: "caja", clave: "caja.diferencia_de_arqueo", texto: "  " }],
      observacion: "no va",
    });
    expect(r).toEqual({ ok: true, dato: { yaEstabaCerrada: false } });
    expect(f.cerrarJornada).toHaveBeenCalledWith(CONTEXTO, {
      sucursalId: SUCURSAL,
      fechaDeNegocio: HOY,
      huellaVista: "h-1",
      reconocimientos: [{ modulo: "caja", clave: "caja.diferencia_de_arqueo", texto: null }],
      observacion: null,
    });
  });

  it("corregir el medio manda el pedido tal cual (la sucursal sale del cobro, que el caso de uso valida)", async () => {
    const { f, d } = armar();
    const pedidoDeCorreccion = {
      claveDeIdempotencia: "clave-de-prueba-0001",
      cobroId: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      medioDestinoId: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c",
      cuentaDestinoId: null,
      motivo: "Era débito",
    };
    expect(
      await corregirElMedio(d, CONTEXTO, { ...pedidoDeCorreccion, sucursalId: "otra" }),
    ).toEqual({ ok: true, dato: { yaExistia: true } });
    expect(f.corregirMedioDeCobro).toHaveBeenCalledWith(CONTEXTO, pedidoDeCorreccion);
  });

  it("declarar el total manda la sucursal del servidor y el importe en pesos como texto", async () => {
    const { f, d } = armar();
    const r = await declararElTotal(d, CONTEXTO, SUCURSAL, {
      claveDeIdempotencia: "clave-de-prueba-0001",
      fechaDeNegocio: HOY,
      medioDePagoId: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      cuentaDeCobroId: null,
      importe: "7070.00",
      sucursalId: "otra",
    });
    expect(r).toEqual({ ok: true, dato: { yaExistia: false } });
    expect(f.declararTotal).toHaveBeenCalledWith(CONTEXTO, {
      claveDeIdempotencia: "clave-de-prueba-0001",
      fechaDeNegocio: HOY,
      medioDePagoId: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      cuentaDeCobroId: null,
      importe: { moneda: "ARS", monto: "7070.00" },
      sucursalId: SUCURSAL,
    });
  });

  it("el conforme general manda la sucursal del servidor", async () => {
    const { f, d } = armar();
    const r = await darElConforme(d, CONTEXTO, SUCURSAL, {
      claveDeIdempotencia: "clave-de-prueba-0001",
      fechaDeNegocio: HOY,
      sucursalId: "otra",
    });
    expect(r).toEqual({ ok: true, dato: { yaExistia: true } });
    expect(f.darConformeGeneral).toHaveBeenCalledWith(CONTEXTO, {
      claveDeIdempotencia: "clave-de-prueba-0001",
      fechaDeNegocio: HOY,
      sucursalId: SUCURSAL,
    });
  });

  it("un pedido con otra forma es el genérico y no llega a ningún caso de uso", async () => {
    const { f, d } = armar();
    for (const r of [
      await empezarElCierre(d, CONTEXTO, SUCURSAL, {}),
      await cancelarElCierre(d, CONTEXTO, SUCURSAL, null),
      await cerrarElDia(d, CONTEXTO, SUCURSAL, { fechaDeNegocio: HOY }),
      await corregirElMedio(d, CONTEXTO, {}),
      await declararElTotal(d, CONTEXTO, SUCURSAL, {}),
      await darElConforme(d, CONTEXTO, SUCURSAL, {}),
    ]) {
      expect(codigoDe(r)).toBe(GENERICO);
    }
    for (const caso of [
      f.iniciarAuditoria,
      f.cancelarAuditoria,
      f.cerrarJornada,
      f.corregirMedioDeCobro,
      f.declararTotal,
      f.darConformeGeneral,
    ]) {
      expect(caso).not.toHaveBeenCalled();
    }
  });

  it("los errores de los casos de uso salen traducidos: «cambiaron», el guard, el genérico y una excepción con referencia", async () => {
    const { f, d } = armar();
    f.cerrarJornada.mockResolvedValueOnce(
      err({ codigo: "CONTROLES_CAMBIARON", controles: [] }) as never,
    );
    expect(
      codigoDe(
        await cerrarElDia(d, CONTEXTO, SUCURSAL, {
          fechaDeNegocio: HOY,
          huellaVista: "h",
          reconocimientos: [],
        }),
      ),
    ).toBe("CIERRE_CONTROLES_CAMBIARON");
    f.iniciarAuditoria.mockResolvedValueOnce(
      err({ codigo: "JORNADA_CON_IMPEDIMENTOS", impedimentos: [] }) as never,
    );
    expect(codigoDe(await empezarElCierre(d, CONTEXTO, SUCURSAL, { fechaDeNegocio: HOY }))).toBe(
      GENERICO,
    );
    f.cancelarAuditoria.mockResolvedValueOnce(err("SIN_PERMISO") as never);
    expect(codigoDe(await cancelarElCierre(d, CONTEXTO, SUCURSAL, { fechaDeNegocio: HOY }))).toBe(
      "SIN_PERMISO",
    );
    f.darConformeGeneral.mockRejectedValueOnce(new Error("boom"));
    expect(
      codigoDe(
        await darElConforme(d, CONTEXTO, SUCURSAL, {
          claveDeIdempotencia: "clave-de-prueba-0001",
          fechaDeNegocio: HOY,
        }),
      ),
    ).toBe("ERROR_INTERNO");
  });
});
