import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { EmisionFalsa } from "../../../../test/utilidades/emision-falsa";
import {
  EMPRESA,
  GERENTE,
  SOLICITUD_1,
  SOLICITUD_2,
  emisor,
  puntoDeVenta,
  serieBloqueada,
  serieEnCurso,
  serieLibre,
} from "../../../../test/utilidades/fiscal";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { Auditoria, RegistroDeAuditoria } from "../../../puertos/auditoria";
import type { Transacciones } from "../../../puertos/transacciones";
import type { PuntoDeVenta } from "../dominio/punto-de-venta";
import type { Emisor } from "../dominio/emisor";
import type { Serie } from "../dominio/numeracion";
import { crearCasosDeUsoDeNumeracion } from "./casos-de-uso";
import type { ContextoDeSistema, TxDeNumeracion } from "./contrato";

/**
 * Los casos de uso de numeración contra repositorios EN MEMORIA: lo que la base real no deja armar
 * (un emisor inactivo con un punto de venta activo, un `guardar` que pierde la versión) y la tabla
 * de la idempotencia del cierre. El resto está en `test/integracion/fiscal-numeracion*.test.ts`.
 */

const AHORA = new Date("2026-10-12T12:00:00Z");
const VENCE = new Date(AHORA.getTime() + 5 * 60_000);
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: GERENTE,
  marcaDeEntrada: null,
  ahora: AHORA,
};
const sistema = (ahora: Date): ContextoDeSistema => ({ ...contexto, personaId: null, ahora });

const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

type Mundo = {
  series: Map<string, Serie>;
  pv: PuntoDeVenta | null;
  emisor: Emisor;
  auditoria: RegistroDeAuditoria[];
  /** Con `true`, `guardar` pierde la versión (devuelve `null`). */
  perderVersion: boolean;
  guardados: Serie[];
};

const pvActivo = puntoDeVenta({ estado: "ACTIVO" });
const claveDe = (s: Pick<Serie, "puntoDeVentaId" | "tipo">) => `${s.puntoDeVentaId}|${s.tipo}`;

function armar(
  inicial: Partial<Mundo> & { serie?: Serie } = {},
  opciones?: { plazoDeReservaEnMs: number; numeroMaximo: bigint },
) {
  const mundo: Mundo = {
    series: new Map(),
    pv: pvActivo,
    emisor: emisor({ id: pvActivo.emisorId, activo: true }),
    auditoria: [],
    perderVersion: false,
    guardados: [],
    ...inicial,
  };
  if (inicial.serie !== undefined) mundo.series.set(claveDe(inicial.serie), inicial.serie);
  const auditoria: Auditoria = {
    registrar: (r) => {
      mundo.auditoria.push(r);
      return Promise.resolve();
    },
  };
  const tx: TxDeNumeracion = {
    empresas: { obtener: () => Promise.resolve({ tenantId: "t" as never, estado: "ACTIVE" }) },
    tenants: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
    puntosDeVenta: { obtener: () => Promise.resolve(mundo.pv) },
    emisores: { obtener: () => Promise.resolve(mundo.emisor) },
    series: {
      obtener: (_e, pv, tipo) => Promise.resolve(mundo.series.get(`${pv}|${tipo}`) ?? null),
      crear: (s) => {
        const existente = mundo.series.get(claveDe(s));
        if (existente !== undefined) return Promise.resolve({ creado: false, valor: existente });
        mundo.series.set(claveDe(s), s);
        return Promise.resolve({ creado: true, valor: s });
      },
      guardar: (s) => {
        if (mundo.perderVersion) return Promise.resolve(null);
        const nueva = { ...s, version: s.version + 1 };
        mundo.series.set(claveDe(s), nueva);
        mundo.guardados.push(nueva);
        return Promise.resolve(nueva);
      },
      enCursoVencidas: () => Promise.resolve([]),
    },
    auditoria,
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol: "GERENTE",
          modulosActivados: ["facturacion"],
          modulosHabilitados: ["facturacion"],
        }),
    },
  };
  const transacciones: Transacciones<TxDeNumeracion> = {
    ejecutar: (_o, trabajo) => trabajo(tx),
  };
  const emision = new EmisionFalsa();
  const casos = crearCasosDeUsoDeNumeracion({
    transacciones,
    reglas: REGLAS,
    emision,
    ...(opciones === undefined ? {} : { opciones }),
  });
  return { mundo, casos, emision };
}

