import { describe, expect, it } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import { traducirErrorFiscal } from "../../src/composicion/errores-fiscales";
import { FILTROS_POR_DEFECTO } from "../../apps/web/ui/plantillas/facturacion/filtros-del-listado";
import {
  armarElListado,
  armarLaEleccionDeSucursal,
  errorParaElListado,
} from "../../apps/web/ui/plantillas/facturacion/modelo-del-listado";
import { conNombre, fila, ID_1, PAGINA, SUCURSALES } from "../utilidades/listado-de-comprobantes";

/** El modelo del listado: cada fila con el formato del detalle, la etiqueta de anulación, el vacío y la página siguiente. */

const armar = (...filas: Parameters<typeof fila>[0][]) =>
  armarElListado({ items: filas.map((f) => fila(f)), siguiente: null }, FILTROS_POR_DEFECTO);

describe("las filas", () => {
  it("una factura autorizada a consumidor final: comprobante con número, fecha, importe y estado", () => {
    expect(armar({}).filas[0]).toEqual({
      id: ID_1,
      href: `/facturacion/comprobantes/${ID_1}`,
      comprobante: "Factura B 00001-00001234",
      fecha: "14/10/2026",
      cliente: "Consumidor final",
      documento: "—",
      total: "$ 9.000,00",
      estado: { texto: "Autorizada", tono: "exito" },
      anulacion: null,
    });
  });

  it("sin número todavía (no autorizada), el comprobante es «Factura A» a secas", () => {
    const f = armar({ tipo: "FACTURA_A", numero: null, estado: "EN_VALIDACION" }).filas[0];
    expect(f?.comprobante).toBe("Factura A");
    expect(f?.estado).toEqual({ texto: "Validando", tono: "info" });
  });

  it("el documento tiene el formato del detalle: CUIT con guiones, DNI con puntos, sin identificar con raya", () => {
    const filas = armar(
      conNombre("Panadería Sol SRL"),
      { receptorNombre: "Juan Pérez", receptorDocumento: { tipo: "DNI", numero: "27345678" } },
      { receptorNombre: "Ana", receptorDocumento: { tipo: "PASAPORTE", numero: "AB123456" } },
      { receptorNombre: "Sin documento" },
    ).filas;
    expect(filas.map((f) => [f.cliente, f.documento])).toEqual([
      ["Panadería Sol SRL", "CUIT 30-71234567-8"],
      ["Juan Pérez", "DNI 27.345.678"],
      ["Ana", "Pasaporte AB123456"],
      ["Sin documento", "—"],
    ]);
  });

  it.each([
    ["PENDIENTE", "Pendiente de enviar", "neutro"],
    ["EN_VALIDACION", "Validando", "info"],
    ["AUTORIZADO", "Autorizada", "exito"],
    ["RECHAZADO", "Rechazada", "peligro"],
    ["INCIERTO", "Confirmando", "aviso"],
    ["CONFLICTO", "Requiere revisión", "peligro"],
    ["DESCARTADO", "Descartada", "neutro"],
  ] as const)("el estado %s se ve «%s» (D-25), con su tono", (estado, textoEsperado, tono) => {
    expect(armar({ estado }).filas[0]?.estado).toEqual({ texto: textoEsperado, tono });
  });

  it("la etiqueta de anulación va solo en una factura autorizada (D-29)", () => {
    const etiquetas = (
      acreditacion: "NINGUNA" | "PARCIAL" | "TOTAL" | null,
      estado = "AUTORIZADO" as const,
    ) => armar({ acreditacion, estado }).filas[0]?.anulacion;
    expect(etiquetas("PARCIAL")).toBe("Anulación parcial");
    expect(etiquetas("TOTAL")).toBe("Anulación total");
    expect(etiquetas("NINGUNA")).toBeNull();
    expect(etiquetas(null)).toBeNull();
    // El estado no cambia: sigue «Autorizada».
    expect(armar({ acreditacion: "TOTAL" }).filas[0]?.estado.texto).toBe("Autorizada");
    // Una que no está autorizada no la muestra aunque venga con valor.
    expect(etiquetas("PARCIAL", "RECHAZADO" as never)).toBeNull();
  });

  it("los importes grandes no pierden dígitos (texto, nunca número)", () => {
    expect(armar({ total: "12345678901234567890.12" }).filas[0]?.total).toBe(
      "$ 12.345.678.901.234.567.890,12",
    );
  });
});

