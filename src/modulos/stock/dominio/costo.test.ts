import { describe, expect, it } from "vitest";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  precioUnitarioATexto,
  precioUnitarioDesdeTexto,
} from "../../../primitivas/dinero/precio-unitario";
import {
  costoDefinitivo,
  corregirPromedio,
  costoVigente,
  entrar,
  ESTADO_DE_COSTO_INICIAL,
  salir,
  SIN_COSTO,
  transferir,
  type CostoDeRenglon,
  type EstadoDeCosto,
} from "./costo";

const q = (t: string) => cantidadDesdeTexto(t);
const c = (t: string) => costoDefinitivo(precioUnitarioDesdeTexto(t));
const estado = (promedio: string | null, valorizada: string): EstadoDeCosto => ({
  promedio: promedio === null ? null : precioUnitarioDesdeTexto(promedio),
  cantidadValorizada: q(valorizada),
});
const ver = (e: EstadoDeCosto): [string | null, string] => [
  e.promedio === null ? null : precioUnitarioATexto(e.promedio),
  cantidadATexto(e.cantidadValorizada),
];
const verCosto = (costo: CostoDeRenglon): string | null =>
  costo.estado === "SIN_COSTO" ? null : precioUnitarioATexto(costo.costoUnitario);

describe("el estado inicial y el costo vigente", () => {
  it("empieza sin promedio y sin cantidad valorizada", () => {
    expect(ver(ESTADO_DE_COSTO_INICIAL)).toEqual([null, "0.0000"]);
  });

  it("el costo vigente es el promedio o SIN_COSTO si nunca hubo", () => {
    expect(costoVigente(ESTADO_DE_COSTO_INICIAL)).toEqual({ estado: "SIN_COSTO" });
    expect(costoVigente(ESTADO_DE_COSTO_INICIAL)).toBe(SIN_COSTO);
    expect(verCosto(costoVigente(estado("12.5", "3")))).toBe("12.500000");
    expect(costoVigente(estado("0", "3")).estado).toBe("DEFINITIVO");
  });
});

describe("entrar", () => {
  it("la primera entrada con costo fija el promedio y la cantidad valorizada", () => {
    expect(ver(entrar(ESTADO_DE_COSTO_INICIAL, q("10"), c("100.5")))).toEqual([
      "100.500000",
      "10.0000",
    ]);
  });

  it("promedio ponderado: (q_prev × c_prev + q_in × c_in) ÷ (q_prev + q_in)", () => {
    expect(ver(entrar(estado("100", "10"), q("10"), c("200")))).toEqual(["150.000000", "20.0000"]);
    expect(ver(entrar(estado("100", "30"), q("10"), c("200")))).toEqual(["125.000000", "40.0000"]);
    expect(ver(entrar(estado("0", "10"), q("10"), c("200")))).toEqual(["100.000000", "20.0000"]);
  });

  it("con cantidad valorizada en cero el promedio vigente no pesa: queda el costo de la entrada", () => {
    expect(ver(entrar(estado("100", "0"), q("4"), c("7.25")))).toEqual(["7.250000", "4.0000"]);
  });

  it("redondea UNA vez a 6 decimales y la mitad se aleja del cero (MITAD_SUBE_SIMETRICA)", () => {
    // (1 × 0,000002 + 1 × 0,000003) ÷ 2 = 0,0000025 → 0,000003 (con mitad al par daría 0,000002)
    expect(ver(entrar(estado("0.000002", "1"), q("1"), c("0.000003")))).toEqual([
      "0.000003",
      "2.0000",
    ]);
    // (1 × 1,000001 + 2 × 1,000002) ÷ 3 = 1,0000016666… → 1,000002
    expect(ver(entrar(estado("1.000001", "1"), q("2"), c("1.000002")))).toEqual([
      "1.000002",
      "3.0000",
    ]);
    // (1 × 1 + 2 × 2) ÷ 3 = 1,666666…7 → 1,666667
    expect(ver(entrar(estado("1", "1"), q("2"), c("2")))).toEqual(["1.666667", "3.0000"]);
    // (2 × 1 + 1 × 2) ÷ 3 = 1,333333…
    expect(ver(entrar(estado("1", "2"), q("1"), c("2")))).toEqual(["1.333333", "3.0000"]);
  });

  it("una entrada SIN costo no cambia nada: ni diluye el promedio ni vale cero", () => {
    const antes = estado("100", "10");
    expect(entrar(antes, q("10"), SIN_COSTO)).toBe(antes);
    expect(entrar(ESTADO_DE_COSTO_INICIAL, q("10"), SIN_COSTO)).toBe(ESTADO_DE_COSTO_INICIAL);
    // y la siguiente entrada con costo promedia solo contra lo que tiene costo
    const despues = entrar(entrar(antes, q("10"), SIN_COSTO), q("10"), c("200"));
    expect(ver(despues)).toEqual(["150.000000", "20.0000"]);
  });

  it("un costo declarado en cero es un costo (no es «sin costo»)", () => {
    expect(ver(entrar(ESTADO_DE_COSTO_INICIAL, q("5"), c("0")))).toEqual(["0.000000", "5.0000"]);
    expect(costoVigente(entrar(ESTADO_DE_COSTO_INICIAL, q("5"), c("0"))).estado).toBe("DEFINITIVO");
  });

  it("la cantidad en cero es un defecto: se lanza, con o sin costo", () => {
    const mensaje = /la cantidad tiene que ser mayor que cero/;
    expect(() => entrar(estado("1", "1"), q("0"), c("5"))).toThrow(mensaje);
    expect(() => entrar(ESTADO_DE_COSTO_INICIAL, q("0"), c("5"))).toThrow(mensaje);
    expect(() => entrar(ESTADO_DE_COSTO_INICIAL, q("0"), SIN_COSTO)).toThrow(mensaje);
  });

  it("lo que se sale de numeric(18,4) es un defecto: se lanza", () => {
    expect(() => entrar(estado("1", "99999999999999.9999"), q("0.0001"), c("1"))).toThrow();
    expect(ver(entrar(estado("1", "99999999999999.9998"), q("0.0001"), c("1")))).toEqual([
      "1.000000",
      "99999999999999.9999",
    ]);
  });
});

