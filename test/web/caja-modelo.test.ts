import { describe, expect, it } from "vitest";
import {
  CANTIDAD_MAXIMA_DE_BILLETES,
  DENOMINACIONES_DE_BILLETES,
} from "../../src/modulos/caja/publico";
import type { AccionesDeLaPantallaDeCaja } from "../../apps/web/ui/plantillas/caja/lista-de-caja";
import {
  botonesDeLaCaja,
  cabeceraDeJornada,
  diferenciaDe,
  efectivoEsperado,
  estadoDeLaCaja,
  fechaParaMostrar,
  importeParaMostrar,
  limitarElTexto,
  lineaDeMovimiento,
  medioDelEfectivo,
  puedeAbrir,
  puedeAnular,
  puedeRegistrar,
  resumenDeLaUltimaSesion,
  rotuloDeLaClase,
  rotuloDeLaCuenta,
  rotuloDelMedio,
  sumaDeImportes,
  textoDelEfectivo,
  tituloDeLaAnulacion,
  tonoDeLaDiferencia,
  type MovimientoDeLaCaja,
  type UltimaSesionDeLaCaja,
} from "../../apps/web/ui/plantillas/caja/modelo-de-la-caja";
import {
  CONTEO_EN_BLANCO,
  claveDeLinea,
  conBilletes,
  conConformeAlternado,
  conConformeGeneral,
  conContado,
  conMonedas,
  diferenciaDeUnMedio,
  diferenciaDelEfectivo,
  etiquetaDeBillete,
  reglaDeBilletes,
  subtotalDeBilletes,
  totalContadoDelEfectivo,
  vistaDelConteo,
  type ConteoDeLaCaja,
} from "../../apps/web/ui/plantillas/caja/modelo-de-conteo-de-caja";
import {
  armarElPedidoDeAjuste,
  armarElPedidoDeAnulacion,
  armarElPedidoDeApertura,
  armarElPedidoDeCierre,
  armarElPedidoDeMovimiento,
  armarElPedidoDeSesion,
} from "../../apps/web/ui/plantillas/caja/pedidos-de-caja";

/**
 * Los modelos de vista de la pantalla «Caja» del mostrador (maqueta `caja.html`) y los pedidos de sus acciones, con los textos reales del catálogo: estados, cabecera, efectivo esperado,
 * líneas de movimientos y «Anular», resumen de la última sesión, botones apagados por permisos, conteo de billetes, total contado, diferencias, «Conforme» y el pedido de cierre.
 */
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const TODO: AccionesDeLaPantallaDeCaja = {
  abrir: true,
  iniciarCierre: true,
  cancelarCierre: true,
  cerrar: true,
  registrarMovimiento: true,
  ajustar: true,
  anular: true,
  anularDeOtros: true,
};
const NADA: AccionesDeLaPantallaDeCaja = {
  abrir: false,
  iniciarCierre: false,
  cancelarCierre: false,
  cerrar: false,
  registrarMovimiento: false,
  ajustar: false,
  anular: false,
  anularDeOtros: false,
};
const efectivo = (esperado: string) => ({
  medioDePagoId: "m-ef",
  medioTipo: "EFECTIVO",
  medioNombre: null,
  cuentaDeCobroId: null,
  cuentaNombre: null,
  esperado: ARS(esperado),
});
const debito = (esperado: string) => ({
  medioDePagoId: "m-de",
  medioTipo: "TARJETA_DEBITO",
  medioNombre: null,
  cuentaDeCobroId: "c-1",
  cuentaNombre: "Posnet 1",
  esperado: ARS(esperado),
});
const qr = (esperado: string) => ({
  medioDePagoId: "m-qr",
  medioTipo: "QR",
  medioNombre: null,
  cuentaDeCobroId: null,
  cuentaNombre: null,
  esperado: ARS(esperado),
});
const movimiento = (cambios: Partial<MovimientoDeLaCaja> = {}): MovimientoDeLaCaja => ({
  id: "mv1",
  clase: "EGRESO_MANUAL",
  medioTipo: "EFECTIVO",
  medioNombre: null,
  cuentaNombre: null,
  importe: ARS("-2500.00"),
  motivo: "Compra de hielo",
  anuladoPor: null,
  anulablePorElActor: true,
  ...cambios,
});

