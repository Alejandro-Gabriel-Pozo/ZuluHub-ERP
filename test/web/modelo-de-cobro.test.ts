import { describe, expect, it } from "vitest";
import {
  DATOS_EN_ORDEN,
  SIN_DATOS,
  cambiarDeMedio,
  cambiarUnDato,
  datosPendientes,
  errorDeUnDato,
  esImporteValido,
  estadoDelCobro,
  lineaDeEstado,
  medioInicial,
  nombreDelMedio,
  pagoAdicional,
  pagoNuevo,
  pedidoDeCobro,
  pedidoDeVenderACuenta,
  resumenDelCobro,
  textoDelErrorDeDato,
  type MedioParaCobrar,
  type PagoEnEdicion,
  type VentaCobrada,
} from "../../apps/web/ui/plantillas/cobrar/modelo-de-cobro";
import {
  rotuloDelTicket,
  rotuloDeUnDato,
  textosDeCobrar,
} from "../../apps/web/ui/plantillas/cobrar/textos-de-cobrar";
import {
  comoVentaCobrada,
  superaElLimite,
  type ClienteElegidoAlVender,
} from "../../apps/web/ui/plantillas/cobrar/modelo-de-vender-a-cuenta";
import { MAXIMO_DE_COBROS_POR_TICKET } from "../../src/primitivas/dinero/limites-de-cobro";
import type { LineaDeLaVenta } from "../../apps/web/ui/plantillas/venta/modelo-de-la-cuenta";

const nada = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
const EFECTIVO: MedioParaCobrar = {
  id: "m-efectivo",
  tipo: "EFECTIVO",
  nombre: null,
  cuentas: [],
  datosQuePide: nada,
  datosQueSePiden: nada,
};
const DEBITO: MedioParaCobrar = {
  id: "m-debito",
  tipo: "TARJETA_DEBITO",
  nombre: null,
  cuentas: [{ id: "c-posnet", tipo: "TERMINAL", nombre: "Posnet 1" }],
  datosQuePide: { ...nada, cupon: true, ultimos4: true, marca: true },
  datosQueSePiden: nada,
};
const CREDITO: MedioParaCobrar = {
  id: "m-credito",
  tipo: "TARJETA_CREDITO",
  nombre: "Visa crédito",
  cuentas: [{ id: "c-posnet", tipo: "TERMINAL", nombre: "Posnet 1" }],
  datosQuePide: { cupon: true, ultimos4: true, marca: true, cuotas: true, dni: false },
  datosQueSePiden: nada,
};
const TRANSFERENCIA: MedioParaCobrar = {
  id: "m-transf",
  tipo: "TRANSFERENCIA",
  nombre: null,
  cuentas: [],
  datosQuePide: { ...nada, dni: true },
  datosQueSePiden: nada,
};
const MEDIOS = [EFECTIVO, DEBITO, CREDITO, TRANSFERENCIA];
const TOTAL = { moneda: "ARS", monto: "1500.00" };

const pago = (medio: MedioParaCobrar, importe: string, clave = medio.id): PagoEnEdicion =>
  pagoNuevo(clave, medio.id, importe);

describe("errorDeUnDato", () => {
  it("vacío es válido en todos los datos (ninguno bloquea)", () => {
    for (const dato of DATOS_EN_ORDEN) expect(errorDeUnDato(dato, "")).toBeNull();
  });

  it("cupón: válido, con forma incorrecta y número de tarjeta", () => {
    expect(errorDeUnDato("cupon", "A-123")).toBeNull();
    expect(errorDeUnDato("cupon", "A 123")).toBe("CUPON_INVALIDO");
    expect(errorDeUnDato("cupon", "A#1")).toBe("CUPON_INVALIDO");
    expect(errorDeUnDato("cupon", "4509953566233704")).toBe("CUPON_ES_TARJETA");
    expect(errorDeUnDato("cupon", "4509-9535-6623-3704")).toBe("CUPON_ES_TARJETA");
  });

  it("últimos 4: exactamente 4 dígitos, con ceros", () => {
    expect(errorDeUnDato("ultimos4", "0042")).toBeNull();
    for (const malo of ["123", "12345", "12a4", " 123"]) {
      expect(errorDeUnDato("ultimos4", malo), malo).toBe("ULTIMOS4");
    }
  });

  it("cuotas: de 1 a 36, sin ceros a la izquierda ni decimales", () => {
    expect(errorDeUnDato("cuotas", "1")).toBeNull();
    expect(errorDeUnDato("cuotas", "36")).toBeNull();
    for (const malo of ["0", "37", "01", "1.5", "-1", "doce"]) {
      expect(errorDeUnDato("cuotas", malo), malo).toBe("CUOTAS");
    }
  });

  it("DNI: solo dígitos, sin puntos, de 6 a 9", () => {
    expect(errorDeUnDato("dni", "30123456")).toBeNull();
    for (const malo of ["12345", "1234567890", "30.123.456", "3012345a"]) {
      expect(errorDeUnDato("dni", malo), malo).toBe("DNI");
    }
  });

  it("la marca se elige de una lista: no se escribe, no hay forma de escribirla mal", () => {
    expect(errorDeUnDato("marca", "lo-que-sea")).toBeNull();
  });
});

