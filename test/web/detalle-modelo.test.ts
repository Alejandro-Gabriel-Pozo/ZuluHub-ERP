import { describe, expect, it } from "vitest";
import { armarElDetalle } from "../../apps/web/ui/plantillas/facturacion/modelo-del-detalle";
import { base, con, nota, visible } from "../utilidades/detalle-de-comprobante";

/** El modelo de vista del detalle de un comprobante: qué bloques salen en cada estado y tipo. */

describe("el modelo del detalle", () => {
  it("factura autorizada sin notas: título, estado, datos, renglón y «Sin notas»", () => {
    const m = armarElDetalle(base);
    expect(m.titulo).toBe("Factura B 00001-00001234");
    expect(m.estado).toEqual({ texto: "Autorizada", tono: "exito" });
    expect(m.anulacion).toBeNull();
    expect(m.aviso).toBeNull();
    expect(m.datos).toEqual([
      { rotulo: "Número", valor: "00001-00001234", secundario: null },
      { rotulo: "Fecha", valor: "14/10/2026", secundario: null },
      { rotulo: "CAE", valor: "74123456789012 · vence 24/10/2026", secundario: null },
      { rotulo: "Cliente", valor: "Consumidor final", secundario: null },
      { rotulo: "Punto de venta", valor: "0001", secundario: null },
    ]);
    expect(m.renglones).toEqual([
      {
        descripcion: "Medialunas (docena)",
        cuenta: "2 × $ 4.500,00",
        iva: "IVA 21 %",
        importe: "$ 9.000,00",
      },
    ]);
    expect(m.total).toBe("$ 9.000,00");
    expect(m.anulado).toMatchObject({
      titulo: "Ya anulado con notas de crédito",
      cifra: "$ 0,00",
      notas: [],
      sinNotas: "Sin notas",
    });
  });

  it("anulación parcial y total: etiqueta junto al estado, cifra y notas de crédito con su estado", () => {
    const parcial = armarElDetalle(
      con({
        acreditado: "4500.00",
        acreditacion: "PARCIAL",
        notasQueLoCitan: [
          nota("n1", "AUTORIZADO", "4500.00"),
          // Una nota de débito que cita la factura no se lista.
          nota("n2", "AUTORIZADO", "100.00", "NOTA_DEBITO_B", "00001-00000046"),
        ],
      }),
    );
    expect(parcial.anulacion).toBe("Anulación parcial");
    expect(parcial.anulado?.cifra).toBe("$ 4.500,00");
    expect(parcial.anulado?.sinNotas).toBeNull();
    expect(parcial.anulado?.notas).toEqual([
      {
        id: "n1",
        nombre: "Nota de crédito B 00001-00000045",
        total: "$ 4.500,00",
        estado: { texto: "Autorizada", tono: "exito" },
      },
    ]);
    const total = armarElDetalle(
      con({
        acreditado: "9000.00",
        acreditacion: "TOTAL",
        notasQueLoCitan: [nota("n1", "EN_VALIDACION", "9000.00", "NOTA_CREDITO_B", null)],
      }),
    );
    expect(total.anulacion).toBe("Anulación total");
    expect(total.anulado?.notas[0]).toMatchObject({
      nombre: "Nota de crédito B",
      estado: { texto: "Validando" },
    });
  });

  it.each([
    ["PENDIENTE", "Pendiente de enviar", "neutro"],
    ["EN_VALIDACION", "Validando", "info"],
    ["AUTORIZADO", "Autorizada", "exito"],
    ["RECHAZADO", "Rechazada", "peligro"],
    ["INCIERTO", "Confirmando", "aviso"],
    ["CONFLICTO", "Requiere revisión", "peligro"],
    ["DESCARTADO", "Descartada", "neutro"],
  ] as const)("el estado %s se llama «%s»", (estado, textoEsperado, tono) => {
    expect(armarElDetalle(con({ estado })).estado).toEqual({ texto: textoEsperado, tono });
  });

  it("sin autorizar: sin CAE, sin etiqueta de anulación y sin bloque de lo anulado", () => {
    for (const estado of [
      "PENDIENTE",
      "EN_VALIDACION",
      "RECHAZADO",
      "INCIERTO",
      "CONFLICTO",
      "DESCARTADO",
    ] as const) {
      const m = armarElDetalle(
        con({
          estado,
          numero: null,
          fechaEmision: null,
          cae: "74123456789012",
          caeVence: "2026-10-24",
          acreditacion: "TOTAL",
        }),
      );
      expect(
        m.datos.map((d) => d.rotulo),
        estado,
      ).toEqual(["Cliente", "Punto de venta"]);
      expect(m.titulo).toBe("Factura B");
      expect(m.anulacion).toBeNull();
      expect(m.anulado).toBeNull();
    }
  });

  it("los avisos por estado", () => {
    expect(armarElDetalle(con({ estado: "EN_VALIDACION" })).aviso).toEqual({
      tono: "info",
      titulo: "Validando con ARCA…",
      lineas: ["Todavía no tiene número."],
    });
    expect(armarElDetalle(con({ estado: "INCIERTO" })).aviso).toEqual({
      tono: "aviso",
      titulo: "ARCA no respondió a tiempo",
      lineas: ["Lo confirmamos solos en unos minutos consultando a ARCA. No lo emitas de nuevo."],
    });
    expect(armarElDetalle(con({ estado: "CONFLICTO" })).aviso).toEqual({
      tono: "peligro",
      titulo: "Otro sistema usó este número en ARCA",
      lineas: ["El punto de venta quedó bloqueado hasta resincronizar."],
    });
    expect(armarElDetalle(con({ estado: "PENDIENTE" })).aviso).toBeNull();
    expect(armarElDetalle(base).aviso).toBeNull();
  });

  it("rechazada: los mensajes traducidos de ARCA, con el código solo donde el texto lo pide", () => {
    const m = armarElDetalle(
      con({
        estado: "RECHAZADO",
        ultimoIntento: {
          mensajes: [
            { clave: "fiscal.arca.receptor_para_a" },
            { clave: "fiscal.arca.error_generico", marcadores: { codigo: "10999" } },
          ],
        },
      }),
    );
    expect(m.aviso?.titulo).toBe("ARCA lo rechazó");
    expect(m.aviso?.lineas).toHaveLength(2);
    expect(m.aviso?.lineas[0]).toMatch(/CUIT/);
    expect(armarElDetalle(con({ estado: "RECHAZADO" })).aviso?.lineas).toEqual([]);
  });

  it("descartada: el motivo del descarte; sin motivo, sin aviso", () => {
    expect(
      armarElDetalle(con({ estado: "DESCARTADO", motivoDeDescarte: "Se cargó dos veces" })).aviso,
    ).toEqual({ tono: "info", titulo: null, lineas: ["Se cargó dos veces"] });
    expect(armarElDetalle(con({ estado: "DESCARTADO" })).aviso).toBeNull();
  });

  it("nota de crédito: «Corresponde a…» y sin bloque de lo anulado; la de débito, igual", () => {
    for (const tipo of ["NOTA_CREDITO_B", "NOTA_DEBITO_B"] as const) {
      const m = armarElDetalle(
        con({
          tipo,
          acreditado: "0.00",
          acreditacion: null,
          asociado: { tipo: "FACTURA_B", numero: "00001-00000042", fecha: "2026-10-14" },
        }),
      );
      expect(m.corresponde).toBe("Corresponde a Factura B 00001-00000042 del 14/10/2026");
      expect(m.anulado).toBeNull();
    }
    expect(armarElDetalle(con({ tipo: "NOTA_CREDITO_B" })).titulo).toBe(
      "Nota de crédito B 00001-00001234",
    );
    expect(armarElDetalle(con({ tipo: "NOTA_DEBITO_A" })).titulo).toBe(
      "Nota de débito A 00001-00001234",
    );
    expect(armarElDetalle(base).corresponde).toBeNull();
  });

  it("cliente: nombre con su documento formateado; consumidor final con nombre; renglones sin alícuota", () => {
    const cuit = armarElDetalle(
      con({
        receptor: {
          nombre: "Panadería Sol SRL",
          documento: { tipo: "CUIT", numero: "30712345678" },
        },
      }),
    );
    expect(cuit.datos.find((d) => d.rotulo === "Cliente")).toMatchObject({
      valor: "Panadería Sol SRL",
      secundario: "CUIT 30-71234567-8",
    });
    const dni = armarElDetalle(
      con({ receptor: { nombre: "Ana Pérez", documento: { tipo: "DNI", numero: "12345678" } } }),
    );
    expect(dni.datos.find((d) => d.rotulo === "Cliente")?.secundario).toBe("DNI 12.345.678");
    const consumidor = armarElDetalle(
      con({ receptor: { nombre: "Ana", documento: { tipo: "SIN_IDENTIFICAR" } } }),
    );
    expect(consumidor.datos.find((d) => d.rotulo === "Cliente")).toMatchObject({
      valor: "Ana",
      secundario: "Consumidor final",
    });
    const sinIva = armarElDetalle(
      con({
        renglones: [
          {
            descripcion: "A",
            cantidad: "1.5000",
            precioUnitario: "10.000000",
            alicuota: null,
            importe: "15.00",
          },
          {
            descripcion: "B",
            cantidad: "1.0000",
            precioUnitario: "10.000000",
            alicuota: "EXENTO",
            importe: "10.00",
          },
          {
            descripcion: "C",
            cantidad: "1.0000",
            precioUnitario: "10.000000",
            alicuota: "10.5",
            importe: "10.00",
          },
        ],
      }),
    );
    expect(sinIva.renglones.map((r) => r.iva)).toEqual([null, null, "IVA 10,5 %"]);
    expect(sinIva.renglones[0]?.cuenta).toBe("1,5 × $ 10,00");
  });

  it("un importe enorme llega sin perder dígitos hasta el HTML", () => {
    const html = visible(con({ importes: { total: "12345678901234567890.12" } }));
    expect(html).toContain("$ 12.345.678.901.234.567.890,12");
  });
});