describe("salir", () => {
  it("congela el promedio vigente en el renglón y baja la cantidad valorizada sin tocar el promedio", () => {
    const r = salir(estado("150", "20"), q("5"));
    expect(verCosto(r.costo)).toBe("150.000000");
    expect(ver(r.estado)).toEqual(["150.000000", "15.0000"]);
  });

  it("piso 0: nunca queda negativa, aunque salga más de lo valorizado", () => {
    expect(ver(salir(estado("150", "3"), q("5")).estado)).toEqual(["150.000000", "0.0000"]);
    expect(ver(salir(estado("150", "5"), q("5")).estado)).toEqual(["150.000000", "0.0000"]);
    expect(ver(salir(estado("150", "5.0001"), q("5")).estado)).toEqual(["150.000000", "0.0001"]);
  });

  it("sin promedio el renglón queda SIN_COSTO y el estado igual", () => {
    const r = salir(ESTADO_DE_COSTO_INICIAL, q("5"));
    expect(r.costo).toBe(SIN_COSTO);
    expect(r.estado).toBe(ESTADO_DE_COSTO_INICIAL);
  });

  it("con costo congelado explícito usa ESE costo (no el vigente) y baja la cantidad valorizada", () => {
    const r = salir(estado("150", "20"), q("5"), c("200"));
    expect(verCosto(r.costo)).toBe("200.000000");
    expect(ver(r.estado)).toEqual(["150.000000", "15.0000"]);
  });

  it("con SIN_COSTO explícito el estado queda igual aunque haya promedio (lo que entró sin costo no sumó a lo valorizado)", () => {
    const antes = estado("150", "20");
    const r = salir(antes, q("5"), SIN_COSTO);
    expect(r.costo).toBe(SIN_COSTO);
    expect(r.estado).toBe(antes);
  });

  it("la cantidad en cero es un defecto: se lanza", () => {
    const mensaje = /la cantidad tiene que ser mayor que cero/;
    expect(() => salir(estado("1", "1"), q("0"))).toThrow(mensaje);
    expect(() => salir(ESTADO_DE_COSTO_INICIAL, q("0"))).toThrow(mensaje);
  });
});