describe("textoDelErrorDeDato", () => {
  it("dice los textos aprobados y el tope de cuotas sale de la primitiva", () => {
    expect(textoDelErrorDeDato("CUPON_ES_TARJETA")).toBe(
      "El cupón no puede ser un número de tarjeta",
    );
    expect(textoDelErrorDeDato("CUPON_INVALIDO")).toBe("El cupón tiene caracteres no permitidos");
    expect(textoDelErrorDeDato("ULTIMOS4")).toBe("Escribí 4 dígitos");
    expect(textoDelErrorDeDato("CUOTAS")).toBe("Escribí cuotas de 1 a 36");
    expect(textoDelErrorDeDato("DNI")).toBe("El DNI no es válido");
  });
  it("el rótulo lleva «(opcional)»", () => {
    expect(rotuloDeUnDato("Cupón", textosDeCobrar().opcional)).toBe("Cupón (opcional)");
  });
});

describe("el medio de una fila", () => {
  it("el medio inicial es el efectivo; sin efectivo, el primero; sin medios, ninguno", () => {
    expect(medioInicial([DEBITO, EFECTIVO])).toBe(EFECTIVO);
    expect(medioInicial([DEBITO, CREDITO])).toBe(DEBITO);
    expect(medioInicial([])).toBeNull();
  });

  it("el nombre es el propio o el del tipo", () => {
    expect(nombreDelMedio(CREDITO)).toBe("Visa crédito");
    expect(nombreDelMedio(EFECTIVO)).toBe("Efectivo");
    expect(nombreDelMedio(DEBITO)).toBe("Tarjeta de débito");
  });

  it("al cambiar de medio se descarta lo que el nuevo no admite y se conserva lo que admite", () => {
    let p = pago(CREDITO, "1500.00");
    for (const [dato, valor] of [
      ["cupon", "A1"],
      ["ultimos4", "0042"],
      ["marca", "visa"],
      ["cuotas", "3"],
    ] as const) {
      p = cambiarUnDato(p, dato, valor);
    }
    p = { ...p, cuentaId: "c-posnet" };
    const aDebito = cambiarDeMedio(p, DEBITO);
    expect(aDebito.medioId).toBe(DEBITO.id);
    expect(aDebito.datos).toEqual({
      cupon: "A1",
      ultimos4: "0042",
      marca: "visa",
      cuotas: "",
      dni: "",
    });
    expect(aDebito.cuentaId).toBe("c-posnet");
    const aEfectivo = cambiarDeMedio(p, EFECTIVO);
    expect(aEfectivo.datos).toEqual(SIN_DATOS);
    expect(aEfectivo.cuentaId).toBe("");
    expect(cambiarDeMedio(p, TRANSFERENCIA).datos).toEqual(SIN_DATOS);
  });

  it("cambiar un dato no toca los demás ni la fila original", () => {
    const original = pago(DEBITO, "10.00");
    const nuevo = cambiarUnDato(original, "cupon", "X");
    expect(nuevo.datos.cupon).toBe("X");
    expect(original.datos.cupon).toBe("");
    expect(nuevo.importe).toBe("10.00");
  });
});

describe("esImporteValido", () => {
  it("forma de importe y mayor que cero", () => {
    for (const bien of ["1", "0.01", "1500.50", "999999999.99"])
      expect(esImporteValido(bien), bien).toBe(true);
    for (const mal of ["", "0", "0.00", "00.00", "-1", "1,5", "1.234", "1000000000", "abc"]) {
      expect(esImporteValido(mal), mal).toBe(false);
    }
  });
});

