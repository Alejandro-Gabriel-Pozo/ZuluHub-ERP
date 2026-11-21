import { describe, expect, it } from "vitest";
import { err, ok } from "../primitivas/resultado/resultado";
import { accionDeCompras, traducirErrorDeCompras } from "./errores-de-compras";
import { entradaDeEstadoDeCaja } from "./entradas-de-caja";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const GENERICO = { codigo: "COMPRAS_ACCION_NO_PERMITIDA" };

describe("traducirErrorDeCompras", () => {
  it.each([
    ["PRECIO_INVALIDO", "COMPRAS_PRECIO_INVALIDO"],
    ["PROVEEDOR_NO_ENCONTRADO", "COMPRAS_PROVEEDOR_NO_ENCONTRADO"],
    ["PUNTO_DE_VENTA_NO_DECLARADO", "COMPRAS_PUNTO_DE_VENTA_NO_DECLARADO"],
    ["CANTIDAD_INVALIDA", "COMPRAS_CANTIDAD_INVALIDA"],
  ])("%s sale como %s", (error, codigo) => {
    expect(traducirErrorDeCompras(error)).toEqual({ codigo });
  });

  it.each([
    { error: "REMITO_YA_REGISTRADO", recepcionId: ID },
    { error: "REMITO_YA_REGISTRADO", recepcionId: null },
  ])("un remito ya cargado sale como COMPRAS_REMITO_REPETIDO y no lleva el id (%j)", (error) => {
    expect(traducirErrorDeCompras(error)).toEqual({ codigo: "COMPRAS_REMITO_REPETIDO" });
  });

  it("una factura ya cargada sale como COMPRAS_FACTURA_REPETIDA y no lleva el id", () => {
    expect(
      traducirErrorDeCompras({ error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: ID }),
    ).toEqual({ codigo: "COMPRAS_FACTURA_REPETIDA" });
  });

  it.each([
    "COMPRA_CONSUMIDA",
    "CORRECCION_DESACTUALIZADA",
    "CUIT_REQUERIDO_EN_PRIMERA_FACTURA",
    "CONDICION_DE_IVA_NO_DISPONIBLE",
    "SIN_SESION_ABIERTA",
    "LINEA_SIN_PRECIO",
    // De stock y del directorio: otro módulo puede sumar uno sin romper compras.
    "PRODUCTO_OCULTO",
    "DEPOSITO_INACTIVO",
    "PARTE_NO_ENCONTRADA",
    "UN_ERROR_QUE_NADIE_CONOCE",
  ])("%s sale como el genérico", (error) => {
    expect(traducirErrorDeCompras(error)).toEqual(GENERICO);
  });

  it.each([
    { error: "COMPROBANTE_YA_PAGADO", pagoId: ID },
    { error: "FUNCION_NO_INCLUIDA", perilla: "conciliacion_de_tres_vias" },
    { error: "ALGO_NUEVO" },
  ])(
    "un error de negocio con forma de objeto y sin texto propio sale como el genérico (%j)",
    (e) => {
      expect(traducirErrorDeCompras(e)).toEqual(GENERICO);
    },
  );

  it.each([
    "SIN_PERMISO",
    "MODULO_EN_DESARROLLO",
    "SESION_VENCIDA",
    { codigo: "EMPRESA_NO_OPERA" },
    { tipo: "Inesperado" },
    7,
    null,
    undefined,
  ])("lo que ya es público o no es de negocio pasa sin cambios (%j)", (error) => {
    expect(traducirErrorDeCompras(error)).toBe(error);
  });

  it("solo un TEXTO es un código: un objeto que se lee como uno (toString) pasa sin cambios", () => {
    const disfrazado = { toString: () => "PRECIO_INVALIDO" };
    expect(traducirErrorDeCompras(disfrazado)).toBe(disfrazado);
  });

  it("un nombre heredado del prototipo no es un código: es un texto sin conocer, el genérico", () => {
    expect(traducirErrorDeCompras("constructor")).toEqual(GENERICO);
    expect(traducirErrorDeCompras({ error: "constructor" })).toEqual(GENERICO);
  });
});