describe("transferir: lleva el costo de origen", () => {
  it("el destino incorpora lo que llega a su promedio y el origen baja", () => {
    const r = transferir(estado("100", "10"), estado("200", "10"), q("5"));
    expect(verCosto(r.costo)).toBe("100.000000");
    expect(ver(r.origen)).toEqual(["100.000000", "5.0000"]);
    // (10 × 200 + 5 × 100) ÷ 15 = 166,666666…7
    expect(ver(r.destino)).toEqual(["166.666667", "15.0000"]);
  });

  it("a un destino sin historia le fija el costo de origen", () => {
    const r = transferir(estado("100", "10"), ESTADO_DE_COSTO_INICIAL, q("4"));
    expect(ver(r.destino)).toEqual(["100.000000", "4.0000"]);
  });

  it("si el origen no tiene promedio, el renglón es SIN_COSTO y el destino no cambia", () => {
    const destino = estado("200", "10");
    const r = transferir(ESTADO_DE_COSTO_INICIAL, destino, q("4"));
    expect(r.costo).toBe(SIN_COSTO);
    expect(r.origen).toBe(ESTADO_DE_COSTO_INICIAL);
    expect(r.destino).toBe(destino);
  });
});

describe("el ajuste y la anulación se arman con las mismas dos piezas", () => {
  it("un ajuste que suma entra al promedio vigente: no lo mueve y suma a lo valorizado", () => {
    const e = estado("123.456789", "10");
    expect(ver(entrar(e, q("3"), costoVigente(e)))).toEqual(["123.456789", "13.0000"]);
  });

  it("anular una entrada saca lo que entró con SU costo; el promedio no vuelve a un punto anterior", () => {
    const luego = entrar(estado("100", "10"), q("10"), c("200")); // 150, 20
    const r = salir(luego, q("10"), c("200"));
    expect(verCosto(r.costo)).toBe("200.000000");
    expect(ver(r.estado)).toEqual(["150.000000", "10.0000"]);
  });

  it("anular una salida devuelve lo que salió con el costo que se congeló", () => {
    const s = salir(estado("150", "20"), q("5"));
    const r = entrar(s.estado, q("5"), s.costo);
    expect(ver(r)).toEqual(["150.000000", "20.0000"]);
  });
});