describe("el vacío y la página siguiente", () => {
  it("sin comprobantes: el texto del contrato con «Limpiar»", () => {
    const m = armarElListado({ items: [], siguiente: null }, FILTROS_POR_DEFECTO);
    expect(m.vacio).toBe(
      "No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».",
    );
    expect(m.filas).toEqual([]);
  });

  it("con comprobantes no hay texto de vacío", () => {
    expect(armarElListado(PAGINA, FILTROS_POR_DEFECTO).vacio).toBeNull();
  });

  it("«Página siguiente» solo si la consulta dio otra página, y conserva los filtros", () => {
    expect(armar({}).siguiente).toBeNull();
    const m = armarElListado(PAGINA, { ...FILTROS_POR_DEFECTO, estado: "RECHAZADO" });
    expect(m.siguiente?.texto).toBe("Página siguiente");
    const url = new URL(m.siguiente?.href ?? "", "https://app.ejemplo.test");
    expect(url.searchParams.get("estado")).toBe("RECHAZADO");
    expect(url.searchParams.get("despues")).toBe(PAGINA.siguiente);
  });

  it("las columnas son las del contrato, sin Pago, Origen ni Referencias", () => {
    expect(Object.values(armarElListado(PAGINA, FILTROS_POR_DEFECTO).columnas)).toEqual([
      "Fecha",
      "Comprobante",
      "Cliente",
      "Documento",
      "Total",
      "Estado",
    ]);
  });
});

describe("la elección de sucursal", () => {
  it("con varias, se ofrecen todas y la cerrada va marcada (D-37)", () => {
    const e = armarLaEleccionDeSucursal(SUCURSALES, "s-centro");
    expect(e?.opciones).toEqual([
      { valor: "s-centro", etiqueta: "Centro" },
      { valor: "s-norte", etiqueta: "Norte · Cerrada" },
    ]);
    expect(e?.rotulo).toBe("Sucursal");
    expect(e?.aplicar).toBe("Ver comprobantes");
    expect(e?.invitacion).toBeNull();
  });

  it("sin una elegida, invita a elegir (D-36)", () => {
    expect(armarLaEleccionDeSucursal(SUCURSALES, "")?.invitacion).toBe(
      "Elegí una sucursal para ver sus comprobantes.",
    );
  });

  it("con una sola abierta que el servidor tomó sola no hay nada que elegir: sin selector (D-36)", () => {
    expect(armarLaEleccionDeSucursal([SUCURSALES[0]], "s-centro")).toBeNull();
  });

  it("con una sola y cerrada (que no se toma sola) sí se ofrece, para elegirla", () => {
    expect(armarLaEleccionDeSucursal([SUCURSALES[1]], "")?.opciones).toHaveLength(1);
  });

  it("D-37: con una sola y cerrada, ya elegida, el selector sigue y la marca «Cerrada» se ve", () => {
    const e = armarLaEleccionDeSucursal([SUCURSALES[1]], "s-norte");
    expect(e).not.toBeNull();
    expect(e?.elegida).toBe("s-norte");
    expect(e?.opciones).toEqual([{ valor: "s-norte", etiqueta: "Norte · Cerrada" }]);
    expect(e?.invitacion).toBeNull();
  });

  it("sin ninguna que elegir, nada", () => {
    expect(armarLaEleccionDeSucursal([], "")).toBeNull();
  });
});

/** El error del listado tal como sale del traductor real de un criterio inválido de la consulta, ya pasado por la pantalla. */
const filtroInvalido = (criterio: string) => {
  const { campo } = traducirErrorFiscal(criterio) as { campo: string };
  return errorParaElListado({ ...errorDeCodigo("FISCAL_FILTRO_INVALIDO"), campo });
};

describe("el error de la lista", () => {
  it("un error inesperado dice «No pudimos cargar la lista…» y conserva la referencia", () => {
    const inesperado = { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" };
    const e = errorParaElListado(inesperado);
    expect(e.clave).toBe("fiscal.pantalla.listado_error");
    expect(e.referencia).toBe("PD-ABC123");
  });

  it("fechas invertidas (guía §4.6): «La fecha «desde» es posterior a «hasta».»", () => {
    // El error sale del traductor real: el campo `hasta` es el que lo distingue de otro filtro inválido.
    expect(traducirErrorFiscal("FECHAS_INVERTIDAS")).toEqual({
      codigo: "FISCAL_FILTRO_INVALIDO",
      campo: "hasta",
    });
    const e = filtroInvalido("FECHAS_INVERTIDAS");
    expect(texto({}, e.clave)).toBe("La fecha «desde» es posterior a «hasta».");
  });

  it("texto demasiado largo (guía §4.6): «Buscá con menos letras.»", () => {
    const e = filtroInvalido("TEXTO_DEMASIADO_LARGO");
    expect(texto({}, e.clave)).toBe("Buscá con menos letras.");
  });

  it("otro filtro inválido conserva el texto general", () => {
    const e = filtroInvalido("LETRA_INVALIDA");
    expect(texto({}, e.clave)).toBe("Los filtros del listado no son válidos.");
  });

  it.each([
    "SIN_PERMISO",
    "NO_DISPONIBLE",
    "SESION_VENCIDA",
    "FISCAL_SUCURSAL_FUERA_DE_ALCANCE",
  ] as const)("%s conserva su texto del catálogo", (codigo) => {
    const e = errorDeCodigo(codigo);
    expect(errorParaElListado(e)).toBe(e);
  });
});