describe("rótulos y formato", () => {
  it("la clase de cada movimiento sale del catálogo; una desconocida se dice con su valor", () => {
    expect(rotuloDeLaClase("FONDO_INICIAL")).toBe("Fondo inicial");
    expect(rotuloDeLaClase("COBRO")).toBe("Cobro");
    expect(rotuloDeLaClase("INGRESO_MANUAL")).toBe("Ingreso");
    expect(rotuloDeLaClase("EGRESO_MANUAL")).toBe("Egreso");
    expect(rotuloDeLaClase("AJUSTE")).toBe("Ajuste");
    expect(rotuloDeLaClase("ANULACION")).toBe("Anulación");
    expect(rotuloDeLaClase("OTRA")).toBe("OTRA");
    expect(rotuloDeLaClase("toString")).toBe("toString");
  });

  it("el medio se lee por su nombre propio o, sin él, por el de su tipo; la cuenta solo la llevan los que no son efectivo", () => {
    expect(rotuloDelMedio("TARJETA_DEBITO", null)).toBe("Tarjeta de débito");
    expect(rotuloDelMedio("TARJETA_DEBITO", "")).toBe("Tarjeta de débito");
    expect(rotuloDelMedio("TARJETA_DEBITO", "Débito Visa")).toBe("Débito Visa");
    expect(rotuloDeLaCuenta("EFECTIVO", "Caja")).toBeNull();
    expect(rotuloDeLaCuenta("QR", null)).toBe("Sin cuenta");
    expect(rotuloDeLaCuenta("QR", "")).toBe("Sin cuenta");
    expect(rotuloDeLaCuenta("TARJETA_DEBITO", "Posnet 1")).toBe("Posnet 1");
  });

  it("los importes salen con el formato es-AR y las fechas por texto, sin correrse de día", () => {
    expect(importeParaMostrar(ARS("1500000.00"))).toBe("$ 1.500.000,00");
    expect(importeParaMostrar(ARS("-2500.00"))).toBe("-$ 2.500,00");
    expect(fechaParaMostrar("2026-11-09")).toBe("09/11/2026");
    expect(fechaParaMostrar("2026-01-01")).toBe("01/01/2026");
    expect(cabeceraDeJornada("2026-11-09", "06:00")).toBe("Jornada 09/11/2026 · Corte 06:00");
  });

  it("el estado: sin sesión «Cerrada»; con sesión, abierta o en cierre, «Abierta»", () => {
    expect(estadoDeLaCaja("SIN_SESION")).toEqual({ texto: "Cerrada", tono: "aviso" });
    expect(estadoDeLaCaja("ABIERTA")).toEqual({ texto: "Abierta", tono: "exito" });
    expect(estadoDeLaCaja("EN_CIERRE")).toEqual({ texto: "Abierta", tono: "exito" });
  });

  it("limita el texto al largo que dice su dato y valida lo mínimo para enviar", () => {
    expect(limitarElTexto("abcdef", 3)).toBe("abc");
    expect(limitarElTexto("ab", 3)).toBe("ab");
    expect(limitarElTexto("abc", 3)).toBe("abc");
    expect(puedeRegistrar("10.00", "hielo")).toBe(true);
    expect(puedeRegistrar("", "hielo")).toBe(false);
    expect(puedeRegistrar("10.00", "   ")).toBe(false);
    expect(puedeAnular("error")).toBe(true);
    expect(puedeAnular(" ")).toBe(false);
    expect(puedeAbrir("0.00")).toBe(true);
    expect(puedeAbrir("")).toBe(false);
  });
});

describe("efectivo esperado y ajuste", () => {
  it("suma exacta de las líneas de efectivo, sin perder centavos", () => {
    expect(sumaDeImportes([ARS("0.10"), ARS("0.20")])).toBe("0.30");
    expect(sumaDeImportes([])).toBe("0.00");
    expect(sumaDeImportes([ARS("999999999999.99"), ARS("0.01")])).toBe("1000000000000.00");
    expect(efectivoEsperado([efectivo("15000.00"), debito("52300.00"), efectivo("100.50")])).toBe(
      "15100.50",
    );
    expect(efectivoEsperado([debito("52300.00")])).toBe("0.00");
    expect(textoDelEfectivo([efectivo("18400.00"), debito("52300.00")])).toBe(
      "Efectivo: $ 18.400,00",
    );
  });

  it("el ajuste va al medio y la cuenta del efectivo; sin efectivo no hay a dónde", () => {
    expect(medioDelEfectivo([debito("1.00"), efectivo("2.00")])).toEqual({
      medioDePagoId: "m-ef",
      cuentaDeCobroId: null,
    });
    expect(medioDelEfectivo([debito("1.00")])).toBeNull();
  });
});