const entrada = (solicitud = SOLICITUD_1) =>
  ({ puntoDeVentaId: pvActivo.id, tipo: "FACTURA_B", solicitud }) as const;

describe("reservar: lo que decide el caso de uso además del dominio", () => {
  it("un punto de venta inactivo no reserva un número nuevo y no escribe nada", async () => {
    const { mundo, casos } = armar({
      pv: puntoDeVenta({ estado: "INACTIVO" }),
      serie: serieLibre(0n),
    });
    expect(await casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("PUNTO_DE_VENTA_INACTIVO"),
    );
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("un emisor inactivo tampoco reserva", async () => {
    const { mundo, casos } = armar({
      emisor: emisor({ id: pvActivo.emisorId, activo: false }),
      serie: serieLibre(0n),
    });
    expect(await casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("EMISOR_INACTIVO"),
    );
    expect(mundo.guardados).toEqual([]);
  });

  it("con la serie sin crear y el punto de venta inactivo, falla ANTES de preguntarle al servicio", async () => {
    const { casos, emision } = armar({ pv: puntoDeVenta({ estado: "INACTIVO" }) });
    let consultas = 0;
    emision.ultimoAutorizado = () => {
      consultas += 1;
      return Promise.resolve(ok(0n));
    };
    expect(await casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("PUNTO_DE_VENTA_INACTIVO"),
    );
    expect(consultas).toBe(0);
  });

  it("repetir la reserva que ya tiene la solicitud sigue siendo un éxito aunque el punto de venta se haya desactivado", async () => {
    const { mundo, casos } = armar({
      pv: puntoDeVenta({ estado: "INACTIVO" }),
      serie: serieEnCurso(7n, VENCE, SOLICITUD_1),
    });
    const r = await casos.reservarNumeroDeComprobante(contexto, entrada());
    expect(r.ok && r.valor.numero).toBe(8n);
    expect(r.ok && r.valor.yaReservada).toBe(true);
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("un punto de venta que no existe es PUNTO_DE_VENTA_NO_ENCONTRADO", async () => {
    const { casos } = armar({ pv: null });
    expect(await casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
    );
  });

  it("una serie agotada es SERIE_AGOTADA y una bloqueada, SERIE_BLOQUEADA", async () => {
    const agotada = armar(
      { serie: serieLibre(5n) },
      { plazoDeReservaEnMs: 1000, numeroMaximo: 5n },
    );
    expect(await agotada.casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("SERIE_AGOTADA"),
    );
    const bloqueada = armar({ serie: serieBloqueada(5n) });
    expect(await bloqueada.casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("SERIE_BLOQUEADA"),
    );
  });

  it("la reserva dura el plazo configurado y deja el estado anterior y el nuevo en la auditoría", async () => {
    const { mundo, casos } = armar(
      { serie: serieLibre(3n) },
      { plazoDeReservaEnMs: 1000, numeroMaximo: 99n },
    );
    const r = await casos.reservarNumeroDeComprobante(contexto, entrada());
    expect(r.ok && r.valor.numero).toBe(4n);
    expect(mundo.auditoria).toEqual([
      {
        empresaId: EMPRESA,
        actorPersonaId: GERENTE,
        accion: "NUMERO_DE_COMPROBANTE_RESERVADO",
        entidad: "serie_comprobante",
        entidadId: "pv-1:FACTURA_B",
        antes: { estado: "LIBRE", ultimoNumero: "3" },
        despues: {
          estado: "EN_CURSO",
          ultimoNumero: "3",
          numeroEnCurso: "4",
          solicitud: SOLICITUD_1,
          enCursoHasta: new Date(AHORA.getTime() + 1000).toISOString(),
        },
      },
    ]);
  });

  it("si la serie cambió dentro de la transacción (no pasa en SERIALIZABLE) es un defecto, no un éxito", async () => {
    const { casos } = armar({ serie: serieLibre(0n), perderVersion: true });
    await expect(casos.reservarNumeroDeComprobante(contexto, entrada())).rejects.toThrow(
      "la serie cambió dentro de la transacción",
    );
  });

  it("si el emisor del punto de venta no existe es un defecto (la clave foránea lo impide)", async () => {
    const { mundo, casos } = armar({ serie: serieLibre(0n) });
    (mundo as { emisor: Emisor | null }).emisor = null;
    await expect(casos.reservarNumeroDeComprobante(contexto, entrada())).rejects.toThrow(
      "el emisor",
    );
  });
});

describe("cerrar: la repetición del cierre", () => {
  const cerrar = (
    caso: ReturnType<typeof armar>["casos"],
    resultado: Parameters<
      ReturnType<typeof armar>["casos"]["cerrarReservaDeNumero"]
    >[1]["resultado"],
    numero = 8n,
    solicitud = SOLICITUD_1,
  ) => caso.cerrarReservaDeNumero(contexto, { ...entrada(solicitud), numero, resultado });
  const AUTORIZADO = { tipo: "AUTORIZADO", codigo: "CAE-1", vence: "2099-12-31" } as const;
  const RECHAZADO = { tipo: "RECHAZADO", observaciones: ["no"] } as const;

  it("autorizado: avanza el último número y deja la auditoría con el código", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, AUTORIZADO)).toEqual(
      ok({ desenlace: "AUTORIZADO", numero: 8n, yaCerrada: false }),
    );
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "LIBRE", ultimoNumero: 8n });
    expect(mundo.auditoria).toHaveLength(1);
    expect(mundo.auditoria[0]).toMatchObject({
      accion: "NUMERO_DE_COMPROBANTE_AUTORIZADO",
      actorPersonaId: GERENTE,
      entidadId: "pv-1:FACTURA_B",
      antes: { estado: "EN_CURSO", ultimoNumero: "7", numeroEnCurso: "8" },
      despues: {
        estado: "LIBRE",
        ultimoNumero: "8",
        numero: "8",
        solicitud: SOLICITUD_1,
        codigoDeAutorizacion: "CAE-1",
        vence: "2099-12-31",
      },
    });
  });

  it("rechazado: libera sin avanzar y deja las observaciones", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, RECHAZADO)).toEqual(
      ok({ desenlace: "RECHAZADO", numero: 8n, yaCerrada: false }),
    );
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "LIBRE", ultimoNumero: 7n });
    expect(mundo.auditoria[0]).toMatchObject({
      accion: "NUMERO_DE_COMPROBANTE_RECHAZADO",
      despues: { observaciones: ["no"], ultimoNumero: "7" },
    });
  });

  it("incierto: no escribe nada y la serie sigue en curso", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, { tipo: "INCIERTO" })).toEqual(
      ok({ desenlace: "INCIERTO", numero: 8n, yaCerrada: false }),
    );
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
    expect([...mundo.series.values()][0]?.estado).toBe("EN_CURSO");
  });

  it("un número que no es el de la reserva es NUMERO_INVALIDO y no cierra nada", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, AUTORIZADO, 9n)).toEqual(err("NUMERO_INVALIDO"));
    expect(mundo.guardados).toEqual([]);
  });

  it("una serie que no existe es SERIE_NO_ENCONTRADA", async () => {
    const { casos } = armar();
    expect(await cerrar(casos, AUTORIZADO)).toEqual(err("SERIE_NO_ENCONTRADA"));
  });

  it("autorizado otra vez, con el último número ya en el de la reserva: éxito sin escribir (yaCerrada)", async () => {
    const { mundo, casos } = armar({ serie: serieLibre(8n) });
    expect(await cerrar(casos, AUTORIZADO)).toEqual(
      ok({ desenlace: "AUTORIZADO", numero: 8n, yaCerrada: true }),
    );
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("autorizado cuando la serie no llegó a ese número y la reserva es de otra solicitud: SOLICITUD_NO_VIGENTE", async () => {
    const { casos } = armar({ serie: serieEnCurso(7n, VENCE, SOLICITUD_2) });
    expect(await cerrar(casos, AUTORIZADO)).toEqual(err("SOLICITUD_NO_VIGENTE"));
    const libre = armar({ serie: serieLibre(7n) });
    expect(await cerrar(libre.casos, AUTORIZADO)).toEqual(err("SOLICITUD_NO_VIGENTE"));
  });

  it("rechazado o incierto cuando la reserva ya no está: éxito sin escribir, salvo que el último número ya haya pasado por ese", async () => {
    for (const resultado of [RECHAZADO, { tipo: "INCIERTO" } as const]) {
      const sinReserva = armar({ serie: serieLibre(7n) });
      expect(await cerrar(sinReserva.casos, resultado)).toEqual(
        ok({ desenlace: resultado.tipo, numero: 8n, yaCerrada: true }),
      );
      expect(sinReserva.mundo.guardados).toEqual([]);
      const deOtro = armar({ serie: serieEnCurso(7n, VENCE, SOLICITUD_2) });
      expect(await cerrar(deOtro.casos, resultado)).toEqual(
        ok({ desenlace: resultado.tipo, numero: 8n, yaCerrada: true }),
      );
      const contradictoria = armar({ serie: serieLibre(8n) });
      expect(await cerrar(contradictoria.casos, resultado)).toEqual(err("SOLICITUD_NO_VIGENTE"));
    }
  });

  it("la reserva de ESA solicitud con un número ya alcanzado no existe: el cierre se resuelve por la reserva, no por el último número", async () => {
    const { casos } = armar({ serie: serieBloqueada(9n) });
    expect(await cerrar(casos, AUTORIZADO)).toEqual(
      ok({ desenlace: "AUTORIZADO", numero: 8n, yaCerrada: true }),
    );
  });
});