describe("datosPendientes (lo que «se pide» y quedó vacío; informativo, no bloquea)", () => {
  const sePideCuotas: MedioParaCobrar = {
    ...CREDITO,
    datosQueSePiden: { ...nada, cuotas: true, dni: true },
  };
  it("pedido y vacío → pendiente; solo espacios → pendiente; completo → no", () => {
    expect(datosPendientes(sePideCuotas, pago(sePideCuotas, "1500.00"))).toEqual(["cuotas"]);
    expect(
      datosPendientes(sePideCuotas, cambiarUnDato(pago(sePideCuotas, "1500.00"), "cuotas", "   ")),
    ).toEqual(["cuotas"]);
    expect(
      datosPendientes(sePideCuotas, cambiarUnDato(pago(sePideCuotas, "1500.00"), "cuotas", "3")),
    ).toEqual([]);
  });
  it("un dato que el medio no pide nunca es pendiente, aunque esté marcado; sin medio, nada", () => {
    expect(datosPendientes(CREDITO, pago(CREDITO, "1500.00"))).toEqual([]);
    expect(datosPendientes(undefined, pago(CREDITO, "1500.00"))).toEqual([]);
  });
  it("un dato mal escrito no es «pendiente»: es un error de forma y sí apaga el cobro", () => {
    const mal = cambiarUnDato(pago(sePideCuotas, "1500.00"), "cuotas", "99");
    expect(datosPendientes(sePideCuotas, mal)).toEqual([]);
    expect(estadoDelCobro(TOTAL, [mal], [sePideCuotas]).listo).toBe(false);
  });
  it("«Cobrar» NO se apaga por un dato pedido y vacío: listo depende solo del importe y de datos bien escritos", () => {
    const vacio = pago(sePideCuotas, "1500.00");
    expect(datosPendientes(sePideCuotas, vacio)).toEqual(["cuotas"]);
    expect(estadoDelCobro(TOTAL, [vacio], [sePideCuotas]).listo).toBe(true);
  });
});