describe("botones apagados por permisos y por estado", () => {
  it("abrir solo sin sesión; ingreso, egreso y ajuste con la caja abierta; cerrar con la caja abierta o en cierre", () => {
    expect(botonesDeLaCaja("SIN_SESION", false, TODO)).toEqual({
      abrir: true,
      ingreso: false,
      egreso: false,
      ajuste: false,
      cerrar: false,
    });
    expect(botonesDeLaCaja("ABIERTA", true, TODO)).toEqual({
      abrir: false,
      ingreso: true,
      egreso: true,
      ajuste: true,
      cerrar: true,
    });
    expect(botonesDeLaCaja("EN_CIERRE", true, TODO)).toEqual({
      abrir: false,
      ingreso: false,
      egreso: false,
      ajuste: false,
      cerrar: true,
    });
  });

  it("sin permiso todo apagado; el ajuste también sin efectivo; cada botón mira su acción", () => {
    expect(botonesDeLaCaja("ABIERTA", true, NADA)).toEqual({
      abrir: false,
      ingreso: false,
      egreso: false,
      ajuste: false,
      cerrar: false,
    });
    expect(botonesDeLaCaja("SIN_SESION", true, NADA).abrir).toBe(false);
    expect(botonesDeLaCaja("ABIERTA", false, TODO).ajuste).toBe(false);
    expect(botonesDeLaCaja("ABIERTA", true, { ...TODO, ajustar: false })).toMatchObject({
      ingreso: true,
      egreso: true,
      ajuste: false,
    });
    expect(botonesDeLaCaja("ABIERTA", true, { ...TODO, registrarMovimiento: false })).toMatchObject(
      { ingreso: false, egreso: false, ajuste: true },
    );
    expect(botonesDeLaCaja("ABIERTA", true, { ...TODO, iniciarCierre: false }).cerrar).toBe(false);
  });
});

describe("líneas de movimientos y «Anular»", () => {
  it("un egreso manual de la caja abierta se anula, con el nombre accesible completo", () => {
    expect(lineaDeMovimiento(movimiento(), "ABIERTA")).toEqual({
      id: "mv1",
      clase: "Egreso",
      anulado: false,
      motivo: "Compra de hielo",
      detalle: "Efectivo",
      importe: "-$ 2.500,00",
      anular: { apagado: false, etiqueta: "Anular Egreso -$ 2.500,00" },
    });
  });

  it("sale apagado si el servidor dice que la persona no lo puede anular", () => {
    expect(lineaDeMovimiento(movimiento({ anulablePorElActor: false }), "ABIERTA").anular).toEqual({
      apagado: true,
      etiqueta: "Anular Egreso -$ 2.500,00",
    });
  });

  it("no se ofrece anular el fondo inicial, un cobro, una anulación, uno ya anulado ni nada con la caja en cierre", () => {
    for (const clase of ["FONDO_INICIAL", "COBRO", "ANULACION", "OTRA"]) {
      expect(lineaDeMovimiento(movimiento({ clase }), "ABIERTA").anular).toBeNull();
    }
    expect(lineaDeMovimiento(movimiento({ anuladoPor: "mv9" }), "ABIERTA").anular).toBeNull();
    expect(lineaDeMovimiento(movimiento(), "EN_CIERRE").anular).toBeNull();
    for (const clase of ["INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE"]) {
      expect(lineaDeMovimiento(movimiento({ clase }), "ABIERTA").anular).not.toBeNull();
    }
  });

  it("marca el anulado, lleva la cuenta de un medio que no es efectivo y el motivo si hay", () => {
    const l = lineaDeMovimiento(
      movimiento({
        clase: "COBRO",
        medioTipo: "TARJETA_DEBITO",
        cuentaNombre: "Posnet 1",
        importe: ARS("52300.00"),
        motivo: null,
        anuladoPor: "mv9",
      }),
      "ABIERTA",
    );
    expect(l).toMatchObject({
      clase: "Cobro",
      anulado: true,
      motivo: null,
      detalle: "Tarjeta de débito · Posnet 1",
      importe: "$ 52.300,00",
    });
    expect(
      lineaDeMovimiento(movimiento({ medioTipo: "QR", cuentaNombre: null }), "ABIERTA").detalle,
    ).toBe("QR · Sin cuenta");
    expect(lineaDeMovimiento(movimiento({ medioNombre: "Billetera" }), "ABIERTA").detalle).toBe(
      "Billetera",
    );
    expect(tituloDeLaAnulacion(lineaDeMovimiento(movimiento(), "ABIERTA"))).toBe(
      "Anular · Egreso -$ 2.500,00",
    );
  });
});

