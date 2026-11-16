import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { TIPO_DE_MEDIO_CON_VUELTO } from "../../../primitivas/dinero/vuelto";
import { TIPOS_DE_MEDIO } from "../../caja/publico";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  MAXIMO_DE_COBROS_POR_TICKET,
  cuadrarCobros,
  decidirCobrar,
  decidirPrecioDeLaVenta,
  huellaDeCobranza,
  normalizarCobros,
  type CobroPedido,
} from "./cobranza";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const cobro = (monto: string, medio = M1, cuenta: string | null = null): CobroPedido => ({
  medioDePagoId: medio,
  cuentaDeCobroId: cuenta,
  importe: { moneda: "ARS", monto },
});
const total = (t: string) => importeDesdeTexto(ARS, t);
const codigo = (r: { ok: boolean; error?: unknown }) => (r.ok ? "ok" : r.error);

describe("el vuelto y caja hablan del mismo tipo de medio", () => {
  it("el único tipo que da vuelto es uno de los tipos de medio de caja (si se renombra uno, esta prueba lo dice)", () => {
    expect(TIPOS_DE_MEDIO as readonly string[]).toContain(TIPO_DE_MEDIO_CON_VUELTO);
  });
});

describe("normalizarCobros", () => {
  it("acepta de 1 a 50 cobros válidos", () => {
    expect(normalizarCobros([cobro("10")]).ok).toBe(true);
    expect(
      normalizarCobros(Array.from({ length: MAXIMO_DE_COBROS_POR_TICKET }, () => cobro("1"))).ok,
    ).toBe(true);
  });
  it("ninguno o más de 50 es COBROS_INVALIDOS", () => {
    expect(codigo(normalizarCobros([]))).toBe("COBROS_INVALIDOS");
    expect(codigo(normalizarCobros(Array.from({ length: 51 }, () => cobro("1"))))).toBe(
      "COBROS_INVALIDOS",
    );
  });
  it("ids que no son uuid, moneda que no es ARS, importes mal escritos o en cero", () => {
    expect(codigo(normalizarCobros([cobro("1", "x")]))).toBe("IDENTIFICADOR_INVALIDO");
    expect(codigo(normalizarCobros([cobro("1", M1, "x")]))).toBe("IDENTIFICADOR_INVALIDO");
    expect(
      codigo(normalizarCobros([{ ...cobro("1"), importe: { moneda: "USD", monto: "1" } }])),
    ).toBe("MONEDA_NO_SOPORTADA");
    for (const malo of ["-100", "5400.000", "5,5", "1e3", "abc", "", "0", "0.00", "1000000000"]) {
      expect(codigo(normalizarCobros([cobro(malo)])), malo).toBe("IMPORTE_INVALIDO");
    }
  });
  it("deja los cobros en orden canónico: el orden del pedido no cuenta", () => {
    const a = normalizarCobros([cobro("20", M2), cobro("10", M1, C1), cobro("5", M1)]);
    const b = normalizarCobros([cobro("5", M1), cobro("20", M2), cobro("10", M1, C1)]);
    expect(a).toEqual(b);
    expect(
      a.ok &&
        a.valor.map(
          (c) =>
            `${c.medioDePagoId.slice(0, 2)}:${c.cuentaDeCobroId?.slice(0, 2) ?? "-"}:${importeATexto(c.importe)}`,
        ),
    ).toEqual(["11:-:5.00", "11:33:10.00", "22:-:20.00"]);
  });
  it("ordena los importes por valor, no por texto (9 antes que 10)", () => {
    const r = normalizarCobros([cobro("10"), cobro("9")]);
    expect(r.ok && r.valor.map((c) => importeATexto(c.importe))).toEqual(["9.00", "10.00"]);
  });
});