describe("estadoDelCobro", () => {
  it("un medio por el total justo: listo, cobro completo", () => {
    const e = estadoDelCobro(TOTAL, [pago(EFECTIVO, "1500.00")], MEDIOS);
    expect(e.listo).toBe(true);
    expect(e.vuelto).toMatchObject({ falta: "0.00", sobra: "0.00", vuelto: "0.00" });
    expect(lineaDeEstado(e.vuelto)).toEqual({ tipo: "COMPLETO" });
  });

  it("falta cobrar: no está listo y dice cuánto", () => {
    const e = estadoDelCobro(TOTAL, [pago(EFECTIVO, "1000.00")], MEDIOS);
    expect(e.listo).toBe(false);
    expect(lineaDeEstado(e.vuelto)).toEqual({ tipo: "FALTA", importe: "500.00" });
  });

  it("efectivo de más: vuelto, listo, y el neto es lo que queda en caja", () => {
    const e = estadoDelCobro(TOTAL, [pago(EFECTIVO, "2000.00")], MEDIOS);
    expect(e.listo).toBe(true);
    expect(e.vuelto).toMatchObject({ vuelto: "500.00", netoEnEfectivo: "1500.00" });
    expect(lineaDeEstado(e.vuelto)).toEqual({ tipo: "VUELTO", importe: "500.00" });
  });

  it("de más con otro medio: sobran, no está listo (no se paga de más sin efectivo)", () => {
    const e = estadoDelCobro(TOTAL, [pago(DEBITO, "2000.00")], MEDIOS);
    expect(e.listo).toBe(false);
    expect(lineaDeEstado(e.vuelto)).toEqual({ tipo: "SOBRA", importe: "500.00" });
  });

  it("dividido entre tarjeta y efectivo, con vuelto, queda listo", () => {
    const e = estadoDelCobro(TOTAL, [pago(DEBITO, "1000.00"), pago(EFECTIVO, "1000.00")], MEDIOS);
    expect(e.listo).toBe(true);
    expect(e.vuelto).toMatchObject({ vuelto: "500.00", netoEnEfectivo: "500.00" });
  });

  it("un importe vacío o en cero marca la fila, no hay cuenta y no está listo", () => {
    for (const importe of ["", "0.00"]) {
      const e = estadoDelCobro(TOTAL, [pago(EFECTIVO, importe)], MEDIOS);
      expect(e.listo).toBe(false);
      expect(e.vuelto).toBeNull();
      expect(e.filas[0]?.importeNoValido).toBe(true);
      expect(lineaDeEstado(e.vuelto)).toBeNull();
    }
    const bien = estadoDelCobro(TOTAL, [pago(EFECTIVO, "1500.00")], MEDIOS);
    expect(bien.filas[0]?.importeNoValido).toBe(false);
  });

  it("un medio que el servidor no ofreció no se cobra", () => {
    const e = estadoDelCobro(TOTAL, [pagoNuevo("x", "otro-medio", "1500.00")], MEDIOS);
    expect(e.listo).toBe(false);
    expect(e.vuelto).toBeNull();
  });

  it("sin filas, o con más cobros que el tope, no está listo", () => {
    expect(estadoDelCobro(TOTAL, [], MEDIOS).listo).toBe(false);
    const muchos = Array.from({ length: MAXIMO_DE_COBROS_POR_TICKET + 1 }, (_, i) =>
      pago(EFECTIVO, "1.00", `f${String(i)}`),
    );
    expect(estadoDelCobro({ moneda: "ARS", monto: "51.00" }, muchos, MEDIOS).listo).toBe(false);
    const justo = Array.from({ length: MAXIMO_DE_COBROS_POR_TICKET }, (_, i) =>
      pago(EFECTIVO, "1.00", `f${String(i)}`),
    );
    expect(estadoDelCobro({ moneda: "ARS", monto: "50.00" }, justo, MEDIOS).listo).toBe(true);
  });

  it("un dato mal escrito de un dato que el medio admite impide cobrar; uno que no admite no cuenta", () => {
    let p = cambiarUnDato(pago(DEBITO, "1500.00"), "ultimos4", "12");
    let e = estadoDelCobro(TOTAL, [p], MEDIOS);
    expect(e.listo).toBe(false);
    expect(e.filas[0]?.erroresDeDatos).toEqual({ ultimos4: "ULTIMOS4" });
    // Las cuotas son solo del crédito: en débito no se juzgan (la pantalla ni las ofrece).
    p = cambiarUnDato(pago(DEBITO, "1500.00"), "cuotas", "99");
    e = estadoDelCobro(TOTAL, [p], MEDIOS);
    expect(e.listo).toBe(true);
    expect(e.filas[0]?.erroresDeDatos).toEqual({});
    // Corregido o vaciado, vuelve a poder cobrar.
    p = cambiarUnDato(pago(DEBITO, "1500.00"), "ultimos4", "");
    expect(estadoDelCobro(TOTAL, [p], MEDIOS).listo).toBe(true);
  });

  it("cada dato del crédito se juzga con su regla", () => {
    let p = pago(CREDITO, "1500.00");
    p = cambiarUnDato(
      cambiarUnDato(cambiarUnDato(p, "cupon", "4509953566233704"), "cuotas", "40"),
      "ultimos4",
      "1",
    );
    expect(estadoDelCobro(TOTAL, [p], MEDIOS).filas[0]?.erroresDeDatos).toEqual({
      cupon: "CUPON_ES_TARJETA",
      ultimos4: "ULTIMOS4",
      cuotas: "CUOTAS",
    });
    const t = cambiarUnDato(pago(TRANSFERENCIA, "1500.00"), "dni", "123");
    expect(estadoDelCobro(TOTAL, [t], MEDIOS).filas[0]?.erroresDeDatos).toEqual({ dni: "DNI" });
  });
});