describe("resumen de la última sesión", () => {
  const ultima: UltimaSesionDeLaCaja = {
    observacion: "Faltaron 100 pesos de vuelto",
    arqueo: [
      {
        ...efectivo("50900.00"),
        contado: ARS("50800.00"),
        conforme: false,
        diferencia: ARS("-100.00"),
      },
      { ...debito("52300.00"), contado: ARS("52300.00"), conforme: false, diferencia: ARS("0.00") },
      { ...qr("9500.00"), contado: null, conforme: true, diferencia: null },
      {
        ...debito("1.00"),
        medioDePagoId: "m-cr",
        cuentaDeCobroId: null,
        cuentaNombre: null,
        contado: null,
        conforme: false,
        diferencia: null,
      },
    ],
  };

  it("una fila por medio y cuenta: lo contado o «Conforme», el esperado y la diferencia solo si no es conforme", () => {
    const r = resumenDeLaUltimaSesion(ultima);
    expect(r.observacion).toBe("Faltaron 100 pesos de vuelto");
    expect(r.filas).toEqual([
      {
        clave: "m-ef|",
        titulo: "Efectivo",
        cuenta: null,
        principal: "$ 50.800,00",
        secundaria: "Esperado $ 50.900,00 · Diferencia -$ 100,00",
        tonoDeLaDiferencia: "peligro",
      },
      {
        clave: "m-de|c-1",
        titulo: "Tarjeta de débito",
        cuenta: "Posnet 1",
        principal: "$ 52.300,00",
        secundaria: "Esperado $ 52.300,00 · Diferencia $ 0,00",
        tonoDeLaDiferencia: null,
      },
      {
        clave: "m-qr|",
        titulo: "QR",
        cuenta: "Sin cuenta",
        principal: "Conforme",
        secundaria: "Esperado $ 9.500,00",
        tonoDeLaDiferencia: null,
      },
      {
        clave: "m-cr|",
        titulo: "Tarjeta de débito",
        cuenta: "Sin cuenta",
        principal: "Sin declarar",
        secundaria: "Esperado $ 1,00",
        tonoDeLaDiferencia: null,
      },
    ]);
  });

  it("sin observación no hay texto", () => {
    expect(resumenDeLaUltimaSesion({ ...ultima, observacion: null }).observacion).toBeNull();
    expect(resumenDeLaUltimaSesion({ ...ultima, observacion: "" }).observacion).toBeNull();
  });
});

describe("diferencias", () => {
  it("contado menos esperado, exacto; sin contado no hay diferencia", () => {
    expect(diferenciaDe("50.10", "50.30")).toBe("-0.20");
    expect(diferenciaDe("100.00", "50.00")).toBe("50.00");
    expect(diferenciaDe(null, "50.00")).toBeNull();
  });

  it("falta en rojo, sobra en aviso, cero y nada sin tono", () => {
    expect(tonoDeLaDiferencia("-0.01")).toBe("peligro");
    expect(tonoDeLaDiferencia("0.01")).toBe("aviso");
    expect(tonoDeLaDiferencia("0.00")).toBeNull();
    expect(tonoDeLaDiferencia(null)).toBeNull();
  });
});

