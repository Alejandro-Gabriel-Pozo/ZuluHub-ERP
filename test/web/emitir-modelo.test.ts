import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { CODIGOS_DE_ALICUOTA } from "../../src/modulos/fiscal/dominio/alicuota";
import { TIPOS_DE_DOCUMENTO } from "../../src/modulos/fiscal/dominio/receptor";
import { CONDICIONES_DE_IVA } from "../../src/primitivas/identificacion-fiscal/condicion-iva";
import {
  calcularLaEmision,
  clienteInicial,
  conDocumento,
  DOCUMENTOS_PARA_ELEGIR,
  documentoElegidoDe,
  renglonVacio,
  type ClienteEscrito,
  type RenglonEscrito,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-emision";
import {
  ALICUOTAS_PARA_ELEGIR,
  aPuntosParaEmitir,
  puntoDeVentaElegido,
  vistaDeLaRevision,
  vistaDeLosPasos,
  vistaDeLosRenglones,
  vistaDelCliente,
  type PuntoParaEmitir,
} from "../../apps/web/ui/plantillas/facturacion/modelo-de-emision";

/**
 * Lo que se ve de Emitir (8B, por pasos): los textos, las listas para elegir y lo que muestra «Revisar», con el contrato en las dos
 * direcciones (lo que está y lo que quedó afuera: letra D-26, servicios D-84, descuento y modo de precio D-85, forma de pago D-23).
 */

const P1: PuntoParaEmitir = { id: "p1", numero: 1, ambiente: "PRODUCCION" };
const P2: PuntoParaEmitir = { id: "p2", numero: 2, ambiente: "HOMOLOGACION" };

const renglon = (cambios: Partial<RenglonEscrito> = {}): RenglonEscrito => ({
  ...renglonVacio(1),
  descripcion: "Hospedaje · 3 noches",
  cantidad: "1",
  precio: "75000.00",
  alicuota: "21",
  ...cambios,
});
const cliente = (cambios: Partial<ClienteEscrito> = {}): ClienteEscrito => ({
  ...conDocumento(clienteInicial, "DNI"),
  numero: "27345678",
  nombre: "Juan Pérez",
  condicionIva: "CONSUMIDOR_FINAL",
  ...cambios,
});
const revision = (
  puntos: readonly PuntoParaEmitir[],
  puntoElegido = "",
  quien: ClienteEscrito = clienteInicial,
  renglones: readonly RenglonEscrito[] = [
    renglon(),
    renglon({ id: 2, descripcion: "Desayuno · 3 días", cantidad: "3", precio: "5000.00" }),
  ],
  discriminaIva = true,
) =>
  vistaDeLaRevision(
    {},
    {
      cliente: quien,
      renglones,
      calculo: calcularLaEmision(renglones),
      discriminaIva,
      puntos,
      puntoElegido,
    },
  );

describe("las listas para elegir son las del dominio", () => {
  // Previene: ofrecer un tipo de documento o una alícuota que el servidor no conoce, o dejar afuera uno que sí.
  it("tipos de documento", () => {
    expect([...DOCUMENTOS_PARA_ELEGIR].sort()).toEqual([...TIPOS_DE_DOCUMENTO].sort());
  });

  it("alícuotas", () => {
    expect([...ALICUOTAS_PARA_ELEGIR].sort()).toEqual([...CODIGOS_DE_ALICUOTA].sort());
  });

  it("condiciones frente al IVA del receptor: una opción con texto por cada una", () => {
    const vista = vistaDelCliente({}, cliente());
    const opciones = vista.identificacion?.condicion.opciones ?? [];
    expect(opciones.map((o) => o.valor)).toEqual([...CONDICIONES_DE_IVA]);
    for (const o of opciones) expect(o.etiqueta, o.valor).not.toBe("");
  });

  it("el selector devuelve un documento solo si es uno de los que se ofrecen", () => {
    expect(documentoElegidoDe("DNI")).toBe("DNI");
    expect(documentoElegidoDe("SIN_IDENTIFICAR")).toBe("SIN_IDENTIFICAR");
    expect(documentoElegidoDe("LE")).toBeNull();
    expect(documentoElegidoDe("")).toBeNull();
  });
});

describe("los pasos y el cliente", () => {
  it("los tres pasos y los botones, con los textos del prototipo aprobado (8B) y los ya existentes", () => {
    const v = vistaDeLosPasos({});
    expect(v.pasos.map((p) => p.nombre)).toEqual(["Cliente", "Renglones", "Revisar"]);
    expect(v.botones).toEqual({
      siguiente: "Siguiente",
      volver: "Volver",
      emitir: "Emitir factura",
      enviando: "Enviando…",
    });
  });

  it("el consumidor final no pide nada más: un solo selector de documento", () => {
    const v = vistaDelCliente({}, clienteInicial);
    expect(v.identificacion).toBeNull();
    expect(v.documento.etiqueta).toBe("Documento");
    expect(v.documento.opciones.map((o) => o.etiqueta)).toEqual([
      "Consumidor final",
      "CUIT",
      "CUIL",
      "CDI",
      "DNI",
      "Pasaporte",
    ]);
  });

  it("con un documento, pide su número (rotulado con el tipo), el nombre y la condición frente al IVA", () => {
    const v = vistaDelCliente({}, cliente({ documento: "CUIT" }));
    expect(v.identificacion).toMatchObject({
      numero: "CUIT",
      nombre: "Nombre o razón social",
      condicion: { etiqueta: "Condición frente al IVA" },
    });
    expect(v.identificacion?.condicion.opciones.map((o) => o.etiqueta)).toContain(
      "IVA Responsable Inscripto",
    );
  });
});

describe("los renglones: la alícuota solo si la empresa discrimina IVA", () => {
  it("con IVA: «Precio con IVA» (D-85) e «IVA» con las ocho alícuotas", () => {
    const v = vistaDeLosRenglones({}, true);
    expect(v.etiquetas).toMatchObject({
      descripcion: "Descripción",
      cantidad: "Cantidad",
      precio: "Precio con IVA",
      iva: "IVA",
      agregar: "+ Agregar renglón",
    });
    expect(v.alicuotas.map((a) => a.etiqueta)).toEqual([
      "IVA 21 %",
      "IVA 10,5 %",
      "IVA 27 %",
      "IVA 5 %",
      "IVA 2,5 %",
      "IVA 0 %",
      "Exento",
      "No gravado",
    ]);
  });

  it("sin IVA (letra C): ni alícuota ni «con IVA»", () => {
    const v = vistaDeLosRenglones({}, false);
    expect(v.etiquetas.iva).toBeNull();
    expect(v.etiquetas.precio).toBe("Precio");
  });

  it("los grupos y el botón de quitar llevan el número del renglón", () => {
    const v = vistaDeLosRenglones({}, true);
    expect(v.grupo(2)).toBe("Renglón 2");
    expect(v.quitar(2)).toBe("Quitar renglón 2");
  });
});

describe("revisar", () => {
  it("el consumidor final, los renglones con su cuenta y su importe, y el total", () => {
    const v = revision([P1]);
    expect(v.titulo).toBe("Revisá y emití");
    expect(v.cliente).toEqual({
      rotulo: "Cliente",
      principal: "Consumidor final",
      secundario: null,
    });
    expect(v.renglones.filas).toEqual([
      {
        id: 1,
        descripcion: "Hospedaje · 3 noches",
        cuenta: "1 × $ 75.000,00",
        iva: "IVA 21 %",
        importe: "$ 75.000,00",
      },
      {
        id: 2,
        descripcion: "Desayuno · 3 días",
        cuenta: "3 × $ 5.000,00",
        iva: "IVA 21 %",
        importe: "$ 15.000,00",
      },
    ]);
    expect(v.renglones.rotuloDelTotal).toBe("Total");
    expect(v.renglones.total).toBe("$ 90.000,00");
  });

  it("un cliente identificado: su nombre y su documento con el formato de siempre", () => {
    expect(revision([P1], "", cliente()).cliente).toEqual({
      rotulo: "Cliente",
      principal: "Juan Pérez",
      secundario: "DNI 27.345.678",
    });
  });

  it("un pasaporte con letras se muestra completo y en mayúsculas, como lo va a guardar el servidor", () => {
    expect(
      revision([P1], "", cliente({ documento: "PASAPORTE", numero: "abc123456" })).cliente
        .secundario,
    ).toBe("Pasaporte ABC123456");
  });

  it("sin IVA: los renglones no muestran alícuota aunque haya una escrita", () => {
    const v = revision([P1], "", clienteInicial, [renglon({ alicuota: "21" })], false);
    expect(v.renglones.filas[0]?.iva).toBeNull();
  });

  it("no muestra la letra ni el tipo de comprobante (D-26)", () => {
    const texto = JSON.stringify(revision([P1], "", cliente()));
    expect(texto).not.toMatch(/Factura [ABC]|letra|\bFACTURA_/i);
  });
});

describe("el punto de venta (D-6, D-86, D-87; FP-8)", () => {
  it("ninguno activo: sin dónde emitir, con el cartel que ya existe", () => {
    const v = revision([]).puntoDeVenta;
    expect(v).toMatchObject({ modo: "ninguno", texto: "Ninguno activo", avisoDePruebas: null });
    expect(puntoDeVentaElegido([], "")).toBeNull();
  });

  it("uno solo: se usa solo, con sus cinco dígitos y sin elegir", () => {
    const v = revision([P1]).puntoDeVenta;
    expect(v).toMatchObject({ modo: "uno", texto: "00001", avisoDePruebas: null });
    expect(puntoDeVentaElegido([P1], "")).toBe(P1);
  });

  it("uno solo y de pruebas: la marca «Pruebas» y su aviso", () => {
    const v = revision([P2]).puntoDeVenta;
    expect(v).toMatchObject({
      modo: "uno",
      texto: "00002 · Pruebas",
      avisoDePruebas: "Las facturas de pruebas no tienen valor fiscal.",
    });
  });

  it("varios: se eligen, nunca se toma el primero por la persona; el de pruebas se marca en la lista", () => {
    const sin = revision([P1, P2]).puntoDeVenta;
    expect(sin.modo).toBe("varios");
    expect(sin.opciones).toEqual([
      { valor: "p1", etiqueta: "00001" },
      { valor: "p2", etiqueta: "00002 · Pruebas" },
    ]);
    expect(sin.avisoDePruebas).toBeNull();
    expect(puntoDeVentaElegido([P1, P2], "")).toBeNull();
    expect(puntoDeVentaElegido([P1, P2], "otro")).toBeNull();
    expect(puntoDeVentaElegido([P1, P2], "p2")).toBe(P2);
  });

  it("varios y elegido uno de pruebas: aparece el aviso; si elige el de producción, no", () => {
    expect(revision([P1, P2], "p2").puntoDeVenta.avisoDePruebas).toBe(
      "Las facturas de pruebas no tienen valor fiscal.",
    );
    expect(revision([P1, P2], "p1").puntoDeVenta.avisoDePruebas).toBeNull();
  });

  it("de la lectura del servidor solo se copia lo que la pantalla usa", () => {
    const delServidor = [{ ...P1, sucursalId: "s1", domicilio: "Calle 1" }] as const;
    expect(aPuntosParaEmitir(delServidor)).toEqual([P1]);
  });
});

describe("el contrato en la otra dirección: lo que no va (violación inyectada)", () => {
  const PROHIBIDOS: readonly (readonly [string, RegExp])[] = [
    ["la letra (D-26)", /factura [abc]\b|\bletra\b/i],
    ["servicios y fechas (D-84)", /servicio|desde|hasta|vencimiento|concepto|producto/i],
    ["descuento o modo de precio (D-85)", /descuento|bonific|iva discriminado|más iva|neto/i],
    ["forma de pago (D-23)", /forma de pago|efectivo|tarjeta|transferencia/i],
    ["imprimir, mail o QR", /imprimir|mail|\bQR\b/i],
    ["alta de clientes (D-24)", /buscar cliente|nuevo cliente|agregar cliente/i],
    ["origen (D-33)", /origen|mostrador|restaurante/i],
  ];
  const visible = (): string =>
    JSON.stringify([
      vistaDeLosPasos({}),
      vistaDelCliente({}, cliente()),
      vistaDeLosRenglones({}, true),
      revision([P1, P2], "p2", cliente()),
    ]);
  const prohibidosEn = (texto: string): string[] =>
    PROHIBIDOS.filter(([, patron]) => patron.test(texto)).map(([nombre]) => nombre);

  it("la pantalla no los trae", () => {
    expect(prohibidosEn(visible())).toEqual([]);
  });

  it.each([
    ["la letra (D-26)", "Va a salir una Factura B"],
    ["servicios y fechas (D-84)", "Vencimiento de pago"],
    ["descuento o modo de precio (D-85)", "Descuento"],
    ["forma de pago (D-23)", "Forma de pago"],
    ["imprimir, mail o QR", "Imprimir"],
    ["alta de clientes (D-24)", "Buscar cliente"],
  ])("el detector marca %s", (nombre, inyectado) => {
    expect(prohibidosEn(visible() + inyectado)).toContain(nombre);
  });
});

describe("los textos de Emitir: exactamente estos (cada uno con su fuente en el catálogo)", () => {
  it("las claves `emitir_*` y «+ Emitir»", () => {
    const propias = Object.entries(CATALOGO_DE_TEXTOS)
      .filter(([clave]) => /^fiscal\.pantalla\.(emitir_|listado_emitir)/.test(clave))
      .map(([clave, d]) => [clave.replace("fiscal.pantalla.", ""), d.porDefecto]);
    expect(Object.fromEntries(propias)).toEqual({
      emitir_titulo: "Emitir factura",
      emitir_paso_revisar: "Revisar",
      emitir_revisa_y_emiti: "Revisá y emití",
      emitir_agregar_renglon: "+ Agregar renglón",
      listado_emitir: "+ Emitir",
      emitir_descripcion: "Descripción",
      emitir_cantidad: "Cantidad",
      emitir_precio_con_iva: "Precio con IVA",
      emitir_iva: "IVA",
      emitir_nombre: "Nombre o razón social",
      emitir_precio: "Precio",
      emitir_renglon_numero: "Renglón {numero}",
      emitir_quitar_renglon: "Quitar renglón {numero}",
      emitir_punto_de_venta_con_marca: "{numero} · {marca}",
      emitir_condicion_responsable_inscripto: "IVA Responsable Inscripto",
      emitir_condicion_monotributo: "Responsable Monotributo",
      emitir_condicion_monotributista_social: "Monotributista Social",
      emitir_condicion_monotributo_promovido: "Monotributo Trabajador Independiente Promovido",
      emitir_condicion_exento: "IVA Sujeto Exento",
      emitir_condicion_no_categorizado: "Sujeto No Categorizado",
      emitir_condicion_proveedor_del_exterior: "Proveedor del Exterior",
      emitir_condicion_cliente_del_exterior: "Cliente del Exterior",
      emitir_condicion_iva_liberado: "IVA Liberado – Ley N° 19.640",
      emitir_condicion_iva_no_alcanzado: "IVA No Alcanzado",
      emitir_condicion_consumidor_final: "Consumidor Final",
    });
  });

  it("las tres condiciones que repiten las del emisor (D-44) dicen lo mismo que ellas", async () => {
    const { opcionesDeDatosFiscales } =
      await import("../../src/composicion/opciones-de-datos-fiscales");
    const delEmisor = Object.fromEntries(
      opcionesDeDatosFiscales().condicionesDeIva.map((o) => [o.valor, o.texto]),
    );
    const delReceptor = Object.fromEntries(
      vistaDelCliente({}, cliente()).identificacion?.condicion.opciones.map((o) => [
        o.valor,
        o.etiqueta,
      ]) ?? [],
    );
    for (const [valor, texto] of Object.entries(delEmisor))
      expect(delReceptor[valor], valor).toBe(texto);
  });
});