describe("más casos de borde", () => {
  it("una fila nueva no está tocada", () => {
    expect(pagoNuevo("a", EFECTIVO.id, "1.00").tocado).toBe(false);
  });

  it("al cambiar de medio la cuenta se conserva solo si es una de las del medio nuevo", () => {
    const otraCuenta: MedioParaCobrar = {
      ...CREDITO,
      id: "m-otro",
      cuentas: [{ id: "c-otra", tipo: "TERMINAL", nombre: "Otra" }],
    };
    const p = { ...pago(DEBITO, "1.00"), cuentaId: "c-posnet" };
    expect(cambiarDeMedio(p, otraCuenta).cuentaId).toBe("");
    expect(cambiarDeMedio(p, CREDITO).cuentaId).toBe("c-posnet");
  });

  it("con dos filas, una inválida, no hay cuenta ni está listo", () => {
    const e = estadoDelCobro(
      TOTAL,
      [pago(EFECTIVO, "1500.00", "a"), pago(DEBITO, "", "b")],
      MEDIOS,
    );
    expect(e.vuelto).toBeNull();
    expect(e.listo).toBe(false);
  });

  it("con dos filas, una con un dato mal escrito, no está listo", () => {
    const mala = cambiarUnDato(pago(DEBITO, "500.00", "b"), "ultimos4", "1");
    const e = estadoDelCobro(TOTAL, [pago(EFECTIVO, "1000.00", "a"), mala], MEDIOS);
    expect(e.listo).toBe(false);
    expect(e.filas[0]?.erroresDeDatos).toEqual({});
  });

  it("con una fila válida y otra de un medio desconocido no hay cuenta", () => {
    const e = estadoDelCobro(
      TOTAL,
      [pago(EFECTIVO, "1000.00", "a"), pagoNuevo("x", "otro", "500.00")],
      MEDIOS,
    );
    expect(e.vuelto).toBeNull();
    expect(e.listo).toBe(false);
  });

  it("un medio desconocido no tiene datos que juzgar", () => {
    const e = estadoDelCobro(TOTAL, [pagoNuevo("x", "otro", "1500.00")], MEDIOS);
    expect(Object.keys(e.filas[0]?.erroresDeDatos ?? { x: 1 })).toEqual([]);
  });

  it("con la tarjeta primero y el efectivo después, el efectivo viaja por su neto", () => {
    const pagos = [pago(DEBITO, "1000.00", "a"), pago(EFECTIVO, "800.00", "b")];
    const e = estadoDelCobro(TOTAL, pagos, MEDIOS);
    if (e.vuelto === null) throw new Error("sin cuenta");
    const pedido = pedidoDeCobro({
      ids: { cuentaId: "c", ejemplarId: "e", lineas: new Map([["l", "x"]]) },
      cajaId: "caja",
      cuenta: [
        {
          clave: "l",
          productoId: "p",
          varianteId: null,
          opcionIds: [],
          cantidad: 10_000,
          revision: 0,
        },
      ],
      total: TOTAL,
      pagos,
      medios: MEDIOS,
      vuelto: e.vuelto,
    });
    expect(
      (pedido?.["cobros"] as { importe: { monto: string } }[]).map((c) => c.importe.monto),
    ).toEqual(["1000.00", "500.00"]);
  });

  it("el resumen toma la cuenta que corresponde entre varias", () => {
    const medio: MedioParaCobrar = {
      ...DEBITO,
      cuentas: [
        { id: "c-1", tipo: "TERMINAL", nombre: "Posnet 1" },
        { id: "c-2", tipo: "TERMINAL", nombre: "Posnet 2" },
      ],
    };
    const venta: VentaCobrada = {
      ticketId: "t",
      ejemplarId: "e",
      numero: 1,
      estado: "COBRADO",
      total: TOTAL,
      cobros: [
        {
          medioDePagoId: medio.id,
          cuentaDeCobroId: "c-2",
          importe: { moneda: "ARS", monto: "1.00" },
        },
      ],
    };
    expect(resumenDelCobro(venta, [medio])[0]?.rotulo).toBe("Tarjeta de débito · Posnet 2");
  });
});

describe("pagoAdicional", () => {
  it("elige un medio que todavía no se usa y propone lo que falta", () => {
    const otro = pagoAdicional("n", MEDIOS, [pago(EFECTIVO, "1000.00")], "500.00");
    expect(otro).toMatchObject({ clave: "n", medioId: DEBITO.id, importe: "500.00" });
  });
  it("con todos usados repite el inicial; sin falta, importe vacío", () => {
    const todos = MEDIOS.map((m) => pago(m, "1.00"));
    expect(pagoAdicional("n", MEDIOS, todos, "0.00")).toMatchObject({
      medioId: EFECTIVO.id,
      importe: "",
    });
    expect(pagoAdicional("n", MEDIOS, [pago(EFECTIVO, "1.00")], null)?.importe).toBe("");
  });
  it("con dos medios ya usados elige uno que no se usa", () => {
    const usados = [pago(EFECTIVO, "1.00"), pago(DEBITO, "1.00")];
    expect(pagoAdicional("n", MEDIOS, usados, "5.00")?.medioId).toBe(CREDITO.id);
  });
  it("sin medios no hay fila", () => {
    expect(pagoAdicional("n", [], [], "1.00")).toBeNull();
  });
});