describe("cuadrarCobros (P3)", () => {
  const n = (...m: string[]) => {
    const r = normalizarCobros(m.map((x) => cobro(x)));
    if (!r.ok) throw new Error("cobros de prueba inválidos");
    return r.valor;
  };
  it("la suma exacta cuadra", () => {
    expect(cuadrarCobros(total("100"), n("60", "40")).ok).toBe(true);
    expect(cuadrarCobros(total("26.87"), n("26.87")).ok).toBe(true);
  });
  it("un centavo de menos o de más no cuadra y dice cuánto", () => {
    expect(cuadrarCobros(total("100"), n("99.99"))).toEqual({
      ok: false,
      error: { error: "COBRO_NO_CUADRA", falta: "0.01" },
    });
    expect(cuadrarCobros(total("100"), n("100.01"))).toEqual({
      ok: false,
      error: { error: "COBRO_NO_CUADRA", sobra: "0.01" },
    });
  });
  it("propiedad: cuadra si y solo si la suma en centavos es el total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 8_000_000 }),
        (cents, totalCents) => {
          const aTexto = (c: number) =>
            `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
          const r = cuadrarCobros(total(aTexto(totalCents)), n(...cents.map(aTexto)));
          expect(r.ok).toBe(cents.reduce((a, c) => a + c, 0) === totalCents);
        },
      ),
    );
  });
});

describe("huellaDeCobranza (P20)", () => {
  const base = { ticketId: "t", ejemplarId: "e", cajaId: "c" };
  const cobros = (...m: CobroPedido[]) => {
    const r = normalizarCobros(m);
    if (!r.ok) throw new Error("cobros de prueba inválidos");
    return r.valor;
  };
  it("no depende del orden de los cobros y es un sha256", () => {
    const h = huellaDeCobranza({ ...base, cobros: cobros(cobro("5"), cobro("20", M2)) });
    expect(huellaDeCobranza({ ...base, cobros: cobros(cobro("20", M2), cobro("5")) })).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("cualquier cambio cambia la huella", () => {
    const c = cobros(cobro("5"));
    const h = huellaDeCobranza({ ...base, cobros: c });
    expect(huellaDeCobranza({ ...base, ticketId: "x", cobros: c })).not.toBe(h);
    expect(huellaDeCobranza({ ...base, ejemplarId: "x", cobros: c })).not.toBe(h);
    expect(huellaDeCobranza({ ...base, cajaId: "x", cobros: c })).not.toBe(h);
    expect(huellaDeCobranza({ ...base, cobros: cobros(cobro("6")) })).not.toBe(h);
    expect(huellaDeCobranza({ ...base, cobros: cobros(cobro("5", M2)) })).not.toBe(h);
    expect(huellaDeCobranza({ ...base, cobros: cobros(cobro("5", M1, C1)) })).not.toBe(h);
    expect(huellaDeCobranza({ ...base, cobros: cobros(cobro("5"), cobro("5")) })).not.toBe(h);
  });
});

describe("datos del cobro (K7)", () => {
  const base = { ticketId: "t", ejemplarId: "e", cajaId: "c" };
  const conDatos = (monto: string, datos: CobroPedido["datos"], medio = M1): CobroPedido => ({
    ...cobro(monto, medio),
    datos,
  });
  const normalizados = (...m: CobroPedido[]) => {
    const r = normalizarCobros(m);
    if (!r.ok) throw new Error("cobros de prueba inválidos");
    return r.valor;
  };
  const huella = (...m: CobroPedido[]) => huellaDeCobranza({ ...base, cobros: normalizados(...m) });

  it("sin datos, con `{}` o con campos ausentes es el mismo pedido, con la huella de siempre (forma anterior a los datos)", () => {
    const h = huella(cobro("5"));
    expect(huella(conDatos("5", {}))).toBe(h);
    expect(huella(conDatos("5", undefined))).toBe(h);
    const anterior = createHash("sha256")
      .update(JSON.stringify(["t", "e", "c", [[M1, null, "5.00"]]]))
      .digest("hex");
    expect(h).toBe(anterior);
  });
  it("cada dato cambia la huella: otro cupón, otros últimos 4, otra marca, otras cuotas u otro DNI es otro pedido", () => {
    const datos = {
      cupon: "ZX-1",
      ultimos4: "4242",
      marcaDeTarjetaId: M2,
      cuotas: 3,
      dni: "30123456",
    };
    const h = huella(conDatos("5", datos));
    expect(h).not.toBe(huella(cobro("5")));
    for (const otro of [
      { cupon: "ZX-2" },
      { ultimos4: "1111" },
      { marcaDeTarjetaId: M1 },
      { cuotas: 6 },
      { dni: "30123457" },
    ]) {
      expect(huella(conDatos("5", { ...datos, ...otro }))).not.toBe(h);
    }
    // Quitar un dato también es otro pedido.
    const sinDni = {
      cupon: datos.cupon,
      ultimos4: datos.ultimos4,
      marcaDeTarjetaId: datos.marcaDeTarjetaId,
      cuotas: datos.cuotas,
    };
    expect(huella(conDatos("5", sinDni))).not.toBe(h);
  });
  it("el orden de los cobros no importa aunque solo se distingan por sus datos, ni el orden de las claves", () => {
    const a = conDatos("5", { cupon: "AAA", ultimos4: "1111" });
    const b = conDatos("5", { cupon: "BBB", ultimos4: "2222" });
    expect(huella(a, b)).toBe(huella(b, a));
    expect(huella(conDatos("5", { ultimos4: "1111", cupon: "AAA" }))).toBe(
      huella(conDatos("5", { cupon: "AAA", ultimos4: "1111" })),
    );
    expect(normalizados(a, b).map((c) => c.datos.cupon)).toEqual(
      normalizados(b, a).map((c) => c.datos.cupon),
    );
  });
  it("solo se recogen los cinco campos conocidos: una clave de más se ignora y no cambia la huella", () => {
    const extra = {
      cupon: "ZX-1",
      numeroDeTarjeta: "4509953566233704",
    } as unknown as CobroPedido["datos"];
    const [c] = normalizados(conDatos("5", extra));
    expect(c?.datos).toEqual({ cupon: "ZX-1" });
    expect(huella(conDatos("5", extra))).toBe(huella(conDatos("5", { cupon: "ZX-1" })));
  });
  it("lo que no es un objeto es COBROS_INVALIDOS; `null` y vacío en un campo se conservan para que caja los rechace como mal escritos", () => {
    for (const malo of ["texto", 7, null, ["x"]]) {
      expect(
        codigo(normalizarCobros([conDatos("5", malo as unknown as CobroPedido["datos"])])),
      ).toBe("COBROS_INVALIDOS");
    }
    const [c] = normalizados(conDatos("5", { cupon: "", dni: null as unknown as string }));
    expect(c?.datos).toEqual({ cupon: "", dni: null });
  });
});

describe("decidirCobrar", () => {
  const e = { ejemplarVigenteId: "e2", ejemplarId: "e2" };
  it("un ticket EMITIDO con el ejemplar vigente se cobra", () => {
    expect(decidirCobrar({ estadoDelTicket: "EMITIDO", ...e }).ok).toBe(true);
  });
  it("anulado, cobrado y cortesía no; y el ejemplar viejo tampoco", () => {
    expect(codigo(decidirCobrar({ estadoDelTicket: "ANULADO", ...e }))).toBe("TICKET_ANULADO");
    expect(codigo(decidirCobrar({ estadoDelTicket: "COBRADO", ...e }))).toBe("TICKET_YA_COBRADO");
    expect(codigo(decidirCobrar({ estadoDelTicket: "CORTESIA", ...e }))).toBe("TICKET_NO_COBRABLE");
    expect(
      codigo(
        decidirCobrar({ estadoDelTicket: "EMITIDO", ejemplarVigenteId: "e2", ejemplarId: "e1" }),
      ),
    ).toBe("EJEMPLAR_DESACTUALIZADO");
  });
  it("el estado manda sobre el ejemplar", () => {
    expect(
      codigo(
        decidirCobrar({ estadoDelTicket: "COBRADO", ejemplarVigenteId: "e2", ejemplarId: "e1" }),
      ),
    ).toBe("TICKET_YA_COBRADO");
  });
});

describe("decidirPrecioDeLaVenta (S-7)", () => {
  it("el mismo total sigue; otro es PRECIO_CAMBIO", () => {
    expect(
      decidirPrecioDeLaVenta({ totalActual: total("10"), totalEsperado: total("10.00") }).ok,
    ).toBe(true);
    expect(
      codigo(decidirPrecioDeLaVenta({ totalActual: total("10.01"), totalEsperado: total("10") })),
    ).toBe("PRECIO_CAMBIO");
    expect(
      codigo(decidirPrecioDeLaVenta({ totalActual: total("9.99"), totalEsperado: total("10") })),
    ).toBe("PRECIO_CAMBIO");
  });
});
