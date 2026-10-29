import { describe, expect, it } from "vitest";
import {
  anulacionTotal,
  escribirImporte,
  pasarAUnaParte,
  type EleccionDeAnulacion,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-anulacion";
import {
  accionDeAnularDelDetalle,
  armarLaVista,
  contadorDelMotivo,
  porQueNoSeAnula,
} from "../../apps/web/ui/plantillas/facturacion/modelo-de-anulacion";
import { conFactura, factura, facturaC, ID_FACTURA, notaAnterior } from "../utilidades/anulacion";

/**
 * Lo que se ve de la pantalla de anular por importe (12A): los textos son los que el dueño aprobó el 2026-10-29 (el aviso y los
 * nombres de fila incluidos), las cifras las del cálculo, y qué se ofrece a quién.
 */

const unaParte = (...escritos: [string, string][]): EleccionDeAnulacion =>
  escritos.reduce(
    (e, [clave, valor]) => escribirImporte(e, clave, valor),
    pasarAUnaParte(anulacionTotal),
  );

describe("paso 1, el total (por defecto)", () => {
  it("«Se anula el total», «Total de la factura» con su importe y «Anular solo una parte»", () => {
    const v = armarLaVista({}, factura, anulacionTotal);
    expect(v.titulo).toBe("Anular comprobante");
    expect(v.subtitulo).toBe("Factura B 00001-00000123 · Juan Pérez");
    expect(v.pasos.map((p) => p.nombre)).toEqual(["Qué anular", "Motivo y revisar"]);
    expect(v.queAnular).toMatchObject({
      titulo: "Se anula el total",
      parcial: false,
      filas: [],
      fila: { rotulo: "Total de la factura", importe: "$ 90.750,00" },
      cambiarDeModo: "Anular solo una parte",
      sePuedeSeguir: true,
    });
    expect(v.botones).toEqual({
      cancelar: "Cancelar",
      siguiente: "Siguiente",
      volver: "Volver",
      confirmar: "Anular comprobante",
      enviando: "Anulando…",
    });
    expect(v.hrefDeCancelar).toBe(`/facturacion/comprobantes/${ID_FACTURA}`);
  });
});

describe("paso 1, solo una parte", () => {
  it("una fila por alícuota, con su nombre, lo facturado y la etiqueta del campo; «A anular» arranca en cero y no se puede seguir", () => {
    const v = armarLaVista({}, factura, pasarAUnaParte(anulacionTotal));
    expect(v.queAnular.titulo).toBe("Elegí qué anular");
    expect(v.queAnular.filas).toEqual([
      {
        clave: "21",
        nombre: "IVA 21 %",
        facturado: { rotulo: "Facturado", importe: "$ 60.500,00" },
        etiquetaDelCampo: "Importe a anular (con IVA incluido)",
        valor: "",
        aviso: null,
      },
      {
        clave: "10.5",
        nombre: "IVA 10,5 %",
        facturado: { rotulo: "Facturado", importe: "$ 30.250,00" },
        etiquetaDelCampo: "Importe a anular (con IVA incluido)",
        valor: "",
        aviso: null,
      },
    ]);
    expect(v.queAnular.fila).toEqual({ rotulo: "A anular", importe: "$ 0,00" });
    expect(v.queAnular.cambiarDeModo).toBe("Anular el total");
    expect(v.queAnular.sePuedeSeguir).toBe(false);
  });

  it("el prototipo: $ 20.000,00 al 21 % y $ 40.000,00 al 10,5 % suman $ 60.000,00 y avisa en la segunda, sin bloquear", () => {
    const v = armarLaVista({}, factura, unaParte(["21", "20000.00"], ["10.5", "40000.00"]));
    expect(v.queAnular.fila).toEqual({ rotulo: "A anular", importe: "$ 60.000,00" });
    expect(v.queAnular.filas.map((f) => [f.valor, f.aviso])).toEqual([
      ["20000.00", null],
      ["40000.00", "El importe supera lo facturado con IVA 10,5 %."],
    ]);
    expect(v.queAnular.sePuedeSeguir).toBe(true);
  });

  it("el aviso lleva la tasa que corresponde («IVA 21 %»)", () => {
    const v = armarLaVista({}, factura, unaParte(["21", "60500.01"]));
    expect(v.queAnular.filas[0]?.aviso).toBe("El importe supera lo facturado con IVA 21 %.");
  });

  it("letra C: una sola fila, sin nombre de alícuota, «Facturado» y «Importe a anular»", () => {
    const v = armarLaVista({}, facturaC, unaParte(["C", "45000.00"]));
    expect(v.subtitulo).toBe("Factura C 00002-00000045 · Marta Gómez");
    expect(v.queAnular.filas).toEqual([
      {
        clave: "C",
        nombre: null,
        facturado: { rotulo: "Facturado", importe: "$ 45.000,00" },
        etiquetaDelCampo: "Importe a anular",
        valor: "45000.00",
        aviso: null,
      },
    ]);
    expect(v.queAnular.fila.importe).toBe("$ 45.000,00");
  });

  it("letra C: pasarse del total avisa «El importe supera lo facturado.» sin bloquear; justo el total no avisa", () => {
    const v = armarLaVista({}, facturaC, unaParte(["C", "50000.00"]));
    expect(v.queAnular.filas[0]?.aviso).toBe("El importe supera lo facturado.");
    expect(v.queAnular.sePuedeSeguir).toBe(true);
    expect(
      armarLaVista({}, facturaC, unaParte(["C", "45000.00"])).queAnular.filas[0]?.aviso,
    ).toBeNull();
  });

  it("exento y no gravado: una fila por tipo, con su nombre; el aviso de IVA no aplica a ellas por nombre pero sí avisa", () => {
    const f = conFactura({
      alicuotas: [
        { alicuota: "EXENTO", total: "100.00" },
        { alicuota: "NO_GRAVADO", total: "50.00" },
      ],
    });
    const v = armarLaVista({}, f, pasarAUnaParte(anulacionTotal));
    expect(v.queAnular.filas.map((x) => x.nombre)).toEqual(["Exento", "No gravado"]);
    const pasado = armarLaVista({}, f, unaParte(["EXENTO", "100.01"]));
    expect(pasado.queAnular.filas[0]?.aviso).toBe("El importe supera lo facturado.");
  });
});

describe("paso 2, motivo y revisar", () => {
  it("el motivo, el título con la letra de la factura, «A anular ahora», el total y «Sin notas»", () => {
    const { revision } = armarLaVista(
      {},
      factura,
      unaParte(["21", "20000.00"], ["10.5", "40000.00"]),
    );
    expect(revision.motivo).toEqual({
      etiqueta: "Motivo (obligatorio)",
      ayuda: "Queda guardado junto a la nota de crédito.",
    });
    expect(revision.titulo).toBe("Se va a emitir una nota de crédito B");
    expect(revision.aAnularAhora).toEqual({ rotulo: "A anular ahora", importe: "$ 60.000,00" });
    expect(revision.totalDeLaFactura).toEqual({
      rotulo: "Total de la factura",
      importe: "$ 90.750,00",
    });
    expect(revision.anulado).toMatchObject({
      titulo: "Ya anulado con notas de crédito",
      cifra: "$ 0,00",
      sinNotas: "Sin notas",
    });
  });

  it("revisión del total: «A anular ahora» es el total", () => {
    expect(armarLaVista({}, factura, anulacionTotal).revision.aAnularAhora.importe).toBe(
      "$ 90.750,00",
    );
  });

  it("la letra sale de la factura (una A se anula con una A; la C, con una C)", () => {
    const a = conFactura({ tipo: "FACTURA_A" });
    expect(armarLaVista({}, a, anulacionTotal).revision.titulo).toBe(
      "Se va a emitir una nota de crédito A",
    );
    expect(armarLaVista({}, facturaC, anulacionTotal).revision.titulo).toBe(
      "Se va a emitir una nota de crédito C",
    );
  });

  it("con notas anteriores: la cifra y la lista con el estado de cada una, igual que el Detalle, sin tope", () => {
    const f = conFactura({
      acreditado: "100000.00",
      notasQueLoCitan: [
        notaAnterior("n1", "AUTORIZADO", "50000.00"),
        notaAnterior("n2", "EN_VALIDACION", "50000.00", "00001-00000013"),
      ],
    });
    const { revision } = armarLaVista({}, f, anulacionTotal);
    expect(revision.anulado?.cifra).toBe("$ 100.000,00");
    expect(revision.anulado?.notas.map((n) => [n.nombre, n.total, n.estado.texto])).toEqual([
      ["Nota de crédito B 00001-00000012", "$ 50.000,00", "Autorizada"],
      ["Nota de crédito B 00001-00000013", "$ 50.000,00", "Validando"],
    ]);
    expect(JSON.stringify(revision)).not.toMatch(/supera|tope|excede/i);
  });

  it("una nota de débito: mismo título, la letra de la nota, «Total de la nota de débito» y sin «Ya anulado» (D-73: la nota no lo lleva)", () => {
    const nd = conFactura({ tipo: "NOTA_DEBITO_B", numero: "00001-00000200" });
    const v = armarLaVista({}, nd, anulacionTotal);
    expect(v.subtitulo).toBe("Nota de débito B 00001-00000200 · Juan Pérez");
    expect(v.revision.titulo).toBe("Se va a emitir una nota de crédito B");
    expect(v.revision.anulado).toBeNull();
    expect(v.revision.totalDeLaFactura.rotulo).toBe("Total de la nota de débito");
    expect(v.queAnular.fila.rotulo).toBe("Total de la nota de débito");
    expect(armarLaVista({}, factura, anulacionTotal).revision.totalDeLaFactura.rotulo).toBe(
      "Total de la factura",
    );
  });

  it("un consumidor final sin nombre se llama «Consumidor final»", () => {
    const f = conFactura({ receptor: { nombre: null, documento: { tipo: "SIN_IDENTIFICAR" } } });
    expect(armarLaVista({}, f, anulacionTotal).subtitulo).toBe(
      "Factura B 00001-00000123 · Consumidor final",
    );
  });

  it("el contador dice «0 / 200»", () => {
    expect(contadorDelMotivo({}, "", 200)).toBe("0 / 200");
    expect(contadorDelMotivo({}, "Error de carga", 200)).toBe("14 / 200");
  });
});

describe("qué se puede anular y quién ve la acción", () => {
  it("una factura o una nota de débito Autorizada (D-10, D-70)", () => {
    for (const tipo of [
      "FACTURA_A",
      "FACTURA_B",
      "FACTURA_C",
      "NOTA_DEBITO_A",
      "NOTA_DEBITO_B",
      "NOTA_DEBITO_C",
    ] as const) {
      expect(porQueNoSeAnula({ tipo, estado: "AUTORIZADO" })).toBeNull();
    }
  });

  it("una factura o nota de débito que no está Autorizada no se anula", () => {
    for (const tipo of ["FACTURA_B", "NOTA_DEBITO_B"] as const) {
      for (const estado of [
        "PENDIENTE",
        "EN_VALIDACION",
        "RECHAZADO",
        "INCIERTO",
        "CONFLICTO",
        "DESCARTADO",
      ] as const) {
        expect(porQueNoSeAnula({ tipo, estado })).toBe("FISCAL_ASOCIADO_NO_AUTORIZADO");
      }
    }
  });

  it("una nota de crédito no se anula, con ninguna letra", () => {
    for (const tipo of ["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"] as const) {
      expect(porQueNoSeAnula({ tipo, estado: "AUTORIZADO" })).toBe("FISCAL_ASOCIADO_NO_ASOCIABLE");
    }
  });

  it("el botón del detalle: con permiso y Autorizada (factura o nota de débito) apunta a la pantalla; sin permiso, nada", () => {
    const c = { id: ID_FACTURA, tipo: "FACTURA_B", estado: "AUTORIZADO" } as const;
    const boton = {
      href: `/facturacion/comprobantes/${ID_FACTURA}/anular`,
      etiqueta: "Anular con nota de crédito",
      motivo: null,
    };
    expect(accionDeAnularDelDetalle({}, c, true)).toEqual(boton);
    expect(accionDeAnularDelDetalle({}, { ...c, tipo: "NOTA_DEBITO_B" }, true)).toEqual(boton);
    expect(accionDeAnularDelDetalle({}, c, false)).toBeNull();
  });

  it("no Autorizada (factura o nota de débito): el botón va apagado, sin enlace y con el motivo aprobado (D-10, D-70)", () => {
    for (const tipo of ["FACTURA_B", "NOTA_DEBITO_B"] as const) {
      for (const estado of [
        "PENDIENTE",
        "EN_VALIDACION",
        "RECHAZADO",
        "INCIERTO",
        "CONFLICTO",
        "DESCARTADO",
      ] as const) {
        expect(accionDeAnularDelDetalle({}, { id: ID_FACTURA, tipo, estado }, true)).toEqual({
          etiqueta: "Anular con nota de crédito",
          href: null,
          motivo: "Solo se anula una factura o una nota de débito Autorizada.",
        });
      }
    }
    expect(
      accionDeAnularDelDetalle(
        {},
        { id: ID_FACTURA, tipo: "FACTURA_B", estado: "RECHAZADO" },
        false,
      ),
    ).toBeNull();
  });

  it("una nota de crédito: nunca (ni Autorizada ni en otro estado)", () => {
    for (const estado of ["AUTORIZADO", "RECHAZADO", "PENDIENTE"] as const) {
      expect(
        accionDeAnularDelDetalle({}, { id: ID_FACTURA, tipo: "NOTA_CREDITO_B", estado }, true),
      ).toBeNull();
    }
  });

  it("D-75: «con IVA incluido» solo donde hay IVA; letra C, Exento y No gravado dicen «Importe a anular»", () => {
    const etiquetas = (f: typeof factura) =>
      armarLaVista({}, f, pasarAUnaParte(anulacionTotal)).queAnular.filas.map(
        (x) => x.etiquetaDelCampo,
      );
    expect(etiquetas(factura)).toEqual(Array(2).fill("Importe a anular (con IVA incluido)"));
    expect(etiquetas(facturaC)).toEqual(["Importe a anular"]);
    const sinIva = conFactura({
      alicuotas: [
        { alicuota: "EXENTO", total: "1.00" },
        { alicuota: "NO_GRAVADO", total: "1.00" },
        { alicuota: "0", total: "1.00" },
      ],
    });
    expect(etiquetas(sinIva)).toEqual([
      "Importe a anular",
      "Importe a anular",
      "Importe a anular (con IVA incluido)",
    ]);
  });
});
