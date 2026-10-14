import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { EmisionFalsa } from "../../../../test/utilidades/emision-falsa";
import { fecha } from "../../../../test/utilidades/facturacion";
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
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { ResultadoDeAutorizacionArca } from "../dominio/estados-de-comprobante";
import type { SolicitudId } from "../dominio/identificadores";
import type { PuntoDeVenta } from "../dominio/punto-de-venta";
import type { Emisor } from "../dominio/emisor";
import type { Serie } from "../dominio/numeracion";
import { crearCasosDeUsoDeNumeracion } from "./casos-de-uso";
import type { ContextoDeSistema, TxDeNumeracion } from "./contrato";
import {
  cerrarEnTx,
  cerrarFueraDeSecuenciaEnTx,
  reservarEnTx,
  resincronizarEnTx,
} from "./numeracion-en-tx";

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
  /** El ambiente en que está el punto de venta. */
  ambiente: Ambiente;
  /** Con `true`, `guardar` pierde la versión (devuelve `null`). */
  perderVersion: boolean;
  guardados: Serie[];
};

const pvActivo = puntoDeVenta({ estado: "ACTIVO" });
const claveDe = (s: Pick<Serie, "puntoDeVentaId" | "tipo" | "ambiente">) =>
  `${s.puntoDeVentaId}|${s.tipo}|${s.ambiente}`;

