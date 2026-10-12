import { describe, expect, it } from "vitest";
import {
  IDENTIDAD_DE_SERIE,
  SOLICITUD_1,
  SOLICITUD_2,
  serieBloqueada,
  serieEnCurso,
  serieLibre,
} from "../../../../test/utilidades/fiscal";
import type { DesenlaceDeAutorizacion } from "./comprobante-emitido";
import {
  OPCIONES_DE_NUMERACION,
  TRANSICIONES_DE_SERIE,
  cerrarSerie,
  hayNumerosUsados,
  iniciarSerie,
  reconciliarSerie,
  reservarNumero,
  serieEsConsistente,
  serieUsada,
  transicionDeSerieValida,
  verificarSecuencia,
  type EstadoDeSerie,
  type Serie,
} from "./numeracion";

const ESTADOS: EstadoDeSerie[] = ["LIBRE", "EN_CURSO", "BLOQUEADA"];
const t = (ms: number) => new Date(ms);
const AHORA = t(1_000_000);
const HASTA = t(1_000_000 + 5 * 60_000);

describe("la máquina de estados de la serie", () => {
  it("las transiciones son exactamente las del diseño", () => {
    expect(TRANSICIONES_DE_SERIE).toEqual({
      LIBRE: ["EN_CURSO"],
      EN_CURSO: ["LIBRE", "BLOQUEADA"],
      BLOQUEADA: [],
    });
  });

  it("los valores por defecto son un plazo de 5 minutos y el máximo de un bigint de la base", () => {
    expect(OPCIONES_DE_NUMERACION).toEqual({
      plazoDeReservaEnMs: 300_000,
      numeroMaximo: 9_223_372_036_854_775_807n,
    });
  });
});

describe("iniciarSerie", () => {
  const identidad = {
    empresaId: IDENTIDAD_DE_SERIE.empresaId,
    puntoDeVentaId: IDENTIDAD_DE_SERIE.puntoDeVentaId,
    emisorId: IDENTIDAD_DE_SERIE.emisorId,
    tipo: IDENTIDAD_DE_SERIE.tipo,
  } as const;

  it("nace LIBRE con el último número que informa el servicio", () => {
    expect(iniciarSerie(identidad, 41n)).toEqual({
      ok: true,
      valor: { ...identidad, version: 1, estado: "LIBRE", ultimoNumero: 41n },
    });
  });

  it("puede empezar de cero", () => {
    const r = iniciarSerie(identidad, 0n);
    expect(r.ok && r.valor.ultimoNumero).toBe(0n);
  });

  it("un último número negativo se rechaza", () => {
    expect(iniciarSerie(identidad, -1n)).toEqual({ ok: false, error: "NUMERO_INVALIDO" });
  });
});

describe("serie usada", () => {
  it("una serie nueva sin números no está usada", () => {
    expect(serieUsada(serieLibre(0n))).toBe(false);
  });

  it("con un número autorizado, en curso o bloqueada, está usada", () => {
    expect(serieUsada(serieLibre(1n))).toBe(true);
    expect(serieUsada(serieEnCurso(0n, HASTA))).toBe(true);
    expect(serieUsada(serieBloqueada(0n))).toBe(true);
  });

  it("un emisor tiene números usados si alguna de sus series los tiene", () => {
    expect(hayNumerosUsados([])).toBe(false);
    expect(hayNumerosUsados([serieLibre(0n), serieLibre(0n)])).toBe(false);
    expect(hayNumerosUsados([serieLibre(0n), serieLibre(5n)])).toBe(true);
    expect(hayNumerosUsados([serieLibre(0n), serieEnCurso(0n, HASTA)])).toBe(true);
  });
});

