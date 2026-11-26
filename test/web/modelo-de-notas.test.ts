import { describe, expect, it } from "vitest";
import {
  NETO_CERO,
  SIN_ACCIONES_DE_LAS_NOTAS,
  TIPOS_DE_NOTA_POR_CLASE,
  armarLaPantallaDeNotas,
  claseDeLaDireccion,
  nombreDelComprobante,
  quedoSaldadaPorNotas,
  type AccionesDeLasNotas,
  type NotasParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/notas/modelo-de-notas";
import { textosDeNotas } from "../../apps/web/ui/plantillas/compras/notas/textos-de-notas";
import {
  rutaDeCargarNota,
  rutaDeLasNotas,
} from "../../apps/web/ui/plantillas/compras/rutas-de-compras";
import { TIPOS_DE_COMPROBANTE_DE_PROVEEDOR } from "../../src/modulos/compras/publico";

const textos = textosDeNotas();
const FACTURA = "0b0b0b0b-1111-4222-8333-444444444444";
const TODO: AccionesDeLasNotas = {
  registrarCredito: true,
  registrarDebito: true,
  anularCredito: true,
  anularDebito: true,
};
const datos = (cambios: Partial<NotasParaLaPantalla> = {}): NotasParaLaPantalla => ({
  facturaId: FACTURA,
  tipo: "FACTURA_A",
  puntoDeVenta: 3,
  numero: 12345,
  totalDeLaFactura: "1876710.00",
  acreditado: "121000.00",
  debitado: "12100.00",
  netoAPagar: "1755710.00",
  saldoAFavorPendiente: null,
  notas: [
    {
      comprobanteId: "n1",
      clase: "NOTA_DE_CREDITO",
      tipo: "NOTA_CREDITO_A",
      puntoDeVenta: 3,
      numero: 77,
      fechaNegocio: "2026-11-27",
      total: "121000.00",
      estado: "REGISTRADO",
    },
    {
      comprobanteId: "n2",
      clase: "NOTA_DE_DEBITO",
      tipo: "NOTA_DEBITO_A",
      puntoDeVenta: 3,
      numero: 12,
      fechaNegocio: "2026-12-01",
      total: "12100.00",
      estado: "REGISTRADO",
    },
    {
      comprobanteId: "n3",
      clase: "NOTA_DE_CREDITO",
      tipo: "NOTA_CREDITO_A",
      puntoDeVenta: 3,
      numero: 79,
      fechaNegocio: "2026-11-28",
      total: "36300.00",
      estado: "ANULADO",
    },
  ],
  ...cambios,
});

describe("los tipos de nota de la pantalla", () => {
  it("son los seis de nota del dominio, tres por clase, y ninguno de factura (una regla, un lugar)", () => {
    const delDominio = TIPOS_DE_COMPROBANTE_DE_PROVEEDOR.filter((t) => t.startsWith("NOTA_"));
    expect([...TIPOS_DE_NOTA_POR_CLASE.credito, ...TIPOS_DE_NOTA_POR_CLASE.debito].sort()).toEqual(
      [...delDominio].sort(),
    );
    expect(TIPOS_DE_NOTA_POR_CLASE.credito.every((t) => t.startsWith("NOTA_CREDITO_"))).toBe(true);
    expect(TIPOS_DE_NOTA_POR_CLASE.debito.every((t) => t.startsWith("NOTA_DEBITO_"))).toBe(true);
  });

  it("la clase de la dirección es solo «credito» o «debito»", () => {
    expect(claseDeLaDireccion("credito")).toBe("credito");
    expect(claseDeLaDireccion("debito")).toBe("debito");
    for (const v of ["", "CREDITO", "otra", undefined, null, 1, ["credito"]]) {
      expect(claseDeLaDireccion(v)).toBeNull();
    }
  });
});

describe("el nombre del comprobante", () => {
  it("lleva la letra, el punto de venta de cuatro cifras y el número de ocho", () => {
    expect(nombreDelComprobante("FACTURA_A", 3, 12345)).toBe("A 0003-00012345");
    expect(nombreDelComprobante("NOTA_CREDITO_B", 12, 1)).toBe("B 0012-00000001");
  });
  it("sin tipo o sin numeración no inventa nada", () => {
    expect(nombreDelComprobante(null, 3, 1)).toBe("");
    expect(nombreDelComprobante("FACTURA_A", null, 1)).toBe("");
    expect(nombreDelComprobante("FACTURA_A", 3, null)).toBe("");
  });
});

describe("«Notas de la factura»", () => {
  it("muestra lo que dice el servidor, sin sumar ni restar: total, créditos con signo menos, débitos con signo más e importe a pagar", () => {
    const p = armarLaPantallaDeNotas(datos(), textos, TODO);
    expect(p.titulo).toBe("Notas de la factura A 0003-00012345");
    expect(p.resumen).toEqual([
      { rotulo: "Total de la factura", valor: "$ 1.876.710,00" },
      { rotulo: "Notas de crédito vigentes", valor: "− $ 121.000,00" },
      { rotulo: "Notas de débito vinculadas", valor: "+ $ 12.100,00" },
      { rotulo: "Importe a pagar", valor: "$ 1.755.710,00" },
    ]);
  });

  it("el neto a pagar sale tal cual el del servidor, aunque no sea total − créditos + débitos (la nota de débito se paga aparte)", () => {
    const p = armarLaPantallaDeNotas(datos({ netoAPagar: "999.99" }), textos, TODO);
    expect(p.resumen[3]).toEqual({ rotulo: "Importe a pagar", valor: "$ 999,99" });
  });

  it("sin numeración el título es solo «Notas de la factura»", () => {
    expect(armarLaPantallaDeNotas(datos({ tipo: null }), textos, TODO).titulo).toBe(
      "Notas de la factura",
    );
  });

  it("cada nota dice su clase, comprobante y fecha, su importe y si está vigente o anulada", () => {
    const { filas } = armarLaPantallaDeNotas(datos(), textos, TODO);
    expect(filas).toEqual([
      {
        id: "n1",
        clase: "NOTA_DE_CREDITO",
        titulo: "Nota de crédito · A 0003-00000077 · 27/11/2026",
        importe: "$ 121.000,00",
        estado: "Vigente",
        vigente: true,
        anulable: true,
      },
      {
        id: "n2",
        clase: "NOTA_DE_DEBITO",
        titulo: "Nota de débito · A 0003-00000012 · 01/12/2026",
        importe: "$ 12.100,00",
        estado: "Vigente",
        vigente: true,
        anulable: true,
      },
      {
        id: "n3",
        clase: "NOTA_DE_CREDITO",
        titulo: "Nota de crédito · A 0003-00000079 · 28/11/2026",
        importe: "$ 36.300,00",
        estado: "Anulada",
        vigente: false,
        anulable: false,
      },
    ]);
  });

  it("«Anular» se ofrece solo en una nota vigente y con el permiso de SU clase", () => {
    const soloCredito = armarLaPantallaDeNotas(datos(), textos, {
      ...TODO,
      anularDebito: false,
    }).filas.map((f) => f.anulable);
    expect(soloCredito).toEqual([true, false, false]);
    const soloDebito = armarLaPantallaDeNotas(datos(), textos, {
      ...TODO,
      anularCredito: false,
    }).filas.map((f) => f.anulable);
    expect(soloDebito).toEqual([false, true, false]);
  });

  it("todo nace cerrado: sin permisos no hay «Anular» ni «Cargar»", () => {
    const p = armarLaPantallaDeNotas(datos(), textos, SIN_ACCIONES_DE_LAS_NOTAS);
    expect(p.filas.every((f) => !f.anulable)).toBe(true);
    expect(p.cargarCredito).toBeNull();
    expect(p.cargarDebito).toBeNull();
  });

  it("«Cargar nota de crédito» y «Cargar nota de débito» llevan a la carga de su clase, cada uno con su permiso", () => {
    const p = armarLaPantallaDeNotas(datos(), textos, TODO);
    expect(p.cargarCredito).toEqual({
      texto: "Cargar nota de crédito",
      href: rutaDeCargarNota(FACTURA, "credito"),
    });
    expect(p.cargarDebito).toEqual({
      texto: "Cargar nota de débito",
      href: rutaDeCargarNota(FACTURA, "debito"),
    });
    expect(rutaDeCargarNota(FACTURA, "credito")).toBe(
      `/compras/facturas/${FACTURA}/notas/nueva?clase=credito`,
    );
    expect(rutaDeLasNotas(FACTURA)).toBe(`/compras/facturas/${FACTURA}/notas`);
    const soloCredito = armarLaPantallaDeNotas(datos(), textos, {
      ...TODO,
      registrarDebito: false,
    });
    expect(soloCredito.cargarCredito).not.toBeNull();
    expect(soloCredito.cargarDebito).toBeNull();
    const soloDebito = armarLaPantallaDeNotas(datos(), textos, {
      ...TODO,
      registrarCredito: false,
    });
    expect(soloDebito.cargarCredito).toBeNull();
    expect(soloDebito.cargarDebito).not.toBeNull();
  });

  it("con neto cero y sin pago vigente la factura queda «Saldada por notas»; con neto mayor que cero no figura nada", () => {
    expect(NETO_CERO).toBe("0.00");
    const saldada = datos({ netoAPagar: "0.00", acreditado: "1876710.00" });
    expect(quedoSaldadaPorNotas(saldada)).toBe(true);
    expect(armarLaPantallaDeNotas(saldada, textos, TODO).situacion).toEqual({
      texto: "Saldada por notas",
      importe: null,
    });
    expect(quedoSaldadaPorNotas(datos())).toBe(false);
    expect(armarLaPantallaDeNotas(datos(), textos, TODO).situacion).toBeNull();
    expect(quedoSaldadaPorNotas(datos({ netoAPagar: "0.01" }))).toBe(false);
  });

  it("con un pago vigente que supera al neto queda «Saldo a favor» con su importe, aun con neto cero (nunca «Saldada»)", () => {
    const conSaldo = datos({ netoAPagar: "0.00", saldoAFavorPendiente: "500.50" });
    expect(quedoSaldadaPorNotas(conSaldo)).toBe(false);
    expect(armarLaPantallaDeNotas(conSaldo, textos, TODO).situacion).toEqual({
      texto: "Saldo a favor",
      importe: "$ 500,50",
    });
    const conSaldoYNeto = datos({ saldoAFavorPendiente: "10.00" });
    expect(armarLaPantallaDeNotas(conSaldoYNeto, textos, TODO).situacion).toEqual({
      texto: "Saldo a favor",
      importe: "$ 10,00",
    });
  });

  it("una factura sin notas no dibuja filas", () => {
    expect(armarLaPantallaDeNotas(datos({ notas: [] }), textos, TODO).filas).toEqual([]);
  });
});
