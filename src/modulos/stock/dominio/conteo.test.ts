import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import {
  diferenciaBruta,
  explicarConMarcas,
  horaDelConteo,
  huellaDeRevision,
  registrosVigentes,
  validarHoraDeConteo,
  type ItemDeRevision,
  type RegistroDeConteo,
  type RenglonMarcable,
} from "./conteo";

const cs = (texto: string): CantidadConSigno => {
  const r = cantidadConSignoDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const hora = (texto: string): Date => new Date(texto);

const reg = (
  articuloId: string,
  orden: number,
  contada: string,
  extra: Partial<RegistroDeConteo> = {},
): RegistroDeConteo => ({
  id: `${articuloId}-${orden}`,
  articuloId,
  orden,
  cantidadContada: cantidadDesdeTexto(contada),
  contadoEn: null,
  registradoEn: hora("2026-11-11T13:10:00Z"),
  ...extra,
});

describe("horaDelConteo: la declarada, o la de carga si no declaró ninguna", () => {
  it("con hora declarada vale esa; sin ella, la de carga", () => {
    const declarada = hora("2026-11-11T13:00:00Z");
    const carga = hora("2026-11-11T13:10:00Z");
    expect(horaDelConteo({ contadoEn: declarada, registradoEn: carga })).toBe(declarada);
    expect(horaDelConteo({ contadoEn: null, registradoEn: carga })).toBe(carga);
  });
});

describe("registrosVigentes: vale el ÚLTIMO CARGADO de cada artículo, ordenado por artículo", () => {
  it("sin registros no hay vigentes", () => {
    expect(registrosVigentes([])).toEqual([]);
  });

  it("de varios registros del mismo artículo vale el de mayor `orden`, en cualquier orden de llegada", () => {
    const ids = (registros: readonly RegistroDeConteo[]) =>
      registrosVigentes(registros).map((r) => r.id);
    expect(ids([reg("a", 3, "8"), reg("a", 1, "1"), reg("a", 2, "2")])).toEqual(["a-3"]);
    expect(ids([reg("a", 1, "1"), reg("a", 2, "2"), reg("a", 3, "8")])).toEqual(["a-3"]);
    expect(ids([reg("a", 2, "2"), reg("a", 3, "8"), reg("a", 1, "1")])).toEqual(["a-3"]);
  });

  it("vale el último cargado aunque tenga una hora de conteo ANTERIOR (CF16: quien corrige, manda)", () => {
    const vigentes = registrosVigentes([
      reg("a", 1, "5", { contadoEn: hora("2026-11-11T13:00:00Z") }),
      reg("a", 2, "6", { contadoEn: hora("2026-11-11T12:40:00Z") }),
    ]);
    expect(vigentes.map((r) => r.id)).toEqual(["a-2"]);
  });

  it("con el mismo `orden` se queda con el primero (no hay empate en la base: el identity no repite)", () => {
    const primero = reg("a", 1, "1", { id: "primero" });
    const segundo = reg("a", 1, "2", { id: "segundo" });
    expect(registrosVigentes([primero, segundo]).map((r) => r.id)).toEqual(["primero"]);
  });

  it("un vigente por artículo, ordenados por artículo", () => {
    const vigentes = registrosVigentes([
      reg("c", 5, "1"),
      reg("a", 1, "1"),
      reg("b", 2, "1"),
      reg("a", 4, "2"),
    ]);
    expect(vigentes.map((r) => r.id)).toEqual(["a-4", "b-2", "c-5"]);
  });
});

describe("diferenciaBruta: contada − lo que el sistema creía a esa hora", () => {
  const d = (contada: string, existencia: string) => {
    const r = diferenciaBruta(cantidadDesdeTexto(contada), cs(existencia));
    return r.ok ? cantidadConSignoATexto(r.valor) : r.error;
  };

  it("positiva si contó de más, negativa si contó de menos, cero si coincide", () => {
    expect(d("10", "7.5")).toBe("2.5000");
    expect(d("3", "5")).toBe("-2.0000");
    expect(d("4", "4")).toBe("0.0000");
    expect(d("0", "5")).toBe("-5.0000");
    expect(d("0.0001", "0")).toBe("0.0001");
  });

  it("lo que había puede ser negativo (existencia negativa): contar 0 sobre −2 es un sobrante de 2", () => {
    expect(d("0", "-2")).toBe("2.0000");
    expect(d("2", "-3")).toBe("5.0000");
  });

  it("CF17: unidades de peso con 4 decimales exactos (2,5 contados sobre 3 → −0,5)", () => {
    expect(d("2.5", "3")).toBe("-0.5000");
  });

  it("FUERA_DE_RANGO si la diferencia no se puede representar", () => {
    expect(d("99999999999999.9999", "-0.0001")).toBe("FUERA_DE_RANGO");
  });
});

describe("explicarConMarcas: Δ = Δ0 − Σ marcados (solo explica, nunca inventa)", () => {
  const HORA = hora("2026-11-11T13:00:00Z");
  const despues = (minutos: number) => new Date(HORA.getTime() + minutos * 60_000);
  const marca = (cantidad: string, hechoEn: Date = despues(5)): RenglonMarcable => ({
    cantidad: cs(cantidad),
    hechoEn,
  });
  const explicar = (bruta: string, ...marcados: RenglonMarcable[]) => {
    const r = explicarConMarcas(cs(bruta), HORA, marcados);
    return r.ok
      ? [cantidadConSignoATexto(r.valor.marcado), cantidadConSignoATexto(r.valor.diferenciaFinal)]
      : r.error;
  };

  it("sin marcas la diferencia final es la bruta (marcar es opcional)", () => {
    expect(explicar("-2")).toEqual(["0.0000", "-2.0000"]);
    expect(explicar("3")).toEqual(["0.0000", "3.0000"]);
    expect(explicar("0")).toEqual(["0.0000", "0.0000"]);
  });

  it("un faltante se explica con lo que restó después de la hora", () => {
    expect(explicar("-5", marca("-3"))).toEqual(["-3.0000", "-2.0000"]);
    expect(explicar("-5", marca("-3"), marca("-1.5"))).toEqual(["-4.5000", "-0.5000"]);
  });

  it("un sobrante se explica con lo que sumó después de la hora", () => {
    expect(explicar("5", marca("2"))).toEqual(["2.0000", "3.0000"]);
    expect(explicar("5", marca("2"), marca("1"))).toEqual(["3.0000", "2.0000"]);
  });

  it("CF3/CF6: marcar lo que explica TODO deja la diferencia en cero", () => {
    expect(explicar("-3", marca("-3"))).toEqual(["-3.0000", "0.0000"]);
    expect(explicar("5", marca("5"))).toEqual(["5.0000", "0.0000"]);
    expect(explicar("-3", marca("-1"), marca("-2"))).toEqual(["-3.0000", "0.0000"]);
  });

  it("CF8: lo marcado no puede pasar de la diferencia (nunca la invierte)", () => {
    expect(explicar("-2", marca("-3"))).toBe("EXPLICACION_SUPERA_LA_DIFERENCIA");
    expect(explicar("-2", marca("-1"), marca("-1.0001"))).toBe("EXPLICACION_SUPERA_LA_DIFERENCIA");
    expect(explicar("2", marca("3"))).toBe("EXPLICACION_SUPERA_LA_DIFERENCIA");
    expect(explicar("2", marca("1"), marca("1.0001"))).toBe("EXPLICACION_SUPERA_LA_DIFERENCIA");
  });

  it("CF9: solo explica un movimiento del MISMO sentido que la diferencia", () => {
    expect(explicar("-2", marca("5"))).toBe("MOVIMIENTO_NO_EXPLICA");
    expect(explicar("2", marca("-5"))).toBe("MOVIMIENTO_NO_EXPLICA");
    // Una sola marca mala invalida el pedido aunque haya otras buenas.
    expect(explicar("-5", marca("-1"), marca("1"))).toBe("MOVIMIENTO_NO_EXPLICA");
  });

  it("un movimiento de cantidad cero no explica nada, ni un faltante ni un sobrante", () => {
    expect(explicar("-2", marca("0"))).toBe("MOVIMIENTO_NO_EXPLICA");
    expect(explicar("2", marca("0"))).toBe("MOVIMIENTO_NO_EXPLICA");
  });

  it("sin diferencia bruta no hay nada que explicar: marcar lo que sea es rechazado", () => {
    expect(explicar("0", marca("-1"))).toBe("MOVIMIENTO_NO_EXPLICA");
    expect(explicar("0", marca("1"))).toBe("MOVIMIENTO_NO_EXPLICA");
  });

  it("el movimiento tiene que ser POSTERIOR a la hora del conteo (la misma hora no explica; un milisegundo después sí)", () => {
    expect(explicar("-2", marca("-1", HORA))).toBe("MOVIMIENTO_NO_EXPLICA");
    expect(explicar("-2", marca("-1", new Date(HORA.getTime() - 1)))).toBe("MOVIMIENTO_NO_EXPLICA");
    expect(explicar("-2", marca("-1", new Date(HORA.getTime() + 1)))).toEqual([
      "-1.0000",
      "-1.0000",
    ]);
  });

  it("FUERA_DE_RANGO si lo marcado no se puede sumar", () => {
    expect(explicar("-99999999999999.9999", marca("-99999999999999.9999"), marca("-1"))).toBe(
      "FUERA_DE_RANGO",
    );
  });
});

describe("validarHoraDeConteo: no futura, en la jornada vigente o la anterior, no antes del último conteo (CF-D2)", () => {
  const AHORA = hora("2026-11-11T05:00:00Z");
  const valida = (extra: Partial<Parameters<typeof validarHoraDeConteo>[0]> = {}) =>
    validarHoraDeConteo({
      hora: hora("2026-11-11T04:00:00Z"),
      ahora: AHORA,
      jornadaDeLaHora: "2026-11-10",
      jornadaDeHoy: "2026-11-10",
      ultimoAplicadoEn: null,
      ...extra,
    });
  const resultado = (extra: Partial<Parameters<typeof validarHoraDeConteo>[0]> = {}) => {
    const r = valida(extra);
    return r.ok ? "ok" : r.error;
  };

  it("una hora de la jornada vigente se admite", () => {
    expect(resultado()).toBe("ok");
  });

  it("una hora de la jornada ANTERIOR se admite (un conteo de cierre cargado a la mañana)", () => {
    expect(resultado({ jornadaDeLaHora: "2026-11-09" })).toBe("ok");
    // Cruza el fin de mes y de año.
    expect(resultado({ jornadaDeHoy: "2026-12-01", jornadaDeLaHora: "2026-11-30" })).toBe("ok");
    expect(resultado({ jornadaDeHoy: "2027-01-01", jornadaDeLaHora: "2026-12-31" })).toBe("ok");
  });

  it("de hace dos jornadas o más no se admite (HORA_FUERA_DE_VENTANA)", () => {
    expect(resultado({ jornadaDeLaHora: "2026-11-08" })).toBe("HORA_FUERA_DE_VENTANA");
    expect(resultado({ jornadaDeLaHora: "2026-10-01" })).toBe("HORA_FUERA_DE_VENTANA");
  });

  it("una jornada posterior a la de hoy tampoco (fail closed), y una fecha ilegible cierra", () => {
    expect(resultado({ jornadaDeLaHora: "2026-11-11" })).toBe("HORA_FUERA_DE_VENTANA");
    expect(resultado({ jornadaDeLaHora: "no es una fecha" })).toBe("HORA_FUERA_DE_VENTANA");
    expect(resultado({ jornadaDeHoy: "no es una fecha" })).toBe("HORA_FUERA_DE_VENTANA");
  });

  it("no puede ser futura: la misma hora que `ahora` sí, un milisegundo después no (FECHA_FUTURA_NO_ADMITIDA)", () => {
    expect(resultado({ hora: AHORA })).toBe("ok");
    expect(resultado({ hora: new Date(AHORA.getTime() + 1) })).toBe("FECHA_FUTURA_NO_ADMITIDA");
    expect(resultado({ hora: new Date(Number.NaN) })).toBe("FECHA_FUTURA_NO_ADMITIDA");
  });

  it("no puede ser anterior al momento en que se aplicó el último conteo del depósito: ese instante exacto sí (HORA_ANTERIOR_AL_ULTIMO_CONTEO)", () => {
    const ultimo = hora("2026-11-11T03:00:00Z");
    expect(resultado({ ultimoAplicadoEn: ultimo, hora: ultimo })).toBe("ok");
    expect(resultado({ ultimoAplicadoEn: ultimo, hora: new Date(ultimo.getTime() - 1) })).toBe(
      "HORA_ANTERIOR_AL_ULTIMO_CONTEO",
    );
    expect(resultado({ ultimoAplicadoEn: ultimo, hora: new Date(ultimo.getTime() + 1) })).toBe(
      "ok",
    );
  });

  it("el orden de los rechazos es: futura, fuera de ventana, anterior al último conteo", () => {
    const todoMal = {
      hora: new Date(AHORA.getTime() + 1),
      jornadaDeLaHora: "2026-10-01",
      ultimoAplicadoEn: hora("2026-11-11T04:59:00Z"),
    };
    expect(resultado(todoMal)).toBe("FECHA_FUTURA_NO_ADMITIDA");
    expect(resultado({ ...todoMal, hora: hora("2026-11-11T04:00:00Z") })).toBe(
      "HORA_FUERA_DE_VENTANA",
    );
  });
});

describe("huellaDeRevision: lo que la persona vio, y nada más", () => {
  const item = (extra: Partial<ItemDeRevision> = {}): ItemDeRevision => ({
    articuloId: "a",
    registroId: "r1",
    hora: hora("2026-11-11T13:00:00Z"),
    existenciaALaHora: cs("20"),
    diferenciaBruta: cs("0"),
    ...extra,
  });
  const base = [item(), item({ articuloId: "b", registroId: "r2", diferenciaBruta: cs("-2") })];

  it("es un sha256 en hexadecimal, y el mismo contenido da siempre la misma huella (golden)", () => {
    const huella = huellaDeRevision("conteo-1", base);
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeRevision("conteo-1", base)).toBe(huella);
    expect(huella).toBe("9af5e4b69949d2f52a2caed6857a358ba4f575fde0668b2fe9ee23244022f1d6");
  });

  it("el orden de los artículos no cambia la huella", () => {
    expect(huellaDeRevision("conteo-1", [...base].reverse())).toBe(
      huellaDeRevision("conteo-1", base),
    );
  });

  it("cualquier cosa que la persona vio y cambia, cambia la huella", () => {
    const original = huellaDeRevision("conteo-1", base);
    const otras = [
      huellaDeRevision("conteo-2", base),
      huellaDeRevision("conteo-1", [item({ articuloId: "z" }), base[1] as ItemDeRevision]),
      huellaDeRevision("conteo-1", [item({ registroId: "r9" }), base[1] as ItemDeRevision]),
      huellaDeRevision("conteo-1", [
        item({ hora: hora("2026-11-11T13:00:01Z") }),
        base[1] as ItemDeRevision,
      ]),
      huellaDeRevision("conteo-1", [
        item({ existenciaALaHora: cs("20.0001") }),
        base[1] as ItemDeRevision,
      ]),
      huellaDeRevision("conteo-1", [
        item({ diferenciaBruta: cs("0.0001") }),
        base[1] as ItemDeRevision,
      ]),
      huellaDeRevision("conteo-1", [base[0] as ItemDeRevision]),
      huellaDeRevision("conteo-1", []),
    ];
    expect(new Set([original, ...otras]).size).toBe(otras.length + 1);
  });
});