describe("conteo de billetes y total contado", () => {
  const conteo: ConteoDeLaCaja = {
    sesionId: "s1",
    lineas: [
      { ...efectivo("18400.00"), contarConBilletes: true },
      { ...debito("52300.00"), contarConBilletes: false },
      { ...qr("9500.00"), contarConBilletes: false },
    ],
    denominaciones: [20000, 10000, 2000, 1000, 500, 200, 100],
    cantidadMaximaDeBilletes: 99999,
  };

  it("la vista trae el esperado del efectivo, los billetes con su rótulo y una fila por cada otro medio", () => {
    const v = vistaDelConteo(conteo);
    expect(v.efectivo).toEqual({ esperado: "18400.00", esperadoParaMostrar: "$ 18.400,00" });
    expect(v.billetes.map((b) => b.etiqueta)).toEqual([
      "$ 20.000",
      "$ 10.000",
      "$ 2.000",
      "$ 1.000",
      "$ 500",
      "$ 200",
      "$ 100",
    ]);
    expect(v.reglaDeBilletes).toEqual({ decimales: 0, enterosMaximos: 5 });
    expect(v.otros).toEqual([
      {
        clave: "m-de|c-1",
        medioDePagoId: "m-de",
        cuentaDeCobroId: "c-1",
        titulo: "Tarjeta de débito",
        cuenta: "Posnet 1",
        esperado: "52300.00",
        esperadoParaMostrar: "$ 52.300,00",
      },
      {
        clave: "m-qr|",
        medioDePagoId: "m-qr",
        cuentaDeCobroId: null,
        titulo: "QR",
        cuenta: "Sin cuenta",
        esperado: "9500.00",
        esperadoParaMostrar: "$ 9.500,00",
      },
    ]);
  });

  it("las denominaciones y el tope reales del dominio caben en la regla de la pantalla", () => {
    expect(DENOMINACIONES_DE_BILLETES.length).toBeGreaterThan(0);
    expect(reglaDeBilletes(CANTIDAD_MAXIMA_DE_BILLETES).enterosMaximos).toBe(
      String(CANTIDAD_MAXIMA_DE_BILLETES).length,
    );
    expect(reglaDeBilletes(9).enterosMaximos).toBe(1);
    expect(etiquetaDeBillete(20000)).toBe("$ 20.000");
  });

  it("subtotal de una denominación: exacto y vacío si no se escribió cantidad", () => {
    expect(subtotalDeBilletes(20000, "2")).toBe("40000.00");
    expect(subtotalDeBilletes(100, "0")).toBe("0.00");
    expect(subtotalDeBilletes(20000, "99999")).toBe("1999980000.00");
    expect(subtotalDeBilletes(100, "")).toBeNull();
    expect(subtotalDeBilletes(100, "x")).toBeNull();
  });

  it("total contado: billetes más monedas; lo no escrito suma cero; sin nada escrito no hay total", () => {
    const d = conteo.denominaciones;
    expect(totalContadoDelEfectivo(d, {}, "")).toBeNull();
    expect(totalContadoDelEfectivo(d, { "20000": "" }, "")).toBeNull();
    expect(
      totalContadoDelEfectivo(d, { "20000": "2", "2000": "5", "500": "1", "100": "3" }, ""),
    ).toBe("50800.00");
    expect(totalContadoDelEfectivo(d, {}, "12.50")).toBe("12.50");
    expect(totalContadoDelEfectivo(d, { "100": "1" }, "0.35")).toBe("100.35");
    expect(totalContadoDelEfectivo(d, { "100": "0" }, "")).toBe("0.00");
    expect(totalContadoDelEfectivo(d, { "20000": "2", "10": "9" }, "")).toBe("40000.00");
    expect(totalContadoDelEfectivo(d, { "20000": "x", "500": "2" }, "")).toBe("1000.00");
  });

  it("un total fuera del rango del dinero no rompe la pantalla: no se muestra", () => {
    expect(totalContadoDelEfectivo([100], { "100": "99999" }, "9999999999999999.99")).toBeNull();
  });

  it("la diferencia del efectivo: vacía sin total, con signo y tono si hay", () => {
    expect(diferenciaDelEfectivo(null, "18400.00")).toEqual({ texto: "", tono: null });
    expect(diferenciaDelEfectivo("18300.00", "18400.00")).toEqual({
      texto: "-$ 100,00",
      tono: "peligro",
    });
    expect(diferenciaDelEfectivo("18500.00", "18400.00")).toEqual({
      texto: "$ 100,00",
      tono: "aviso",
    });
    expect(diferenciaDelEfectivo("18400.00", "18400.00")).toEqual({ texto: "$ 0,00", tono: null });
  });

  it("la diferencia de un medio: «Conforme», «Sin declarar» o contado menos esperado", () => {
    const fila = vistaDelConteo(conteo).otros[0]!;
    expect(diferenciaDeUnMedio(fila, "", true)).toEqual({ texto: "Conforme", tono: null });
    expect(diferenciaDeUnMedio(fila, "52300.00", true)).toEqual({ texto: "Conforme", tono: null });
    expect(diferenciaDeUnMedio(fila, "", false)).toEqual({ texto: "Sin declarar", tono: null });
    expect(diferenciaDeUnMedio(fila, "52300.00", false)).toEqual({ texto: "$ 0,00", tono: null });
    expect(diferenciaDeUnMedio(fila, "18400.00", false)).toEqual({
      texto: "-$ 33.900,00",
      tono: "peligro",
    });
  });
});