describe("reconciliar: preguntas al servicio y reservas que cambian mientras tanto", () => {
  const T_VENCIDO = new Date(VENCE.getTime() + 1);
  const pedido = { puntoDeVentaId: pvActivo.id, tipo: "FACTURA_B" } as const;

  it("una serie inexistente es SERIE_NO_ENCONTRADA y una libre, NADA_QUE_RECONCILIAR sin preguntar", async () => {
    const sin = armar();
    expect(await sin.casos.reconciliarSerie(sistema(T_VENCIDO), pedido)).toEqual(
      err("SERIE_NO_ENCONTRADA"),
    );
    const libre = armar({ serie: serieLibre(3n) });
    let consultas = 0;
    libre.emision.ultimoAutorizado = () => {
      consultas += 1;
      return Promise.resolve(ok(3n));
    };
    expect(await libre.casos.reconciliarSerie(sistema(T_VENCIDO), pedido)).toEqual(
      ok({ tipo: "NADA_QUE_RECONCILIAR" }),
    );
    expect(consultas).toBe(0);
  });

  it("la reserva que no venció es RESERVA_NO_VENCIDA y no se le pregunta nada al servicio", async () => {
    const { casos, emision } = armar({ serie: serieEnCurso(7n, VENCE) });
    let consultas = 0;
    emision.ultimoAutorizado = () => {
      consultas += 1;
      return Promise.resolve(ok(7n));
    };
    expect(await casos.reconciliarSerie(sistema(AHORA), pedido)).toEqual(err("RESERVA_NO_VENCIDA"));
    expect(consultas).toBe(0);
  });

  it("justo en el vencimiento ya se reconcilia", async () => {
    const { casos, emision } = armar({ serie: serieEnCurso(7n, VENCE) });
    emision.fijarUltimo({ cuit: emisor().cuit, numero: pvActivo.numero }, "FACTURA_B", 7n);
    const r = await casos.reconciliarSerie(sistema(VENCE), pedido);
    expect(r).toEqual(ok({ tipo: "RECONCILIADA", resolucion: "LIBERADA", ultimoAutorizado: 7n }));
  });

  it("si mientras se le preguntaba al servicio otra solicitud tomó la serie, no se toca (era sobre la reserva anterior)", async () => {
    const { mundo, casos, emision } = armar({ serie: serieEnCurso(7n, VENCE, SOLICITUD_1) });
    emision.ultimoAutorizado = () => {
      // La reserva vencida se liberó y otra solicitud reservó el mismo número.
      mundo.series.set(
        claveDe({ puntoDeVentaId: pvActivo.id, tipo: "FACTURA_B" }),
        serieEnCurso(7n, new Date(2e12), SOLICITUD_2),
      );
      return Promise.resolve(ok(7n));
    };
    expect(await casos.reconciliarSerie(sistema(T_VENCIDO), pedido)).toEqual(
      ok({ tipo: "NADA_QUE_RECONCILIAR" }),
    );
    expect(mundo.guardados).toEqual([]);
  });

  it("el servicio caído deja la serie como estaba", async () => {
    const { mundo, casos, emision } = armar({ serie: serieEnCurso(7n, VENCE) });
    emision.servicioCaido = true;
    expect(await casos.reconciliarSerie(sistema(T_VENCIDO), pedido)).toEqual(
      err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" }),
    );
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
  });
});