describe("pedidoDeCobro", () => {
  const cuenta: readonly LineaDeLaVenta[] = [
    {
      clave: "l1",
      productoId: "p1",
      varianteId: null,
      opcionIds: [],
      cantidad: 20_000,
      revision: 0,
    },
    {
      clave: "l2",
      productoId: "p2",
      varianteId: "v1",
      opcionIds: ["o1", "o2"],
      cantidad: 5_000,
      revision: 0,
    },
  ];
  const ids = {
    cuentaId: "cuenta-1",
    ejemplarId: "ejemplar-1",
    lineas: new Map([
      ["l1", "linea-1"],
      ["l2", "linea-2"],
    ]),
  };
  const armar = (
    pagos: readonly PagoEnEdicion[],
    medios = MEDIOS,
    confirmaciones?: readonly string[],
  ) => {
    const e = estadoDelCobro(TOTAL, pagos, medios);
    if (e.vuelto === null) throw new Error("sin cuenta");
    return pedidoDeCobro({
      ids,
      cajaId: "caja-1",
      cuenta,
      total: TOTAL,
      pagos,
      medios,
      vuelto: e.vuelto,
      confirmaciones,
    });
  };

  it("las confirmaciones viajan solo si la persona confirmó: sin ellas el pedido no trae la clave", () => {
    expect(armar([pago(EFECTIVO, "1500.00")])).not.toHaveProperty("confirmaciones");
    expect(armar([pago(EFECTIVO, "1500.00")], MEDIOS, ["VENTA_A_CERO"])).toMatchObject({
      confirmaciones: ["VENTA_A_CERO"],
    });
  });

  it("arma el pedido: ids, líneas con la cantidad como texto, total esperado y la caja", () => {
    expect(armar([pago(EFECTIVO, "1500.00")])).toEqual({
      cuentaId: "cuenta-1",
      ejemplarId: "ejemplar-1",
      lineas: [
        { lineaId: "linea-1", productoId: "p1", opcionIds: [], cantidad: "2" },
        {
          lineaId: "linea-2",
          productoId: "p2",
          varianteId: "v1",
          opcionIds: ["o1", "o2"],
          cantidad: "0.5",
        },
      ],
      totalEsperado: { moneda: "ARS", monto: "1500.00" },
      cajaId: "caja-1",
      cobros: [
        {
          medioDePagoId: EFECTIVO.id,
          cuentaDeCobroId: null,
          importe: { moneda: "ARS", monto: "1500.00" },
        },
      ],
    });
  });

  it("no lleva la clave de idempotencia: la pone el envío en cada intento", () => {
    expect(armar([pago(EFECTIVO, "1500.00")])).not.toHaveProperty("claveIdempotencia");
  });

  it("el efectivo viaja por el NETO (lo entregado menos el vuelto), no por lo que entregó el cliente", () => {
    const pedido = armar([pago(EFECTIVO, "2000.00")]);
    expect(pedido?.["cobros"]).toEqual([
      {
        medioDePagoId: EFECTIVO.id,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "1500.00" },
      },
    ]);
  });

  it("varias filas de efectivo se juntan en la primera con el neto", () => {
    const pedido = armar([
      pago(EFECTIVO, "1000.00", "a"),
      pago(DEBITO, "500.00", "b"),
      pago(EFECTIVO, "1000.00", "c"),
    ]);
    expect(pedido?.["cobros"]).toEqual([
      {
        medioDePagoId: EFECTIVO.id,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "1000.00" },
      },
      {
        medioDePagoId: DEBITO.id,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "500.00" },
      },
    ]);
  });

  it("si el neto en efectivo es cero, no va ningún cobro de efectivo", () => {
    const pedido = armar([pago(DEBITO, "1500.00"), pago(EFECTIVO, "300.00")]);
    expect(pedido?.["cobros"]).toEqual([
      {
        medioDePagoId: DEBITO.id,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "1500.00" },
      },
    ]);
  });

  it("la cuenta y los datos escritos viajan; las cuotas, como número; lo vacío o no admitido, no", () => {
    let p = { ...pago(CREDITO, "1500.00"), cuentaId: "c-posnet" };
    p = cambiarUnDato(
      cambiarUnDato(cambiarUnDato(p, "cupon", "A1"), "marca", "visa-id"),
      "cuotas",
      "6",
    );
    // Un DNI que quedó escrito pero el crédito no admite no viaja.
    p = { ...p, datos: { ...p.datos, dni: "30123456" } };
    const pedido = armar([p]);
    expect(pedido?.["cobros"]).toEqual([
      {
        medioDePagoId: CREDITO.id,
        cuentaDeCobroId: "c-posnet",
        importe: { moneda: "ARS", monto: "1500.00" },
        datos: { cupon: "A1", marcaDeTarjetaId: "visa-id", cuotas: 6 },
      },
    ]);
  });

  it("el DNI de una transferencia viaja como texto sin puntos", () => {
    const pedido = armar([cambiarUnDato(pago(TRANSFERENCIA, "1500.00"), "dni", "30123456")]);
    expect(pedido?.["cobros"]).toEqual([
      {
        medioDePagoId: TRANSFERENCIA.id,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "1500.00" },
        datos: { dni: "30123456" },
      },
    ]);
  });

  it("un medio que no se ofreció, una línea sin id o una cuenta vacía: no hay pedido (nunca uno a medias)", () => {
    const e = estadoDelCobro(TOTAL, [pago(EFECTIVO, "1500.00")], MEDIOS);
    const vuelto = e.vuelto;
    if (vuelto === null) throw new Error("sin cuenta");
    const base = { ids, cajaId: "caja-1", cuenta, total: TOTAL, vuelto };
    expect(
      pedidoDeCobro({ ...base, pagos: [pagoNuevo("x", "otro", "1500.00")], medios: MEDIOS }),
    ).toBeNull();
    expect(
      pedidoDeCobro({
        ...base,
        pagos: [pago(EFECTIVO, "1500.00")],
        medios: MEDIOS,
        ids: { ...ids, lineas: new Map([["l1", "linea-1"]]) },
      }),
    ).toBeNull();
    expect(
      pedidoDeCobro({ ...base, pagos: [pago(EFECTIVO, "1500.00")], medios: MEDIOS, cuenta: [] }),
    ).toBeNull();
    expect(pedidoDeCobro({ ...base, pagos: [], medios: MEDIOS })).toBeNull();
  });
});