describe("estado del conteo: «Conforme» y «Conforme general»", () => {
  const filas = vistaDelConteo({
    sesionId: "s1",
    lineas: [
      { ...debito("1.00"), contarConBilletes: false },
      { ...qr("2.00"), contarConBilletes: false },
    ],
    denominaciones: [100],
    cantidadMaximaDeBilletes: 99999,
  }).otros;
  const [a, b] = filas as [(typeof filas)[number], (typeof filas)[number]];

  it("escribir billetes y monedas", () => {
    expect(CONTEO_EN_BLANCO.monedas).toBe("");
    expect(conBilletes(CONTEO_EN_BLANCO, 100, "3").billetes).toEqual({ "100": "3" });
    expect(conMonedas(CONTEO_EN_BLANCO, "5.00").monedas).toBe("5.00");
    expect(claveDeLinea("m", null)).toBe("m|");
    expect(claveDeLinea("m", "c")).toBe("m|c");
  });

  it("declarar un total saca el «conforme» de esa línea; borrar el total lo deja como está", () => {
    const conforme = conConformeAlternado(CONTEO_EN_BLANCO, a.clave);
    expect(conforme.conformes[a.clave]).toBe(true);
    const declarado = conContado(conforme, a.clave, "1.00");
    expect(declarado.conformes[a.clave]).toBe(false);
    expect(declarado.contados[a.clave]).toBe("1.00");
    const borrado = conContado(conConformeAlternado(CONTEO_EN_BLANCO, a.clave), a.clave, "");
    expect(borrado.conformes[a.clave]).toBe(true);
  });

  it("«Conforme» alterna y vacía el total; volver a tocarlo lo desmarca sin tocar lo escrito", () => {
    const con = conConformeAlternado(conContado(CONTEO_EN_BLANCO, a.clave, "1.00"), a.clave);
    expect(con.conformes[a.clave]).toBe(true);
    expect(con.contados[a.clave]).toBe("");
    const sin = conConformeAlternado(conContado(con, b.clave, "2.00"), a.clave);
    expect(sin.conformes[a.clave]).toBe(false);
    expect(sin.contados[b.clave]).toBe("2.00");
  });

  it("«Conforme general» marca las líneas sin total declarado y deja las declaradas", () => {
    const e = conConformeGeneral(conContado(CONTEO_EN_BLANCO, b.clave, "2.00"), filas);
    expect(e.conformes[a.clave]).toBe(true);
    expect(e.conformes[b.clave]).toBe(false);
    expect(conConformeGeneral(CONTEO_EN_BLANCO, filas).conformes).toEqual({
      [a.clave]: true,
      [b.clave]: true,
    });
  });
});