function armar(
  inicial: Partial<Mundo> & { serie?: Serie } = {},
  opciones?: { plazoDeReservaEnMs: number; numeroMaximo: bigint },
) {
  const mundo: Mundo = {
    series: new Map(),
    pv: pvActivo,
    emisor: emisor({ id: pvActivo.emisorId, activo: true }),
    auditoria: [],
    ambiente: "HOMOLOGACION",
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
    puntosDeVenta: {
      obtener: () =>
        Promise.resolve(mundo.pv === null ? null : { ...mundo.pv, ambiente: mundo.ambiente }),
    },
    emisores: { obtener: () => Promise.resolve(mundo.emisor) },
    series: {
      obtener: (_e, pv, tipo, ambiente) =>
        Promise.resolve(mundo.series.get(`${pv}|${tipo}|${ambiente}`) ?? null),
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
      sucursalesDelActor: () => Promise.resolve("TODAS"),
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
  return { mundo, casos, emision, tx };
}

const entrada = (solicitud = SOLICITUD_1) =>
  ({
    puntoDeVentaId: pvActivo.id,
    tipo: "FACTURA_B",
    ambiente: "HOMOLOGACION",
    solicitud,
  }) as const;

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
        entidadId: "pv-1:FACTURA_B:HOMOLOGACION",
        antes: { estado: "LIBRE", ambiente: "HOMOLOGACION", ultimoNumero: "3" },
        despues: {
          estado: "EN_CURSO",
          ambiente: "HOMOLOGACION",
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
  const AUTORIZADO: ResultadoDeAutorizacionArca = {
    tipo: "AUTORIZADO",
    codigo: "CAE-1",
    vence: fecha("2099-12-31"),
    fecha: fecha("2026-10-13"),
    observaciones: [{ codigo: 10237, texto: "una observación" }],
  };
  const RECHAZADO: ResultadoDeAutorizacionArca = {
    tipo: "RECHAZADO",
    errores: [{ codigo: 10016, texto: "fuera de secuencia" }],
    observaciones: [{ codigo: 10237, texto: "otra" }],
  };
  const NO_ENVIADO: ResultadoDeAutorizacionArca = { tipo: "NO_ENVIADO", motivo: "sin conexión" };
  const INCIERTO: ResultadoDeAutorizacionArca = { tipo: "INCIERTO", motivo: "tiempo agotado" };

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
      entidadId: "pv-1:FACTURA_B:HOMOLOGACION",
      antes: {
        estado: "EN_CURSO",
        ambiente: "HOMOLOGACION",
        ultimoNumero: "7",
        numeroEnCurso: "8",
      },
      despues: {
        estado: "LIBRE",
        ambiente: "HOMOLOGACION",
        ultimoNumero: "8",
        numero: "8",
        solicitud: SOLICITUD_1,
        codigoDeAutorizacion: "CAE-1",
        vence: "2099-12-31",
        fecha: "2026-10-13",
        observaciones: [10237],
      },
    });
  });

  it("rechazado: libera sin avanzar y deja los códigos de ARCA (sin los textos)", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, RECHAZADO)).toEqual(
      ok({ desenlace: "RECHAZADO", numero: 8n, yaCerrada: false }),
    );
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "LIBRE", ultimoNumero: 7n });
    expect(mundo.auditoria[0]).toMatchObject({
      accion: "NUMERO_DE_COMPROBANTE_RECHAZADO",
      despues: { errores: [10016], observaciones: [10237], ultimoNumero: "7" },
    });
    expect(JSON.stringify(mundo.auditoria[0])).not.toContain("fuera de secuencia");
  });

  it("no enviado: libera sin avanzar como un rechazo, con su propia auditoría, y el número se reusa", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, NO_ENVIADO)).toEqual(
      ok({ desenlace: "NO_ENVIADO", numero: 8n, yaCerrada: false }),
    );
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "LIBRE", ultimoNumero: 7n });
    expect(mundo.auditoria).toHaveLength(1);
    expect(mundo.auditoria[0]).toMatchObject({
      accion: "NUMERO_DE_COMPROBANTE_LIBERADO",
      despues: { estado: "LIBRE", ultimoNumero: "7", numero: "8", solicitud: SOLICITUD_1 },
    });
    // La misma serie reserva otra vez el mismo número.
    const otra = await casos.reservarNumeroDeComprobante(contexto, entrada(SOLICITUD_2));
    expect(otra.ok && otra.valor.numero).toBe(8n);
  });

  it("incierto: no escribe nada y la serie sigue en curso", async () => {
    const { mundo, casos } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrar(casos, INCIERTO)).toEqual(
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

  it("rechazado, no enviado o incierto cuando la reserva ya no está: éxito sin escribir, salvo que el último número ya haya pasado por ese", async () => {
    for (const resultado of [RECHAZADO, NO_ENVIADO, INCIERTO]) {
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
  const pedido = {
    puntoDeVentaId: pvActivo.id,
    tipo: "FACTURA_B",
    ambiente: "HOMOLOGACION",
  } as const;

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
        claveDe({ puntoDeVentaId: pvActivo.id, tipo: "FACTURA_B", ambiente: "HOMOLOGACION" }),
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

describe("ambiente: la serie es de un punto de venta, un tipo y un ambiente", () => {
  const SERIE_DE_PRODUCCION = { ...serieLibre(20n), ambiente: "PRODUCCION" } as Serie;
  const pvParaArca = () => ({ cuit: emisor().cuit, numero: pvActivo.numero });

  it("un comprobante de otro ambiente que el del punto de venta no toca ninguna serie ni le pregunta nada a ARCA", async () => {
    const { mundo, casos, emision } = armar({ serie: serieLibre(5n), ambiente: "PRODUCCION" });
    let consultas = 0;
    emision.ultimoAutorizado = () => {
      consultas += 1;
      return Promise.resolve(ok(0n));
    };
    expect(await casos.reservarNumeroDeComprobante(contexto, entrada())).toEqual(
      err("AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA"),
    );
    expect(consultas).toBe(0);
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
    expect([...mundo.series.values()]).toEqual([serieLibre(5n)]);
  });

  it("reservar en producción crea y usa SU serie, desde el último de ARCA de producción; la de homologación no se mueve", async () => {
    const { mundo, casos, emision } = armar({ serie: serieLibre(5n), ambiente: "PRODUCCION" });
    emision.fijarUltimo(pvParaArca(), "FACTURA_B", 20n);
    const r = await casos.reservarNumeroDeComprobante(contexto, {
      ...entrada(),
      ambiente: "PRODUCCION",
    });
    expect(r.ok && r.valor.numero).toBe(21n);
    expect(mundo.series.get("pv-1|FACTURA_B|HOMOLOGACION")).toEqual(serieLibre(5n));
    expect(mundo.series.get("pv-1|FACTURA_B|PRODUCCION")).toMatchObject({
      estado: "EN_CURSO",
      ambiente: "PRODUCCION",
      ultimoNumero: 20n,
      numeroEnCurso: 21n,
    });
    expect(mundo.auditoria.map((a) => [a.accion, a.entidadId])).toEqual([
      ["SERIE_DE_COMPROBANTES_CREADA", "pv-1:FACTURA_B:PRODUCCION"],
      ["NUMERO_DE_COMPROBANTE_RESERVADO", "pv-1:FACTURA_B:PRODUCCION"],
    ]);
    expect(mundo.auditoria[1]).toMatchObject({
      antes: { estado: "LIBRE", ambiente: "PRODUCCION", ultimoNumero: "20" },
      despues: { estado: "EN_CURSO", ambiente: "PRODUCCION", numeroEnCurso: "21" },
    });
  });

  it("cada ambiente tiene su reserva: la de homologación en curso no ocupa la de producción", async () => {
    const { mundo, casos } = armar({
      serie: serieEnCurso(5n, VENCE, SOLICITUD_1),
      ambiente: "PRODUCCION",
    });
    mundo.series.set("pv-1|FACTURA_B|PRODUCCION", SERIE_DE_PRODUCCION);
    const r = await casos.reservarNumeroDeComprobante(contexto, {
      ...entrada(SOLICITUD_2),
      ambiente: "PRODUCCION",
    });
    expect(r.ok && r.valor.numero).toBe(21n);
    expect(mundo.series.get("pv-1|FACTURA_B|HOMOLOGACION")).toEqual(
      serieEnCurso(5n, VENCE, SOLICITUD_1),
    );
  });

  it("cerrar en un ambiente no toca la serie del otro", async () => {
    const { mundo, casos } = armar({
      serie: serieEnCurso(5n, VENCE, SOLICITUD_1),
      ambiente: "PRODUCCION",
    });
    mundo.series.set("pv-1|FACTURA_B|PRODUCCION", {
      ...SERIE_DE_PRODUCCION,
      estado: "EN_CURSO",
      ultimoNumero: 20n,
      numeroEnCurso: 21n,
      solicitud: SOLICITUD_1,
      enCursoHasta: VENCE,
    });
    const r = await casos.cerrarReservaDeNumero(contexto, {
      ...entrada(),
      ambiente: "PRODUCCION",
      numero: 21n,
      resultado: {
        tipo: "AUTORIZADO",
        codigo: "CAE-9",
        vence: fecha("2099-12-31"),
        fecha: fecha("2026-10-13"),
        observaciones: [],
      },
    });
    expect(r).toEqual(ok({ desenlace: "AUTORIZADO", numero: 21n, yaCerrada: false }));
    expect(mundo.series.get("pv-1|FACTURA_B|PRODUCCION")).toMatchObject({
      estado: "LIBRE",
      ultimoNumero: 21n,
    });
    expect(mundo.series.get("pv-1|FACTURA_B|HOMOLOGACION")).toEqual(
      serieEnCurso(5n, VENCE, SOLICITUD_1),
    );
  });

  it("repetir un cierre después de que el punto de venta cambió de ambiente sigue mirando la serie que se cerró", async () => {
    // La serie de homologación ya cerró el 8; el punto de venta pasó a producción, que tiene su propia serie.
    const { mundo, casos } = armar({ serie: serieLibre(8n), ambiente: "PRODUCCION" });
    mundo.series.set("pv-1|FACTURA_B|PRODUCCION", SERIE_DE_PRODUCCION);
    const r = await casos.cerrarReservaDeNumero(contexto, {
      ...entrada(),
      numero: 8n,
      resultado: {
        tipo: "AUTORIZADO",
        codigo: "CAE-8",
        vence: fecha("2099-12-31"),
        fecha: fecha("2026-10-13"),
        observaciones: [],
      },
    });
    expect(r).toEqual(ok({ desenlace: "AUTORIZADO", numero: 8n, yaCerrada: true }));
    expect(mundo.guardados).toEqual([]);
  });

  it("reconciliar una serie lo hace en su ambiente y la audita con él", async () => {
    const { mundo, casos, emision } = armar({
      serie: serieEnCurso(7n, VENCE),
      ambiente: "HOMOLOGACION",
    });
    mundo.series.set("pv-1|FACTURA_B|PRODUCCION", {
      ...SERIE_DE_PRODUCCION,
      estado: "EN_CURSO",
      ultimoNumero: 20n,
      numeroEnCurso: 21n,
      solicitud: SOLICITUD_2,
      enCursoHasta: VENCE,
    });
    emision.fijarUltimo(pvParaArca(), "FACTURA_B", 7n);
    const r = await casos.reconciliarSerie(sistema(new Date(VENCE.getTime() + 1)), {
      puntoDeVentaId: pvActivo.id,
      tipo: "FACTURA_B",
      ambiente: "HOMOLOGACION",
    });
    expect(r).toEqual(ok({ tipo: "RECONCILIADA", resolucion: "LIBERADA", ultimoAutorizado: 7n }));
    expect(mundo.auditoria[0]).toMatchObject({ entidadId: "pv-1:FACTURA_B:HOMOLOGACION" });
    expect(mundo.series.get("pv-1|FACTURA_B|PRODUCCION")).toMatchObject({ estado: "EN_CURSO" });
  });
});

describe("numeracion-en-tx: el cuerpo transaccional sin guard", () => {
  it("reservarEnTx corre en contexto de sistema: sin persona en la auditoría y sin tocar la autorización", async () => {
    const { mundo, tx } = armar({ serie: serieLibre(3n) });
    const r = await reservarEnTx(tx, sistema(AHORA), entrada(), null);
    expect(r.ok && r.valor).toMatchObject({
      tipo: "RESERVADO",
      salida: { numero: 4n, yaReservada: false },
    });
    expect(mundo.auditoria).toHaveLength(1);
    expect(mundo.auditoria[0]?.actorPersonaId).toBeNull();
  });

  it("reservarEnTx dice FALTA_LA_SERIE sin escribir si la serie no existe y no sabe el último de ARCA", async () => {
    const { mundo, tx } = armar();
    const r = await reservarEnTx(tx, sistema(AHORA), entrada(), null);
    expect(r.ok && r.valor.tipo).toBe("FALTA_LA_SERIE");
    expect(mundo.series.size).toBe(0);
    expect(mundo.auditoria).toEqual([]);
  });

  it("reservarEnTx usa las opciones que le pasan (el plazo y el tope)", async () => {
    const { tx } = armar({ serie: serieLibre(9n) });
    const agotada = await reservarEnTx(tx, sistema(AHORA), entrada(), null, {
      plazoDeReservaEnMs: 1000,
      numeroMaximo: 9n,
    });
    expect(agotada).toEqual(err("SERIE_AGOTADA"));
    const { tx: tx2, mundo } = armar({ serie: serieLibre(3n) });
    await reservarEnTx(tx2, sistema(AHORA), entrada(), null, {
      plazoDeReservaEnMs: 1000,
      numeroMaximo: 99n,
    });
    expect([...mundo.series.values()][0]).toMatchObject({
      enCursoHasta: new Date(AHORA.getTime() + 1000),
    });
  });

  it("cerrarEnTx corre en contexto de sistema", async () => {
    const { mundo, tx } = armar({ serie: serieEnCurso(7n, VENCE) });
    const r = await cerrarEnTx(tx, sistema(AHORA), {
      ...entrada(),
      numero: 8n,
      resultado: { tipo: "RECHAZADO", errores: [], observaciones: [] },
    });
    expect(r).toEqual(ok({ desenlace: "RECHAZADO", numero: 8n, yaCerrada: false }));
    expect(mundo.auditoria[0]?.actorPersonaId).toBeNull();
  });
});

describe("resincronizarEnTx: la salida de BLOQUEADA", () => {
  const resincronizar = (
    tx: TxDeNumeracion,
    cambios: Partial<{ ultimoVistoEnArca: bigint; ultimoDeArca: bigint }> = {},
  ) =>
    resincronizarEnTx(tx, contexto, {
      puntoDeVentaId: pvActivo.id,
      tipo: "FACTURA_B",
      ambiente: "HOMOLOGACION",
      ultimoVistoEnArca: 12n,
      ultimoDeArca: 12n,
      motivo: "otro sistema usó el punto de venta",
      ...cambios,
    });

  it("vuelve a LIBRE con el último de ARCA y deja la auditoría con el antes, el después y el motivo", async () => {
    const { mundo, tx } = armar({ serie: serieBloqueada(7n, "desfase con ARCA") });
    expect(await resincronizar(tx)).toEqual(ok({ ultimoNumero: 12n }));
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "LIBRE", ultimoNumero: 12n });
    expect(mundo.auditoria).toEqual([
      {
        empresaId: EMPRESA,
        actorPersonaId: GERENTE,
        accion: "SERIE_RESINCRONIZADA",
        entidad: "serie_comprobante",
        entidadId: "pv-1:FACTURA_B:HOMOLOGACION",
        antes: {
          estado: "BLOQUEADA",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "7",
          motivoBloqueo: "desfase con ARCA",
        },
        despues: {
          estado: "LIBRE",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "12",
          ultimoVistoEnArca: "12",
          motivo: "otro sistema usó el punto de venta",
        },
      },
    ]);
  });

  it("después se reserva desde el número de ARCA, sin repetir ni saltear", async () => {
    const { casos, tx } = armar({ serie: serieBloqueada(7n) });
    await resincronizar(tx);
    const r = await casos.reservarNumeroDeComprobante(contexto, entrada());
    expect(r.ok && r.valor.numero).toBe(13n);
  });

  it("repetirla encuentra la serie ya libre: SERIE_NO_BLOQUEADA, sin escribir ni auditar de nuevo", async () => {
    const { mundo, tx } = armar({ serie: serieBloqueada(7n) });
    await resincronizar(tx);
    const guardados = mundo.guardados.length;
    expect(await resincronizar(tx)).toEqual(err("SERIE_NO_BLOQUEADA"));
    expect(mundo.guardados).toHaveLength(guardados);
    expect(mundo.auditoria).toHaveLength(1);
  });

  it("una serie que no está bloqueada no se resincroniza", async () => {
    for (const serie of [serieLibre(7n), serieEnCurso(7n, VENCE)]) {
      const { mundo, tx } = armar({ serie });
      expect(await resincronizar(tx)).toEqual(err("SERIE_NO_BLOQUEADA"));
      expect(mundo.guardados).toEqual([]);
      expect(mundo.auditoria).toEqual([]);
    }
  });

  it("una serie que no existe es SERIE_NO_ENCONTRADA", async () => {
    const { tx } = armar();
    expect(await resincronizar(tx)).toEqual(err("SERIE_NO_ENCONTRADA"));
  });

  it("si ARCA cambió mientras la persona miraba, o informa menos de lo que la serie usó, no escribe nada", async () => {
    const { mundo, tx } = armar({ serie: serieBloqueada(7n) });
    expect(await resincronizar(tx, { ultimoVistoEnArca: 11n })).toEqual(
      err("ULTIMO_DISTINTO_DEL_DE_ARCA"),
    );
    expect(await resincronizar(tx, { ultimoVistoEnArca: 6n, ultimoDeArca: 6n })).toEqual(
      err("DESFASE_HACIA_ATRAS"),
    );
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("si la serie cambió dentro de la transacción (no pasa en SERIALIZABLE) es un defecto, no un éxito", async () => {
    const { tx } = armar({ serie: serieBloqueada(7n), perderVersion: true });
    await expect(resincronizar(tx)).rejects.toThrow("la serie cambió dentro de la transacción");
  });
});

describe("cerrarFueraDeSecuenciaEnTx: el rechazo 10016 con lo que informa ARCA", () => {
  const FUERA_DE_SECUENCIA: ResultadoDeAutorizacionArca = {
    tipo: "RECHAZADO",
    errores: [{ codigo: 10016, texto: "fuera de secuencia, con un dato personal" }],
    observaciones: [{ codigo: 10237, texto: "otra" }],
  };
  const cerrarFuera = (
    tx: TxDeNumeracion,
    cambios: Partial<{ numero: bigint; ultimoDeArca: bigint | null; solicitud: SolicitudId }> = {},
  ) =>
    cerrarFueraDeSecuenciaEnTx(tx, sistema(AHORA), {
      ...entrada(cambios.solicitud ?? SOLICITUD_1),
      numero: cambios.numero ?? 8n,
      resultado: FUERA_DE_SECUENCIA,
      ultimoDeArca: cambios.ultimoDeArca === undefined ? 8n : cambios.ultimoDeArca,
    });

  it("ARCA va adelante: la serie queda BLOQUEADA sin avanzar y la auditoría dice qué informó ARCA, sin los textos", async () => {
    const { mundo, tx } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrarFuera(tx, { ultimoDeArca: 9n })).toEqual(ok({ resolucion: "BLOQUEADA" }));
    expect([...mundo.series.values()][0]).toMatchObject({
      estado: "BLOQUEADA",
      ultimoNumero: 7n,
      motivoBloqueo: expect.stringContaining("desfase con ARCA: informa 9") as unknown,
    });
    expect(mundo.auditoria).toHaveLength(1);
    expect(mundo.auditoria[0]).toMatchObject({
      empresaId: EMPRESA,
      actorPersonaId: null,
      accion: "SERIE_BLOQUEADA",
      entidad: "serie_comprobante",
      entidadId: "pv-1:FACTURA_B:HOMOLOGACION",
      antes: { estado: "EN_CURSO", ultimoNumero: "7", numeroEnCurso: "8" },
      despues: {
        estado: "BLOQUEADA",
        ultimoNumero: "7",
        numero: "8",
        solicitud: SOLICITUD_1,
        errores: [10016],
        observaciones: [10237],
        resolucion: "BLOQUEADA",
        ultimoAutorizadoPorElServicio: "9",
      },
    });
    expect(JSON.stringify(mundo.auditoria[0])).not.toContain("dato personal");
  });

  it("ARCA no respondió (null): NO la libera, la bloquea, y la auditoría deja ese dato como nulo", async () => {
    const { mundo, tx } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrarFuera(tx, { ultimoDeArca: null })).toEqual(ok({ resolucion: "BLOQUEADA" }));
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "BLOQUEADA", ultimoNumero: 7n });
    expect(mundo.auditoria[0]).toMatchObject({
      accion: "SERIE_BLOQUEADA",
      despues: { resolucion: "BLOQUEADA", ultimoAutorizadoPorElServicio: null },
    });
  });

  it("ARCA en el último número (sin desfase): se libera sin avanzar como cualquier rechazo, con su auditoría de siempre", async () => {
    const { mundo, tx } = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrarFuera(tx, { ultimoDeArca: 7n })).toEqual(ok({ resolucion: "LIBERADA" }));
    expect([...mundo.series.values()][0]).toMatchObject({ estado: "LIBRE", ultimoNumero: 7n });
    expect(mundo.auditoria).toHaveLength(1);
    expect(mundo.auditoria[0]).toMatchObject({
      accion: "NUMERO_DE_COMPROBANTE_RECHAZADO",
      despues: {
        estado: "LIBRE",
        errores: [10016],
        resolucion: "LIBERADA",
        ultimoAutorizadoPorElServicio: "7",
      },
    });
  });

  it("corre en contexto de sistema: la auditoría no lleva persona", async () => {
    const { mundo, tx } = armar({ serie: serieEnCurso(7n, VENCE) });
    await cerrarFuera(tx, { ultimoDeArca: 9n });
    expect(mundo.auditoria[0]?.actorPersonaId).toBeNull();
  });

  it("no cierra lo que no es suyo: serie inexistente, otra solicitud, otro número, o ya no en curso; no escribe ni audita", async () => {
    const sinSerie = armar();
    expect(await cerrarFuera(sinSerie.tx)).toEqual(err("SERIE_NO_ENCONTRADA"));
    const otra = armar({ serie: serieEnCurso(7n, VENCE, SOLICITUD_2) });
    expect(await cerrarFuera(otra.tx)).toEqual(err("SOLICITUD_NO_VIGENTE"));
    const otroNumero = armar({ serie: serieEnCurso(7n, VENCE) });
    expect(await cerrarFuera(otroNumero.tx, { numero: 9n })).toEqual(err("NUMERO_INVALIDO"));
    for (const serie of [serieLibre(7n), serieBloqueada(7n)]) {
      const m = armar({ serie });
      expect(await cerrarFuera(m.tx)).toEqual(err("SOLICITUD_NO_VIGENTE"));
      expect(m.mundo.guardados).toEqual([]);
      expect(m.mundo.auditoria).toEqual([]);
    }
    for (const m of [sinSerie, otra, otroNumero]) {
      expect(m.mundo.guardados).toEqual([]);
      expect(m.mundo.auditoria).toEqual([]);
    }
  });

  it("si la serie cambió dentro de la transacción (no pasa en SERIALIZABLE) es un defecto, no un éxito", async () => {
    const { tx } = armar({ serie: serieEnCurso(7n, VENCE), perderVersion: true });
    await expect(cerrarFuera(tx)).rejects.toThrow("la serie cambió dentro de la transacción");
  });

  it("si la empresa no opera no toca nada", async () => {
    const { mundo, tx } = armar({ serie: serieEnCurso(7n, VENCE) });
    const suspendida: TxDeNumeracion = {
      ...tx,
      empresas: { obtener: () => Promise.resolve({ tenantId: "t" as never, estado: "SUSPENDED" }) },
    };
    expect(await cerrarFuera(suspendida)).toMatchObject({
      ok: false,
      error: { codigo: "EMPRESA_NO_OPERA" },
    });
    expect(mundo.guardados).toEqual([]);
    expect(mundo.auditoria).toEqual([]);
  });
});