describe("resumenDelCobro", () => {
  const venta: VentaCobrada = {
    ticketId: "t1",
    ejemplarId: "e1",
    numero: 12,
    estado: "COBRADO",
    total: TOTAL,
    cobros: [
      {
        medioDePagoId: EFECTIVO.id,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "500.00" },
      },
      {
        medioDePagoId: DEBITO.id,
        cuentaDeCobroId: "c-posnet",
        importe: { moneda: "ARS", monto: "1000.00" },
      },
      {
        medioDePagoId: "ya-no-esta",
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "1.00" },
      },
    ],
  };
  it("cada cobro con su medio y su cuenta, en el orden del servidor; un medio que ya no está no se esconde", () => {
    expect(resumenDelCobro(venta, MEDIOS)).toEqual([
      { rotulo: "Efectivo", monto: "500.00" },
      { rotulo: "Tarjeta de débito · Posnet 1", monto: "1000.00" },
      { rotulo: "", monto: "1.00" },
    ]);
  });
  it("el rótulo del ticket", () => {
    expect(rotuloDelTicket(12)).toBe("Ticket N.º 12");
  });
});

describe("textosDeCobrar", () => {
  it("todos los textos están resueltos y ninguno queda con un marcador sin llenar", () => {
    const textos = textosDeCobrar();
    for (const [nombre, valor] of Object.entries(textos)) {
      expect(valor, nombre).not.toBe("");
      expect(valor, nombre).not.toMatch(/\{[a-z]+\}/i);
    }
    expect(textos.cobrar).toBe("Cobrar");
    expect(textos.nuevaVenta).toBe("Nueva venta");
    expect(textos.noPermitido).toBe("Esta acción no está permitida");
  });
});