describe("traducirErrorDeCompras: todos los errores propios de compras", () => {
  it.each([
    "ALICUOTA_INVALIDA",
    "ALICUOTA_NO_DISCRIMINADA",
    "ALICUOTA_REQUERIDA",
    "ASIGNACIONES_INVALIDAS",
    "ASIGNACION_DE_OTRO_PRODUCTO",
    "ASIGNACION_NO_CONCILIABLE",
    "CAJA_DE_OTRA_SUCURSAL",
    "CAJA_EN_CIERRE",
    "CAJA_INACTIVA",
    "CAJA_NO_ENCONTRADA",
    "CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO",
    "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO",
    "CANTIDAD_SEGUN_REMITO_INVALIDA",
    "COMPRA_CONSUMIDA",
    "COMPRA_SIMPLE_NO_LLEVA_FACTURA",
    "COMPROBANTE_ANULADO",
    "COMPROBANTE_CONCILIADO",
    "COMPROBANTE_CON_NOTA_DE_CREDITO",
    "COMPROBANTE_NO_ENCONTRADO",
    "COMPROBANTE_NO_PAGABLE",
    "CONCILIACION_NO_ENCONTRADA",
    "CONCILIACION_YA_ANULADA",
    "CONDICION_DE_IVA_NO_DISPONIBLE",
    "CONDICION_INVALIDA",
    "CONTROL_INVALIDO",
    "CORRECCION_DESACTUALIZADA",
    "CUIT_INVALIDO",
    "CUIT_REQUERIDO_EN_PRIMERA_FACTURA",
    "DEPOSITO_A_ELEGIR",
    "DEPOSITO_DE_CALIDAD_NO_CONFIGURADO",
    "DEVOLUCION_DE_OTRO_PRODUCTO",
    "DEVOLUCION_DE_OTRO_PROVEEDOR",
    "DEVOLUCION_DE_RECEPCION_NO_CONFIRMADA",
    "DEVOLUCION_EXCEDE_LO_RECIBIDO",
    "DEVOLUCION_NO_ENCONTRADA",
    "DIFERENCIA_ANULADA",
    "DIFERENCIA_NO_ENCONTRADA",
    "DIFERENCIA_YA_RESUELTA",
    "EGRESO_DE_CAJA_NO_ANULABLE",
    "EGRESO_DE_CAJA_RECHAZADO",
    "FACTURA_NO_CORRESPONDE_AL_NIVEL",
    "FACTURA_REQUERIDA",
    "FECHA_INVALIDA",
    "FUERA_DE_RANGO",
    "JORNADA_DE_CAJA_NO_ABIERTA",
    "LINEAS_REQUERIDAS",
    "LINEA_DE_ORDEN_DE_OTRO_PRODUCTO",
    "LINEA_DE_ORDEN_RETIRADA",
    "LINEA_NO_ENCONTRADA",
    "LINEA_REPETIDA",
    "LINEA_SIN_PRECIO",
    "MEDIO_INVALIDO",
    "MONEDA_NO_SOPORTADA",
    "MOTIVO_DE_DEVOLUCION_INVALIDO",
    "NIVEL_INVALIDO",
    "NOTA_DE_CREDITO_DE_FACTURA_ANULADA",
    "NOTA_DE_CREDITO_DE_OTRO_PROVEEDOR",
    "NOTA_DE_CREDITO_EXCEDE_LA_FACTURA",
    "NOTA_DE_CREDITO_NO_ENCONTRADA",
    "NOTA_DE_CREDITO_SIN_FACTURA",
    "NUMERO_DE_COMPROBANTE_INVALIDO",
    "OBSERVACION_INVALIDA",
    "OBSERVACION_REQUERIDA",
    "ORDEN_CON_RECEPCIONES",
    "ORDEN_CON_RECEPCIONES_PENDIENTES",
    "ORDEN_DE_OTRO_PROVEEDOR",
    "ORDEN_NO_CORRESPONDE_AL_NIVEL",
    "ORDEN_NO_ENCONTRADA",
    "ORDEN_NO_ESTA_PEDIDA",
    "ORDEN_NO_ES_BORRADOR",
    "ORDEN_YA_CERRADA",
    "PAGO_NO_ENCONTRADO",
    "PAGO_YA_ANULADO",
    "PEDIDO_NO_ENCONTRADO",
    "PEDIDO_YA_PENDIENTE",
    "PEDIDO_YA_RESUELTO",
    "PESO_REAL_NO_CORRESPONDE",
    "PESO_REAL_REQUERIDO",
    "PRECIO_POR_INVALIDO",
    "PRESENTACION_INVALIDA",
    "PRESENTACION_NO_ENCONTRADA",
    "PRODUCTO_NO_COMPRABLE",
    "PROVEEDOR_CON_OTRO_DOCUMENTO",
    "PUNTO_DE_VENTA_INVALIDO",
    "RECEPCION_EXCEDE_LA_ORDEN",
    "RECEPCION_EXCEDE_LA_ORDEN_SIN_CONFIRMAR",
    "RECEPCION_NO_ENCONTRADA",
    "RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL",
    "RECEPCION_YA_ANULADA",
    "RECEPCION_YA_CONFIRMADA",
    "RESOLUCION_INVALIDA",
    "SALIDA_DE_CAJA_INVALIDA",
    "SALIDA_DE_CAJA_SOLO_EN_EFECTIVO",
    "SIN_SESION_ABIERTA",
    "TEMPERATURA_INVALIDA",
    "TIPO_DE_COMPROBANTE_INVALIDO",
    "TOLERANCIA_INVALIDA",
    "TOTAL_INVALIDO",
    "TRIBUTO_INVALIDO",
    "UNIDAD_DE_PRECIO_REQUERIDA",
    "VINCULO_INVALIDO",
  ])("%s sale como el genérico (no tiene texto propio)", (error) => {
    expect(traducirErrorDeCompras(error)).toEqual(GENERICO);
  });
});

