import { describe, expect, it } from "vitest";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  entradaDeAnularElTicket,
  entradaDeCobrarLaVenta,
  entradaDeOpcionesDeCobro,
} from "./entradas-de-cobrar";
import { accionDeCobrar, traducirErrorDeCobrar } from "./errores-de-cobrar";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const GENERICO = { codigo: "CAJA_ACCION_NO_PERMITIDA" };

describe("traducirErrorDeCobrar", () => {
  it.each([
    "CLAVE_REUTILIZADA",
    "CLAVE_INVALIDA",
    "TICKET_YA_COBRADO",
    "SIN_SESION_ABIERTA",
    "CAJA_EN_CIERRE",
    "SESION_DE_CAJA_CAMBIO",
    "CAJA_NO_ENCONTRADA_PARA_COBRAR",
    "DEPARTAMENTO_REQUERIDO",
    "IMPORTE_INVALIDO",
    "COBROS_INVALIDOS",
    "PRODUCTO_OCULTO",
    "SUCURSAL_FUERA_DE_ALCANCE",
    "TICKET_NO_ENCONTRADO",
    "MOTIVO_OBLIGATORIO",
    "ENTRADA_INVALIDA",
    "NO_ES_UN_CODIGO_QUE_EXISTA",
  ])("el error de negocio %s sale como el genérico aprobado", (error) => {
    expect(traducirErrorDeCobrar(error)).toEqual(GENERICO);
  });

  it("los errores con forma de objeto del negocio también (precio que cambió, cobro que no cuadra, dato mal escrito, confirmación)", () => {
    for (const error of [
      { error: "PRECIO_CAMBIO", totalActual: { moneda: "ARS", monto: "1.00" }, lineas: [] },
      { error: "COBRO_NO_CUADRA", falta: "10.00" },
      { error: "COBRO_NO_CUADRA", sobra: "10.00" },
      { error: "TICKET_YA_COBRADO", cobranzaId: ID },
      { error: "CONFIRMACION_REQUERIDA", clave: "VENTA_A_CERO" },
      { codigo: "DATO_DE_COBRO_INVALIDO", dato: "dni", motivo: "FORMA" },
      { codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "cupon" },
    ]) {
      expect(traducirErrorDeCobrar(error), JSON.stringify(error)).toEqual(GENERICO);
    }
  });

  it("nada del valor del error (ni el DNI ni el total) llega a la respuesta genérica", () => {
    expect(
      JSON.stringify(
        traducirErrorDeCobrar({ codigo: "DATO_DE_COBRO_INVALIDO", dato: "dni", valor: "30123456" }),
      ),
    ).toBe(JSON.stringify(GENERICO));
  });

  it("el guard y la empresa que no opera pasan sin cambios (tienen su código)", () => {
    expect(traducirErrorDeCobrar("MODULO_NO_ACTIVO")).toBe("MODULO_NO_ACTIVO");
    for (const motivo of [
      "MODULO_EN_DESARROLLO",
      "MODULO_EN_SOLO_LECTURA",
      "SIN_CAPACIDAD",
      "SIN_PERMISO",
    ]) {
      expect(traducirErrorDeCobrar(motivo)).toBe(motivo);
    }
    const sinOperar = { codigo: "EMPRESA_NO_OPERA", motivo: "SUSPENDIDA" };
    expect(traducirErrorDeCobrar(sinOperar)).toBe(sinOperar);
  });

  it("lo inesperado de la base o del módulo pasa sin cambios para salir con su referencia, no como un genérico que lo esconde", () => {
    for (const inesperado of [
      "INVARIANTE_DE_VENTAS",
      "ERROR_DE_LA_BASE_NO_TRADUCIDO",
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "XX000", mensaje: "secreto de la base" },
      { tipo: "AccesoDenegado" },
    ]) {
      expect(traducirErrorDeCobrar(inesperado)).toBe(inesperado);
    }
  });
});