describe("pedidoDeVenderACuenta (CC-5 B1b)", () => {
  const cuenta: readonly LineaDeLaVenta[] = [
    {
      clave: "l1",
      productoId: "p1",
      varianteId: null,
      opcionIds: [],
      cantidad: 20_000,
      revision: 0,
    },
    {
      clave: "l2",
      productoId: "p2",
      varianteId: "v1",
      opcionIds: ["o1"],
      cantidad: 5_000,
      revision: 0,
    },
  ];
  const ids = {
    cuentaId: "cuenta-1",
    ejemplarId: "ejemplar-1",
    lineas: new Map([
      ["l1", "linea-1"],
      ["l2", "linea-2"],
    ]),
  };
  const total = { moneda: "ARS", monto: "1500.00" };

  it("lleva la cuenta, el ejemplar, el cliente, las líneas y el total que se vio; NO lleva caja, cobros ni aprobación del exceso", () => {
    const pedido = pedidoDeVenderACuenta({ ids, clienteId: "c-1", cuenta, total });
    expect(pedido).toEqual({
      cuentaId: "cuenta-1",
      ejemplarId: "ejemplar-1",
      clienteId: "c-1",
      lineas: [
        { lineaId: "linea-1", productoId: "p1", opcionIds: [], cantidad: "2" },
        {
          lineaId: "linea-2",
          productoId: "p2",
          varianteId: "v1",
          opcionIds: ["o1"],
          cantidad: "0.5",
        },
      ],
      totalEsperado: { moneda: "ARS", monto: "1500.00" },
    });
    const claves = Object.keys(pedido ?? {});
    for (const prohibida of ["cajaId", "cobros", "aprobacionDelExceso", "sucursalId"]) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it("la confirmación de venta a $ 0 viaja solo si se pasó", () => {
    expect(pedidoDeVenderACuenta({ ids, clienteId: "c-1", cuenta, total })).not.toHaveProperty(
      "confirmaciones",
    );
    expect(
      pedidoDeVenderACuenta({ ids, clienteId: "c-1", cuenta, total, confirmaciones: ["X"] }),
    ).toMatchObject({ confirmaciones: ["X"] });
  });

  it("la mesa (cuenta que ya existe) no lleva líneas", () => {
    const pedido = pedidoDeVenderACuenta({
      ids,
      clienteId: "c-1",
      cuenta: [],
      total,
      sinLineas: true,
    });
    expect(pedido).toEqual({
      cuentaId: "cuenta-1",
      ejemplarId: "ejemplar-1",
      clienteId: "c-1",
      totalEsperado: { moneda: "ARS", monto: "1500.00" },
    });
  });

  it("una línea sin su id, o una cuenta vacía en el mostrador, no arma un pedido a medias", () => {
    expect(
      pedidoDeVenderACuenta({
        ids: { ...ids, lineas: new Map([["l1", "linea-1"]]) },
        clienteId: "c-1",
        cuenta,
        total,
      }),
    ).toBeNull();
    expect(pedidoDeVenderACuenta({ ids, clienteId: "c-1", cuenta: [], total })).toBeNull();
  });
});

describe("modelo de vender a cuenta (CC-5 B1b)", () => {
  const importe = (monto: string) => ({ moneda: "ARS", monto });
  const cliente = (excedeEn: string | null): ClienteElegidoAlVender => ({
    nombre: "Agencia",
    cuit: null,
    estado: "HABILITADA",
    saldo: importe("0.00"),
    disponible: importe("100.00"),
    excedido: false,
    puedeAprobarElExceso: false,
    saldoDespues: importe("10.00"),
    excedeEn: excedeEn === null ? null : importe(excedeEn),
  });

  it("supera el límite solo si el servidor dice que excede en más de cero", () => {
    expect(superaElLimite(cliente("0.01"))).toBe(true);
    expect(superaElLimite(cliente("30000.00"))).toBe(true);
    expect(superaElLimite(cliente("0.00"))).toBe(false);
    expect(superaElLimite(cliente("0"))).toBe(false);
    expect(superaElLimite(cliente(null))).toBe(false);
  });

  it("la venta a cuenta se ve como un ticket sin cobros", () => {
    expect(
      comoVentaCobrada({
        ticketId: "t-1",
        ejemplarId: "e-1",
        numero: 9,
        estado: "EMITIDO",
        fechaNegocio: "2026-11-26",
        total: importe("1000.00"),
        yaExistia: true,
      }),
    ).toEqual({
      ticketId: "t-1",
      ejemplarId: "e-1",
      numero: 9,
      estado: "EMITIDO",
      total: importe("1000.00"),
      cobros: [],
    });
  });
});