describe("corregirPromedio (fórmula A: la diferencia sobre lo que queda; lo consumido no se reescribe)", () => {
  const p = (t: string) => precioUnitarioDesdeTexto(t);
  const corregir = (
    e: EstadoDeCosto,
    c: { anterior: string | null; nuevo: string; entro: string; hay: string },
  ) =>
    corregirPromedio(e, {
      costoAnterior: c.anterior === null ? null : p(c.anterior),
      costoNuevo: p(c.nuevo),
      cantidadQueEntro: q(c.entro),
      existenciaActual: q(c.hay),
    });
  const verOk = (r: ReturnType<typeof corregirPromedio>) => {
    if (!r.ok) throw new Error(`error inesperado: ${r.error}`);
    return ver(r.valor);
  };

  it("con todo lo que entró todavía en el depósito, el promedio sube por la diferencia entera", () => {
    // 10 unidades a 100 (entraron 10, hay 10): costo corregido a 120 → el promedio pasa a 120.
    expect(
      verOk(
        corregir(estado("100", "10"), { anterior: "100", nuevo: "120", entro: "10", hay: "10" }),
      ),
    ).toEqual(["120.000000", "10.0000"]);
  });

  it("lo ya consumido no se reescribe: solo se corrige la parte que queda de la compra", () => {
    // Promedio 100 sobre 10 valorizadas; la compra era de 10 y quedan 4: +20 × 4 ÷ 10 = +8.
    expect(
      verOk(
        corregir(estado("100", "10"), { anterior: "100", nuevo: "120", entro: "10", hay: "4" }),
      ),
    ).toEqual(["108.000000", "10.0000"]);
  });

  it("lo que queda se acota a lo que entró con la compra aunque haya más existencia de otras compras", () => {
    // Entraron 5 de esa compra, hay 10 en total: +20 × 5 ÷ 10 = +10.
    expect(
      verOk(
        corregir(estado("100", "10"), { anterior: "100", nuevo: "120", entro: "5", hay: "10" }),
      ),
    ).toEqual(["110.000000", "10.0000"]);
  });

  it("lo que queda se acota a lo valorizado: la existencia sin costo no tiene qué corregir", () => {
    // Existencia 10, valorizadas 4: aplican 4 de las 10 que entraron → +20 × 4 ÷ 4 = +20.
    expect(
      verOk(
        corregir(estado("100", "4"), { anterior: "100", nuevo: "120", entro: "10", hay: "10" }),
      ),
    ).toEqual(["120.000000", "4.0000"]);
  });

  it("una corrección a la baja baja el promedio, con la política de redondeo vigente a 6 decimales", () => {
    expect(
      verOk(corregir(estado("100", "3"), { anterior: "100", nuevo: "90", entro: "1", hay: "1" })),
    ).toEqual(["96.666667", "3.0000"]);
    expect(
      verOk(corregir(estado("100", "3"), { anterior: "100", nuevo: "110", entro: "1", hay: "1" })),
    ).toEqual(["103.333333", "3.0000"]);
  });

  it("si no queda nada de la compra (todo consumido) o no hay unidades valorizadas, el estado no cambia", () => {
    const e = estado("100", "10");
    expect(corregir(e, { anterior: "100", nuevo: "120", entro: "10", hay: "0" })).toEqual({
      ok: true,
      valor: e,
    });
    expect(corregir(e, { anterior: "100", nuevo: "120", entro: "10", hay: "0" }).ok && true).toBe(
      true,
    );
    const sinValorizar = estado("100", "0");
    expect(
      corregir(sinValorizar, { anterior: "100", nuevo: "120", entro: "10", hay: "10" }),
    ).toEqual({ ok: true, valor: sinValorizar });
    expect(
      corregir(ESTADO_DE_COSTO_INICIAL, { anterior: "100", nuevo: "120", entro: "10", hay: "10" }),
    ).toEqual({ ok: true, valor: ESTADO_DE_COSTO_INICIAL });
  });

  it("una compra que entró sin costo: lo que queda entra al promedio con el costo nuevo", () => {
    expect(
      verOk(
        corregir(ESTADO_DE_COSTO_INICIAL, { anterior: null, nuevo: "50", entro: "10", hay: "6" }),
      ),
    ).toEqual(["50.000000", "6.0000"]);
    // Con promedio previo de otras compras y más existencia que lo que entró: quedan 10 de esta compra → (10 × 100 + 10 × 40) ÷ 20 = 70.
    expect(
      verOk(corregir(estado("100", "10"), { anterior: null, nuevo: "40", entro: "10", hay: "16" })),
    ).toEqual(["70.000000", "20.0000"]);
  });

  it("sin costo anterior y sin nada que quede, no cambia nada", () => {
    expect(
      corregir(ESTADO_DE_COSTO_INICIAL, { anterior: null, nuevo: "50", entro: "10", hay: "0" }),
    ).toEqual({ ok: true, valor: ESTADO_DE_COSTO_INICIAL });
  });

  it("COSTO_RESULTANTE_INVALIDO si la estimación deja el promedio en cero o negativo (no se aplica)", () => {
    // Promedio ya bajo (1) y una corrección de 100 a 1: -99 × 10 ÷ 10 → negativo.
    expect(
      corregir(estado("1", "10"), { anterior: "100", nuevo: "1", entro: "10", hay: "10" }),
    ).toEqual({ ok: false, error: "COSTO_RESULTANTE_INVALIDO" });
    // Justo en cero tampoco.
    expect(
      corregir(estado("99", "10"), { anterior: "100", nuevo: "1", entro: "10", hay: "10" }),
    ).toEqual({ ok: false, error: "COSTO_RESULTANTE_INVALIDO" });
    // Un microcosto positivo sí pasa.
    expect(
      verOk(
        corregir(estado("99.000001", "10"), {
          anterior: "100",
          nuevo: "1",
          entro: "10",
          hay: "10",
        }),
      ),
    ).toEqual(["0.000001", "10.0000"]);
  });
});