describe("accionDeCobrar", () => {
  const registrados: string[] = [];
  const respuesta = {
    registrar: (d: string) => registrados.push(d),
    azar: () => new Uint8Array([1, 2, 3, 4]),
  };

  it("un pedido sin la forma pedida es el genérico y no corre nada", async () => {
    let corrio = false;
    const r = await accionDeCobrar(
      respuesta,
      { cajaId: "no-es-uuid" },
      entradaDeOpcionesDeCobro,
      async () => {
        corrio = true;
        return ok(1);
      },
      (x) => x,
    );
    expect(corrio).toBe(false);
    expect(r).toMatchObject({ ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } });
  });

  it("un error del negocio sale genérico, sin detalle", async () => {
    const r = await accionDeCobrar(
      respuesta,
      { cajaId: ID },
      entradaDeOpcionesDeCobro,
      async () => err({ error: "COBRO_NO_CUADRA", sobra: "5.00" }),
      (x) => x,
    );
    expect(r).toMatchObject({ ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } });
    expect(JSON.stringify(r)).not.toContain("5.00");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    registrados.length = 0;
    const r = await accionDeCobrar(
      respuesta,
      { cajaId: ID },
      entradaDeOpcionesDeCobro,
      async () => {
        throw new Error("password=hunter2 en la base");
      },
      (x) => x,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(registrados.join(" ")).toContain("hunter2");
  });
});

describe("entradas de cobrar", () => {
  const venta = () => ({
    claveIdempotencia: "clave-0123456789abcdef",
    cuentaId: ID,
    ejemplarId: ID,
    lineas: [{ lineaId: ID, productoId: ID, opcionIds: [], cantidad: "1" }],
    totalEsperado: { moneda: "ARS", monto: "1000.00" },
    cajaId: ID,
    cobros: [
      {
        medioDePagoId: ID,
        cuentaDeCobroId: null,
        importe: { moneda: "ARS", monto: "1000.00" },
        datos: { cupon: "ZX-1", ultimos4: "4242", cuotas: 3, dni: "30123456" },
      },
    ],
  });

  it("acepta la forma completa", () => {
    expect(entradaDeCobrarLaVenta(venta()).ok).toBe(true);
  });
  it("lista de permitidos: una clave de más rechaza todo el pedido (sucursal, departamento, número de tarjeta, importes como número)", () => {
    expect(entradaDeCobrarLaVenta({ ...venta(), sucursalId: ID }).ok).toBe(false);
    expect(entradaDeCobrarLaVenta({ ...venta(), departamentoId: ID }).ok).toBe(false);
    const conTarjeta = venta();
    expect(
      entradaDeCobrarLaVenta({
        ...conTarjeta,
        cobros: [{ ...conTarjeta.cobros[0], datos: { numeroDeTarjeta: "4509953566233704" } }],
      }).ok,
    ).toBe(false);
    expect(entradaDeCobrarLaVenta({ ...venta(), totalEsperado: 1000 }).ok).toBe(false);
    expect(
      entradaDeCobrarLaVenta({ ...venta(), totalEsperado: { moneda: "ARS", monto: 1000 } }).ok,
    ).toBe(false);
  });
  it("ids mal formados, cuotas no enteras y tipos equivocados se rechazan", () => {
    expect(entradaDeCobrarLaVenta({ ...venta(), cuentaId: "x" }).ok).toBe(false);
    const c = venta();
    expect(
      entradaDeCobrarLaVenta({ ...c, cobros: [{ ...c.cobros[0], datos: { cuotas: 2.5 } }] }).ok,
    ).toBe(false);
    expect(
      entradaDeCobrarLaVenta({ ...c, cobros: [{ ...c.cobros[0], datos: { dni: 30123456 } }] }).ok,
    ).toBe(false);
    for (const malo of [null, undefined, "x", 3, []])
      expect(entradaDeCobrarLaVenta(malo).ok).toBe(false);
  });
  it("anular: pide los dos ejemplares, la clave y el motivo, y nada más", () => {
    const base = {
      claveIdempotencia: "clave-0123456789abcdef",
      ticketId: ID,
      ejemplarBaseId: ID,
      ejemplarNuevoId: ID,
      motivo: "Error de carga",
    };
    expect(entradaDeAnularElTicket(base).ok).toBe(true);
    expect(entradaDeAnularElTicket({ ...base, ejemplarNuevoId: undefined }).ok).toBe(false);
    expect(entradaDeAnularElTicket({ ...base, sucursalId: ID }).ok).toBe(false);
  });
});