describe("reservarNumero", () => {
  it("una serie libre reserva el siguiente número hasta ahora + el plazo", () => {
    const r = reservarNumero(serieLibre(7n), SOLICITUD_1, AHORA);
    expect(r).toEqual({
      ok: true,
      valor: {
        tipo: "RESERVADA",
        numero: 8n,
        serie: {
          ...IDENTIDAD_DE_SERIE,
          estado: "EN_CURSO",
          ultimoNumero: 7n,
          numeroEnCurso: 8n,
          solicitud: SOLICITUD_1,
          enCursoHasta: HASTA,
        },
      },
    });
  });

  it("la primera reserva de una serie nueva es el número 1", () => {
    const r = reservarNumero(serieLibre(0n), SOLICITUD_1, AHORA);
    expect(r.ok && r.valor.tipo === "RESERVADA" && r.valor.numero).toBe(1n);
  });

  it("repetir con la misma solicitud devuelve el mismo número, sin escribir", () => {
    const enCurso = serieEnCurso(7n, HASTA, SOLICITUD_1);
    expect(reservarNumero(enCurso, SOLICITUD_1, t(9_999_999))).toEqual({
      ok: true,
      valor: { tipo: "YA_RESERVADA", numero: 8n },
    });
  });

  it("otra solicitud recibe SERIE_OCUPADA", () => {
    expect(reservarNumero(serieEnCurso(7n, HASTA, SOLICITUD_1), SOLICITUD_2, AHORA)).toEqual({
      ok: false,
      error: "SERIE_OCUPADA",
    });
  });

  it("una serie bloqueada no reserva, ni siquiera para la solicitud que tenía", () => {
    expect(reservarNumero(serieBloqueada(7n), SOLICITUD_1, AHORA)).toEqual({
      ok: false,
      error: "SERIE_BLOQUEADA",
    });
  });

  it("el plazo es configurable", () => {
    const r = reservarNumero(serieLibre(0n), SOLICITUD_1, AHORA, {
      ...OPCIONES_DE_NUMERACION,
      plazoDeReservaEnMs: 1000,
    });
    expect(r.ok && r.valor.tipo === "RESERVADA" && r.valor.serie.enCursoHasta).toEqual(
      t(1_001_000),
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "un plazo de %s es un error de programación",
    (plazo) => {
      expect(() =>
        reservarNumero(serieLibre(0n), SOLICITUD_1, AHORA, {
          ...OPCIONES_DE_NUMERACION,
          plazoDeReservaEnMs: plazo,
        }),
      ).toThrow(new RangeError("el plazo de reserva debe ser un entero positivo de milisegundos"));
    },
  );

  it("un plazo de 1 ms es válido", () => {
    const r = reservarNumero(serieLibre(0n), SOLICITUD_1, AHORA, {
      ...OPCIONES_DE_NUMERACION,
      plazoDeReservaEnMs: 1,
    });
    expect(r.ok).toBe(true);
  });

  it("una serie que llegó al número máximo está agotada", () => {
    const opciones = { ...OPCIONES_DE_NUMERACION, numeroMaximo: 10n };
    expect(reservarNumero(serieLibre(10n), SOLICITUD_1, AHORA, opciones)).toEqual({
      ok: false,
      error: "SERIE_AGOTADA",
    });
    expect(reservarNumero(serieLibre(11n), SOLICITUD_1, AHORA, opciones)).toEqual({
      ok: false,
      error: "SERIE_AGOTADA",
    });
    const r = reservarNumero(serieLibre(9n), SOLICITUD_1, AHORA, opciones);
    expect(r.ok && r.valor.tipo === "RESERVADA" && r.valor.numero).toBe(10n);
  });

  it("no modifica la serie original", () => {
    const libre = serieLibre(3n);
    reservarNumero(libre, SOLICITUD_1, AHORA);
    expect(libre).toEqual(serieLibre(3n));
  });
});

describe("cerrarSerie", () => {
  const enCurso = serieEnCurso(7n, HASTA, SOLICITUD_1);

  it("autorizado: el último número pasa a ser el reservado y la serie queda libre", () => {
    expect(cerrarSerie(enCurso, SOLICITUD_1, "AUTORIZADO")).toEqual({
      ok: true,
      valor: { serie: serieLibre(8n), numeroAutorizado: 8n },
    });
  });

  it("rechazado: libre sin avanzar, no hay hueco", () => {
    expect(cerrarSerie(enCurso, SOLICITUD_1, "RECHAZADO")).toEqual({
      ok: true,
      valor: { serie: serieLibre(7n), numeroAutorizado: null },
    });
  });

  it("incierto: sigue en curso, sin cambios", () => {
    const r = cerrarSerie(enCurso, SOLICITUD_1, "INCIERTO");
    expect(r).toEqual({ ok: true, valor: { serie: enCurso, numeroAutorizado: null } });
  });

  it("solo cierra la solicitud que reservó", () => {
    expect(cerrarSerie(enCurso, SOLICITUD_2, "AUTORIZADO")).toEqual({
      ok: false,
      error: "SOLICITUD_NO_VIGENTE",
    });
  });

  it("una serie libre o bloqueada no tiene nada que cerrar (cerrar dos veces no avanza dos veces)", () => {
    for (const desenlace of ["AUTORIZADO", "RECHAZADO", "INCIERTO"] as const) {
      expect(cerrarSerie(serieLibre(8n), SOLICITUD_1, desenlace)).toEqual({
        ok: false,
        error: "SOLICITUD_NO_VIGENTE",
      });
      expect(cerrarSerie(serieBloqueada(8n), SOLICITUD_1, desenlace)).toEqual({
        ok: false,
        error: "SOLICITUD_NO_VIGENTE",
      });
    }
  });

  it("una fila que no está en curso pero conserva la solicitud (dato viejo) tampoco se cierra", () => {
    const rancia = { ...enCurso, estado: "LIBRE" } as unknown as Serie;
    expect(cerrarSerie(rancia, SOLICITUD_1, "AUTORIZADO")).toEqual({
      ok: false,
      error: "SOLICITUD_NO_VIGENTE",
    });
  });

  it("conserva la identidad y la versión de la serie", () => {
    const r = cerrarSerie(enCurso, SOLICITUD_1, "AUTORIZADO");
    expect(r.ok && r.valor.serie).toMatchObject(IDENTIDAD_DE_SERIE);
  });
});

describe("reconciliarSerie", () => {
  const enCurso = serieEnCurso(7n, HASTA, SOLICITUD_1);
  const vencida = HASTA;

  it("si el servicio ya tenía el número en curso: se cierra como autorizado", () => {
    expect(reconciliarSerie(enCurso, 8n, vencida)).toEqual({
      ok: true,
      valor: { serie: serieLibre(8n), resolucion: "CERRADA_COMO_AUTORIZADA" },
    });
  });

  it("si el servicio sigue en el último número: se libera sin avanzar", () => {
    expect(reconciliarSerie(enCurso, 7n, vencida)).toEqual({
      ok: true,
      valor: { serie: serieLibre(7n), resolucion: "LIBERADA" },
    });
  });

  it("cualquier otro valor es un desfase: la serie queda bloqueada con el motivo", () => {
    const r = reconciliarSerie(enCurso, 9n, vencida);
    expect(r).toEqual({
      ok: true,
      valor: {
        resolucion: "BLOQUEADA",
        serie: {
          ...IDENTIDAD_DE_SERIE,
          estado: "BLOQUEADA",
          ultimoNumero: 7n,
          motivoBloqueo: "desfase con el servicio de emisión: informa 9, se esperaba 7 o 8",
        },
      },
    });
    for (const informado of [0n, 6n, 10n, 1000n, -1n]) {
      const desfase = reconciliarSerie(enCurso, informado, vencida);
      expect(desfase.ok && desfase.valor.resolucion).toBe("BLOQUEADA");
    }
  });

  it("antes de vencer la reserva no se reconcilia; en el instante exacto sí", () => {
    expect(reconciliarSerie(enCurso, 8n, t(HASTA.getTime() - 1))).toEqual({
      ok: false,
      error: "RESERVA_NO_VENCIDA",
    });
    expect(reconciliarSerie(enCurso, 8n, HASTA).ok).toBe(true);
    expect(reconciliarSerie(enCurso, 8n, t(HASTA.getTime() + 1)).ok).toBe(true);
  });

  it("solo se reconcilia una serie en curso", () => {
    expect(reconciliarSerie(serieLibre(7n), 7n, vencida)).toEqual({
      ok: false,
      error: "SERIE_NO_EN_CURSO",
    });
    expect(reconciliarSerie(serieBloqueada(7n), 7n, vencida)).toEqual({
      ok: false,
      error: "SERIE_NO_EN_CURSO",
    });
  });

  it("una serie bloqueada no tiene salida: nada la libera", () => {
    const bloqueada = serieBloqueada(7n);
    expect(reservarNumero(bloqueada, SOLICITUD_1, AHORA).ok).toBe(false);
    expect(cerrarSerie(bloqueada, SOLICITUD_1, "AUTORIZADO").ok).toBe(false);
    expect(reconciliarSerie(bloqueada, 7n, vencida).ok).toBe(false);
  });
});

describe("serieEsConsistente (las restricciones CHECK de la tabla)", () => {
  it("las series bien formadas lo son", () => {
    expect(serieEsConsistente(serieLibre(0n))).toBe(true);
    expect(serieEsConsistente(serieEnCurso(3n, HASTA))).toBe(true);
    expect(serieEsConsistente(serieBloqueada(3n))).toBe(true);
  });

  it("un último número negativo no", () => {
    expect(serieEsConsistente(serieLibre(-1n))).toBe(false);
    expect(serieEsConsistente(serieBloqueada(-1n))).toBe(false);
  });

  it("una reserva que no es exactamente el siguiente número no", () => {
    const base = serieEnCurso(3n, HASTA);
    if (base.estado !== "EN_CURSO") throw new Error("fixture");
    expect(serieEsConsistente({ ...base, numeroEnCurso: 5n })).toBe(false);
    expect(serieEsConsistente({ ...base, numeroEnCurso: 3n })).toBe(false);
  });

  it("una reserva sin solicitud o con la fecha inválida no", () => {
    const base = serieEnCurso(3n, HASTA);
    if (base.estado !== "EN_CURSO") throw new Error("fixture");
    expect(serieEsConsistente({ ...base, solicitud: "" as typeof base.solicitud })).toBe(false);
    expect(serieEsConsistente({ ...base, solicitud: "  " as typeof base.solicitud })).toBe(false);
    expect(serieEsConsistente({ ...base, enCursoHasta: new Date(Number.NaN) })).toBe(false);
  });

  it("un bloqueo sin motivo no", () => {
    expect(serieEsConsistente(serieBloqueada(3n, ""))).toBe(false);
    expect(serieEsConsistente(serieBloqueada(3n, "   "))).toBe(false);
  });
});

describe("transicionDeSerieValida", () => {
  const libre = serieLibre(7n);
  const enCurso = serieEnCurso(7n, HASTA, SOLICITUD_1);
  const bloqueada = serieBloqueada(7n, "desfase");

  it("las transiciones que hacen las operaciones son todas válidas", () => {
    const reservada = reservarNumero(libre, SOLICITUD_1, AHORA);
    expect(reservada.ok && reservada.valor.tipo === "RESERVADA" && reservada.valor.serie).toEqual(
      enCurso,
    );
    expect(transicionDeSerieValida(libre, enCurso)).toBe(true);
    expect(transicionDeSerieValida(enCurso, serieLibre(8n))).toBe(true); // autorizado
    expect(transicionDeSerieValida(enCurso, serieLibre(7n))).toBe(true); // rechazado o liberado
    expect(transicionDeSerieValida(enCurso, bloqueada)).toBe(true);
    expect(transicionDeSerieValida(enCurso, enCurso)).toBe(true); // incierto
    expect(transicionDeSerieValida(libre, libre)).toBe(true);
    expect(transicionDeSerieValida(bloqueada, bloqueada)).toBe(true);
  });

  it("el último número no baja nunca", () => {
    expect(transicionDeSerieValida(libre, serieLibre(6n))).toBe(false);
    expect(transicionDeSerieValida(enCurso, serieLibre(6n))).toBe(false);
    expect(transicionDeSerieValida(serieEnCurso(7n, HASTA), serieBloqueada(6n))).toBe(false);
  });

  it("el último número no sube salvo cerrando la reserva con su número", () => {
    expect(transicionDeSerieValida(libre, serieLibre(8n))).toBe(false);
    expect(transicionDeSerieValida(libre, serieLibre(9n))).toBe(false);
    expect(transicionDeSerieValida(enCurso, serieLibre(9n))).toBe(false); // se saltea un número
    expect(transicionDeSerieValida(enCurso, serieLibre(10n))).toBe(false);
    expect(transicionDeSerieValida(enCurso, serieBloqueada(8n))).toBe(false); // bloquear no avanza
    expect(transicionDeSerieValida(enCurso, serieBloqueada(7n))).toBe(true);
  });

  it("una libre solo pasa a en curso, y con el último número intacto", () => {
    expect(transicionDeSerieValida(libre, serieBloqueada(7n))).toBe(false);
    expect(transicionDeSerieValida(libre, serieEnCurso(8n, HASTA))).toBe(false);
    expect(transicionDeSerieValida(libre, serieEnCurso(6n, HASTA))).toBe(false);
  });

  it("la bloqueada no sale: ni a libre ni a en curso ni cambiando el motivo", () => {
    expect(transicionDeSerieValida(bloqueada, serieLibre(7n))).toBe(false);
    expect(transicionDeSerieValida(bloqueada, serieEnCurso(7n, HASTA))).toBe(false);
    expect(transicionDeSerieValida(bloqueada, serieBloqueada(7n, "otro motivo"))).toBe(false);
    expect(transicionDeSerieValida(bloqueada, serieBloqueada(8n, "desfase"))).toBe(false);
  });

  it("una bloqueada no pasa a otro estado aunque el destino arrastre el motivo", () => {
    const rancia = { ...serieLibre(7n), motivoBloqueo: "desfase" } as unknown as Serie;
    expect(transicionDeSerieValida(bloqueada, rancia)).toBe(false);
  });

  it("una en curso no cambia de solicitud ni de plazo sin cerrarse", () => {
    expect(transicionDeSerieValida(enCurso, serieEnCurso(7n, HASTA, SOLICITUD_2))).toBe(false);
    expect(transicionDeSerieValida(enCurso, serieEnCurso(7n, t(HASTA.getTime() + 1)))).toBe(false);
    expect(transicionDeSerieValida(enCurso, serieEnCurso(8n, HASTA, SOLICITUD_1))).toBe(false);
  });

  it("la identidad no cambia", () => {
    const base = serieLibre(7n);
    expect(transicionDeSerieValida(base, { ...base, tipo: "FACTURA_A" })).toBe(false);
    expect(
      transicionDeSerieValida(base, { ...base, empresaId: "otra" as typeof base.empresaId }),
    ).toBe(false);
    expect(
      transicionDeSerieValida(base, {
        ...base,
        puntoDeVentaId: "otro" as typeof base.puntoDeVentaId,
      }),
    ).toBe(false);
    expect(
      transicionDeSerieValida(base, { ...base, emisorId: "otro" as typeof base.emisorId }),
    ).toBe(false);
  });

  it("el cambio de versión no cuenta", () => {
    expect(transicionDeSerieValida(libre, { ...libre, version: 99 })).toBe(true);
  });

  it("el destino tiene que ser consistente", () => {
    const destino = { ...enCurso, numeroEnCurso: 9n } as Serie;
    expect(transicionDeSerieValida(libre, destino)).toBe(false);
  });

  it("las nueve combinaciones de estado coinciden con la tabla de transiciones (más quedarse igual)", () => {
    const origen: Record<EstadoDeSerie, Serie> = {
      LIBRE: libre,
      EN_CURSO: enCurso,
      BLOQUEADA: bloqueada,
    };
    // Destino con el último número intacto: lo que cambia es solo el estado.
    const destino: Record<EstadoDeSerie, Serie> = {
      LIBRE: serieLibre(7n),
      EN_CURSO: serieEnCurso(7n, HASTA, SOLICITUD_1),
      BLOQUEADA: serieBloqueada(7n, "desfase"),
    };
    for (const desde of ESTADOS) {
      for (const hacia of ESTADOS) {
        const esperado = desde === hacia || TRANSICIONES_DE_SERIE[desde].includes(hacia);
        expect(transicionDeSerieValida(origen[desde], destino[hacia])).toBe(esperado);
      }
    }
  });
});

describe("verificarSecuencia: sin huecos ni duplicados", () => {
  it("números consecutivos desde el último inicial, en cualquier orden", () => {
    expect(verificarSecuencia(0n, [])).toEqual({ ok: true, valor: 0n });
    expect(verificarSecuencia(0n, [1n, 2n, 3n])).toEqual({ ok: true, valor: 3n });
    expect(verificarSecuencia(0n, [3n, 1n, 2n])).toEqual({ ok: true, valor: 3n });
    expect(verificarSecuencia(40n, [41n, 42n])).toEqual({ ok: true, valor: 42n });
  });

  it("un número repetido", () => {
    expect(verificarSecuencia(0n, [1n, 2n, 2n])).toEqual({ ok: false, error: "NUMERO_DUPLICADO" });
    expect(verificarSecuencia(0n, [1n, 1n])).toEqual({ ok: false, error: "NUMERO_DUPLICADO" });
  });

  it("un número que ya estaba usado antes de empezar cuenta como duplicado", () => {
    expect(verificarSecuencia(40n, [40n, 41n])).toEqual({ ok: false, error: "NUMERO_DUPLICADO" });
    expect(verificarSecuencia(40n, [39n])).toEqual({ ok: false, error: "NUMERO_DUPLICADO" });
  });

  it("un hueco", () => {
    expect(verificarSecuencia(0n, [1n, 3n])).toEqual({ ok: false, error: "NUMERO_SALTEADO" });
    expect(verificarSecuencia(0n, [2n])).toEqual({ ok: false, error: "NUMERO_SALTEADO" });
    expect(verificarSecuencia(40n, [42n])).toEqual({ ok: false, error: "NUMERO_SALTEADO" });
  });

  it("no modifica la lista que recibe", () => {
    const lista = [3n, 1n, 2n];
    verificarSecuencia(0n, lista);
    expect(lista).toEqual([3n, 1n, 2n]);
  });
});

describe("recorrido completo de una serie", () => {
  it("reservar, autorizar y repetir: los números salen 1, 2, 3 sin saltos", () => {
    let serie: Serie = serieLibre(0n);
    const autorizados: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const reserva = reservarNumero(serie, SOLICITUD_1, AHORA);
      if (!reserva.ok || reserva.valor.tipo !== "RESERVADA") throw new Error("no reservó");
      const cierre = cerrarSerie(reserva.valor.serie, SOLICITUD_1, "AUTORIZADO");
      if (!cierre.ok) throw new Error("no cerró");
      if (cierre.valor.numeroAutorizado !== null) autorizados.push(cierre.valor.numeroAutorizado);
      expect(transicionDeSerieValida(reserva.valor.serie, cierre.valor.serie)).toBe(true);
      serie = cierre.valor.serie;
    }
    expect(autorizados).toEqual([1n, 2n, 3n]);
    expect(serie.ultimoNumero).toBe(3n);
  });

  it("un rechazo en el medio no deja hueco: el número se reusa", () => {
    const resultados: DesenlaceDeAutorizacion[] = ["AUTORIZADO", "RECHAZADO", "AUTORIZADO"];
    let serie: Serie = serieLibre(0n);
    const autorizados: bigint[] = [];
    for (const desenlace of resultados) {
      const reserva = reservarNumero(serie, SOLICITUD_1, AHORA);
      if (!reserva.ok || reserva.valor.tipo !== "RESERVADA") throw new Error("no reservó");
      const cierre = cerrarSerie(reserva.valor.serie, SOLICITUD_1, desenlace);
      if (!cierre.ok) throw new Error("no cerró");
      if (cierre.valor.numeroAutorizado !== null) autorizados.push(cierre.valor.numeroAutorizado);
      serie = cierre.valor.serie;
    }
    expect(autorizados).toEqual([1n, 2n]);
    expect(serie.ultimoNumero).toBe(2n);
  });
});