describe("accionDeCompras", () => {
  const registrados: string[] = [];
  const respuesta = {
    registrar: (d: string) => registrados.push(d),
    azar: () => new Uint8Array(4),
  };
  const leer = entradaDeEstadoDeCaja;

  it("un pedido sin forma da el genérico y no corre nada", async () => {
    let corrio = false;
    const r = await accionDeCompras(
      respuesta,
      { cajaId: "no" },
      leer,
      () => {
        corrio = true;
        return Promise.resolve(ok(1));
      },
      (n) => n,
    );
    expect(corrio).toBe(false);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "COMPRAS_ACCION_NO_PERMITIDA",
        clave: "compras.error.sin_permiso",
        presentacion: "AVISO",
      },
    });
  });

  it("un resultado ok se presenta con lo que la pantalla necesita", async () => {
    const r = await accionDeCompras(
      respuesta,
      { cajaId: ID },
      leer,
      () => Promise.resolve(ok({ id: ID, interno: "secreto" })),
      (s) => ({ id: s.id }),
    );
    expect(r).toEqual({ ok: true, dato: { id: ID } });
  });

  it("un error del dominio sale con su código público de compras", async () => {
    const r = await accionDeCompras(
      respuesta,
      { cajaId: ID },
      leer,
      () => Promise.resolve(err({ error: "REMITO_YA_REGISTRADO", recepcionId: ID })),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("COMPRAS_REMITO_REPETIDO");
  });

  it("un error del guard pasa con su motivo", async () => {
    const r = await accionDeCompras(
      respuesta,
      { cajaId: ID },
      leer,
      () => Promise.resolve(err("SIN_PERMISO")),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const r = await accionDeCompras(
      respuesta,
      { cajaId: ID },
      leer,
      () => Promise.reject(new Error("relation x does not exist")),
      () => 1,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r.error)).not.toContain("relation");
    expect(registrados.some((x) => x.includes("relation x does not exist"))).toBe(true);
  });
});