describe("pedidos de las acciones", () => {
  it("abrir, movimiento, ajuste y anulación llevan la clave y solo lo que la frontera lee", () => {
    expect(armarElPedidoDeApertura("k1", "caja1", "15000.00")).toEqual({
      claveDeIdempotencia: "k1",
      cajaId: "caja1",
      fondoInicial: "15000.00",
    });
    expect(armarElPedidoDeMovimiento("k2", "s1", "EGRESO", "2500.00", "hielo")).toEqual({
      claveDeIdempotencia: "k2",
      sesionId: "s1",
      sentido: "EGRESO",
      importe: "2500.00",
      motivo: "hielo",
    });
    expect(
      armarElPedidoDeAjuste(
        "k3",
        "s1",
        { medioDePagoId: "m-ef", cuentaDeCobroId: null },
        "FALTA",
        "100.00",
        "vuelto",
      ),
    ).toEqual({
      claveDeIdempotencia: "k3",
      sesionId: "s1",
      medioDePagoId: "m-ef",
      cuentaDeCobroId: null,
      sentido: "FALTA",
      importe: "100.00",
      motivo: "vuelto",
    });
    expect(armarElPedidoDeAnulacion("k4", "mv1", "error")).toEqual({
      claveDeIdempotencia: "k4",
      movimientoId: "mv1",
      motivo: "error",
    });
    expect(armarElPedidoDeSesion("s1")).toEqual({ sesionId: "s1" });
  });

  const filas = vistaDelConteo({
    sesionId: "s1",
    lineas: [
      { ...debito("1.00"), contarConBilletes: false },
      { ...qr("2.00"), contarConBilletes: false },
    ],
    denominaciones: [20000, 100],
    cantidadMaximaDeBilletes: 99999,
  }).otros;
  const [a, b] = filas as [(typeof filas)[number], (typeof filas)[number]];

  it("cierre: solo los billetes con cantidad, las monedas y los medios declarados; el resto conforme", () => {
    const estado = {
      billetes: { "20000": "2", "100": "" },
      monedas: "5.50",
      contados: { [a.clave]: "52300.00" },
      conformes: { [b.clave]: true },
    };
    expect(armarElPedidoDeCierre("s1", [20000, 100], filas, estado, "obs")).toEqual({
      sesionId: "s1",
      conteo: { billetes: [{ denominacion: 20000, cantidad: 2 }], monedas: "5.50" },
      otros: [{ medioDePagoId: "m-de", cuentaDeCobroId: "c-1", contado: "52300.00" }],
      conformeGeneral: true,
      observacion: "obs",
    });
  });

  it("cierre: sin nada en el efectivo va `conteo: null`; con billetes en cero va el conteo; sin monedas viajan vacías", () => {
    const vacio = armarElPedidoDeCierre(
      "s1",
      [20000, 100],
      filas,
      { billetes: {}, monedas: "", contados: {}, conformes: {} },
      "",
    );
    expect(vacio.conteo).toBeNull();
    const conCero = armarElPedidoDeCierre(
      "s1",
      [20000, 100],
      filas,
      { billetes: { "100": "0" }, monedas: "", contados: {}, conformes: {} },
      "",
    );
    expect(conCero.conteo).toEqual({ billetes: [{ denominacion: 100, cantidad: 0 }], monedas: "" });
    const soloMonedas = armarElPedidoDeCierre(
      "s1",
      [20000, 100],
      filas,
      { billetes: {}, monedas: "1.00", contados: {}, conformes: {} },
      "",
    );
    expect(soloMonedas.conteo).toEqual({ billetes: [], monedas: "1.00" });
  });

  it("cierre: «conforme general» solo si TODA línea sin total quedó conforme; una que no, y el servidor lo rechaza", () => {
    const base = { billetes: { "100": "1" }, monedas: "" };
    const unaSinResolver = armarElPedidoDeCierre(
      "s1",
      [100],
      filas,
      { ...base, contados: {}, conformes: { [a.clave]: true } },
      "",
    );
    expect(unaSinResolver.conformeGeneral).toBe(false);
    expect(unaSinResolver.otros).toEqual([]);
    const todasDeclaradas = armarElPedidoDeCierre(
      "s1",
      [100],
      filas,
      { ...base, contados: { [a.clave]: "1.00", [b.clave]: "2.00" }, conformes: {} },
      "",
    );
    expect(todasDeclaradas.conformeGeneral).toBe(false);
    expect(todasDeclaradas.otros).toHaveLength(2);
    const conformeYDeclarado = armarElPedidoDeCierre(
      "s1",
      [100],
      filas,
      { ...base, contados: { [a.clave]: "1.00" }, conformes: { [a.clave]: true, [b.clave]: true } },
      "",
    );
    expect(conformeYDeclarado.otros).toEqual([]);
    expect(conformeYDeclarado.conformeGeneral).toBe(true);
    const sinLineas = armarElPedidoDeCierre(
      "s1",
      [100],
      [],
      { ...base, contados: {}, conformes: {} },
      "",
    );
    expect(sinLineas.conformeGeneral).toBe(false);
  });
});
