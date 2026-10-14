import { describe, expect, it } from "vitest";
import type { SolicitudDeAutorizacion } from "../../src/modulos/fiscal/casos-de-uso/emision-electronica";
import {
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "../../src/modulos/fiscal/dominio/codigos-de-arca";
import { coincideConLoRegistrado } from "../../src/modulos/fiscal/dominio/reconciliacion-de-comprobante";
import { importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import {
  CODIGO_DE_RECHAZO_DEL_FALSO,
  CODIGO_FUERA_DE_SECUENCIA,
  EmisionFalsa,
  guionAlAzar,
  solicitudDeAutorizacion,
  type Guion,
} from "./emision-falsa";
import { consumidorFinal, facturaArmada, fecha, renglon } from "./facturacion";
import { CUIT_A, CUIT_B, SOLICITUD_1 } from "./fiscal";

const pv = { cuit: CUIT_A, numero: 1 };
const pedido = (numero: bigint, cambios: Partial<SolicitudDeAutorizacion> = {}) =>
  solicitudDeAutorizacion(
    { puntoDeVenta: pv, tipo: "FACTURA_B", numero, solicitud: SOLICITUD_1 },
    cambios,
  );
const observacion = { codigo: 10237, texto: "el importe de la nota supera al de la factura" };

describe("EmisionFalsa", () => {
  it("autoriza por defecto y avanza el último número", async () => {
    const falsa = new EmisionFalsa();
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "AUTORIZADO",
      codigo: "00001000000001",
      vence: "2099-12-31",
      fecha: "2026-10-13",
      observaciones: [],
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 1n });
    expect(falsa.pedidos).toHaveLength(1);
  });

  it("arranca desde el último número inicial", async () => {
    const falsa = new EmisionFalsa({ ultimoInicial: 40n });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 40n });
    expect((await falsa.autorizar(pedido(41n))).tipo).toBe("AUTORIZADO");
  });

  it("exige la secuencia: un número que no es el siguiente se rechaza (10016) sin tocar nada", async () => {
    const falsa = new EmisionFalsa();
    for (const n of [0n, 2n, 5n]) {
      expect(await falsa.autorizar(pedido(n))).toEqual({
        tipo: "RECHAZADO",
        errores: [
          {
            codigo: CODIGO_FUERA_DE_SECUENCIA,
            texto: "numeración fuera de secuencia: se esperaba 1",
          },
        ],
        observaciones: [],
      });
    }
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
    expect(CODIGO_FUERA_DE_SECUENCIA).toBe(10016);
  });

  it("cada CUIT, punto de venta y tipo lleva su propia numeración", async () => {
    const falsa = new EmisionFalsa();
    await falsa.autorizar(pedido(1n));
    expect(await falsa.ultimoAutorizado({ cuit: CUIT_B, numero: 1 }, "FACTURA_B")).toEqual({
      ok: true,
      valor: 0n,
    });
    expect(await falsa.ultimoAutorizado({ cuit: CUIT_A, numero: 2 }, "FACTURA_B")).toEqual({
      ok: true,
      valor: 0n,
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_A")).toEqual({ ok: true, valor: 0n });
  });

  it("RECHAZA: rechaza sin avanzar, con el código genérico del falso", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("RECHAZA");
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "RECHAZADO",
      errores: [{ codigo: CODIGO_DE_RECHAZO_DEL_FALSO, texto: "rechazado (falso)" }],
      observaciones: [],
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
  });

  it("INCIERTO: no autoriza, y la consulta del número no lo encuentra", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("INCIERTO");
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "INCIERTO",
      motivo: "sin respuesta (falso)",
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
    expect(await falsa.consultar(pv, "FACTURA_B", 1n)).toEqual({ tipo: "NO_ENCONTRADO" });
  });

  it("AUTORIZA_Y_SE_CAE: autoriza pero responde incierto, y la consulta encuentra lo pedido", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("AUTORIZA_Y_SE_CAE");
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "INCIERTO",
      motivo: "autorizó y se cayó (falso)",
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 1n });
    const consulta = await falsa.consultar(pv, "FACTURA_B", 1n);
    expect(consulta.tipo).toBe("ENCONTRADO");
    if (consulta.tipo !== "ENCONTRADO") return;
    expect(consulta.codigo).toBe("00001000000001");
    expect(consulta.vence).toBe("2099-12-31");
  });

  it("NO_ENVIADO: ARCA no ve nada, no cambia nada y no mira la secuencia", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("NO_ENVIADO", "NO_ENVIADO");
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "NO_ENVIADO",
      motivo: "no salió (falso)",
    });
    // Fuera de secuencia, pero como nunca llega no se queja de la secuencia.
    expect((await falsa.autorizar(pedido(9n))).tipo).toBe("NO_ENVIADO");
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
    expect(await falsa.consultar(pv, "FACTURA_B", 1n)).toEqual({ tipo: "NO_ENCONTRADO" });
    expect(falsa.pedidos).toHaveLength(2);
    // Gastados los guiones, el mismo número sale bien: se reintenta con el mismo número.
    expect((await falsa.autorizar(pedido(1n))).tipo).toBe("AUTORIZADO");
  });

  it("NO_ENVIADO también puede salir de decidir", async () => {
    const falsa = new EmisionFalsa({ decidir: () => "NO_ENVIADO" });
    expect((await falsa.autorizar(pedido(1n))).tipo).toBe("NO_ENVIADO");
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
  });

  it("AUTORIZA_CON_OTROS_DATOS: otro sistema usó el número; quien pidió recibe incierto y la consulta lo ve distinto", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("AUTORIZA_CON_OTROS_DATOS");
    const nuestro = pedido(1n);
    expect(await falsa.autorizar(nuestro)).toEqual({
      tipo: "INCIERTO",
      motivo: "sin respuesta; otro sistema usó el número (falso)",
    });
    // El número quedó usado: ARCA avanzó.
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 1n });
    const consulta = await falsa.consultar(pv, "FACTURA_B", 1n);
    expect(consulta.tipo).toBe("ENCONTRADO");
    if (consulta.tipo !== "ENCONTRADO") return;
    expect(consulta.datos.total).toEqual(importeDesdeTexto(ARS, "121.01"));
    expect(consulta.datos.numero).toBe(1n);
    // Es el mismo número, el mismo tipo y el mismo punto de venta: lo único distinto es el importe.
    expect(consulta.datos.tipoDeComprobante).toBe(CODIGO_DE_TIPO_DE_COMPROBANTE.FACTURA_B);
    expect(consulta.datos.neto).toEqual(nuestro.importes.neto);
  });

  it("lo que consultar devuelve de lo autorizado coincide, campo por campo, con lo pedido (receptor, fechas, alícuotas y asociado)", async () => {
    const falsa = new EmisionFalsa();
    const asociado = {
      tipo: "FACTURA_B",
      puntoDeVenta: 3,
      numero: 77n,
      cuit: CUIT_B,
      fecha: fecha("2026-09-01"),
    } as const;
    const nota = solicitudDeAutorizacion(
      { puntoDeVenta: pv, tipo: "NOTA_CREDITO_B", numero: 1n, solicitud: SOLICITUD_1 },
      {
        fecha: fecha("2026-10-14"),
        receptor: {
          documento: { tipo: "CUIT", numero: CUIT_B },
          condicionIva: "RESPONSABLE_INSCRIPTO",
        },
        asociado,
      },
    );
    await falsa.autorizar(nota);
    const consulta = await falsa.consultar(pv, "NOTA_CREDITO_B", 1n);
    if (consulta.tipo !== "ENCONTRADO") throw new Error("se esperaba ENCONTRADO");
    expect(consulta.datos).toEqual({
      tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE.NOTA_CREDITO_B,
      puntoDeVenta: 1,
      numero: 1n,
      fecha: "2026-10-14",
      tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO.CUIT,
      numeroDeDocumento: BigInt(CUIT_B),
      moneda: "PES",
      total: nota.importes.total,
      neto: nota.importes.neto,
      iva: nota.importes.iva,
      alicuotas: nota.importes.alicuotas,
      asociado: {
        tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE.FACTURA_B,
        puntoDeVenta: 3,
        numero: 77n,
        cuit: CUIT_B,
        fecha: "2026-09-01",
      },
    });
    // Y sin asociado ni documento: consumidor final, 99 y 0.
    await falsa.autorizar(pedido(1n));
    const otra = await falsa.consultar(pv, "FACTURA_B", 1n);
    if (otra.tipo !== "ENCONTRADO") throw new Error("se esperaba ENCONTRADO");
    expect(otra.datos).toMatchObject({
      tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO.SIN_IDENTIFICAR,
      numeroDeDocumento: 0n,
      asociado: null,
    });
  });

  it("consultar un número que nadie autorizó es NO_ENCONTRADO, también el 0 y el que sigue al último", async () => {
    const falsa = new EmisionFalsa();
    await falsa.autorizar(pedido(1n));
    expect(await falsa.consultar(pv, "FACTURA_B", 2n)).toEqual({ tipo: "NO_ENCONTRADO" });
    expect(await falsa.consultar(pv, "FACTURA_B", 0n)).toEqual({ tipo: "NO_ENCONTRADO" });
    expect(await falsa.consultar(pv, "FACTURA_A", 1n)).toEqual({ tipo: "NO_ENCONTRADO" });
    expect(await falsa.consultar({ cuit: CUIT_B, numero: 1 }, "FACTURA_B", 1n)).toEqual({
      tipo: "NO_ENCONTRADO",
    });
    expect(falsa.consultas).toHaveLength(4);
  });

  it("un número que ARCA ya pasó (se fijó el último a mano) pero que el falso no autorizó lo emitió otro sistema: existe y no coincide", async () => {
    const falsa = new EmisionFalsa();
    falsa.fijarUltimo(pv, "FACTURA_B", 5n);
    const ajeno = await falsa.consultar(pv, "FACTURA_B", 3n);
    expect(ajeno.tipo).toBe("ENCONTRADO");
    if (ajeno.tipo !== "ENCONTRADO") return;
    const nuestro = facturaArmada(consumidorFinal, [renglon("1210.00", "1", "21")]);
    expect(
      coincideConLoRegistrado(
        { solicitud: SOLICITUD_1, numero: 3n, fecha: fecha("2026-10-13"), contenido: nuestro },
        ajeno.datos,
      ),
    ).toBe(false);
    expect(ajeno.datos).toMatchObject({ numero: 3n, puntoDeVenta: 1, fecha: "2000-01-01" });
    // Más allá del último, no existe.
    expect(await falsa.consultar(pv, "FACTURA_B", 6n)).toEqual({ tipo: "NO_ENCONTRADO" });
  });

  it("la consulta caída no puede decir nada: CONSULTA_FALLIDA, aunque el número exista", async () => {
    const falsa = new EmisionFalsa();
    await falsa.autorizar(pedido(1n));
    falsa.consultaCaida = true;
    expect(await falsa.consultar(pv, "FACTURA_B", 1n)).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "consulta caída (falso)",
    });
    // Es independiente del último autorizado.
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 1n });
    falsa.consultaCaida = false;
    expect((await falsa.consultar(pv, "FACTURA_B", 1n)).tipo).toBe("ENCONTRADO");
  });

  it("las observaciones programadas viajan en la autorización (por ejemplo la 10237 de una nota mayor que su factura)", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar({ guion: "AUTORIZA", observaciones: [observacion] });
    expect(await falsa.autorizar(pedido(1n))).toMatchObject({
      tipo: "AUTORIZADO",
      observaciones: [observacion],
    });
    // Solo vale para ese pedido.
    expect(await falsa.autorizar(pedido(2n))).toMatchObject({
      tipo: "AUTORIZADO",
      observaciones: [],
    });
  });

  it("un rechazo programado lleva los errores y las observaciones que se le dicen", async () => {
    const falsa = new EmisionFalsa();
    const error = { codigo: 10015, texto: "documento inválido" };
    falsa.programar({ guion: "RECHAZA", errores: [error], observaciones: [observacion] });
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "RECHAZADO",
      errores: [error],
      observaciones: [observacion],
    });
  });

  it("decidir también puede devolver un guion con detalle", async () => {
    const falsa = new EmisionFalsa({
      decidir: () => ({ guion: "AUTORIZA", observaciones: [observacion] }),
    });
    expect(await falsa.autorizar(pedido(1n))).toMatchObject({ observaciones: [observacion] });
  });

  it("los guiones programados se usan en orden y después manda decidir", async () => {
    const falsa = new EmisionFalsa({ decidir: () => "RECHAZA" });
    falsa.programar("AUTORIZA", "INCIERTO");
    expect((await falsa.autorizar(pedido(1n))).tipo).toBe("AUTORIZADO");
    expect((await falsa.autorizar(pedido(2n))).tipo).toBe("INCIERTO");
    expect((await falsa.autorizar(pedido(2n))).tipo).toBe("RECHAZADO");
  });

  it("un número fuera de secuencia no consume el guion programado", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("RECHAZA");
    await falsa.autorizar(pedido(9n));
    expect((await falsa.autorizar(pedido(1n))).tipo).toBe("RECHAZADO");
  });

  it("el servicio caído no responde el último número", async () => {
    const falsa = new EmisionFalsa();
    falsa.servicioCaido = true;
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" },
    });
  });

  it("se puede fijar el último número para simular un desfase", async () => {
    const falsa = new EmisionFalsa();
    falsa.fijarUltimo(pv, "FACTURA_B", 99n);
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 99n });
    expect((await falsa.autorizar(pedido(100n))).tipo).toBe("AUTORIZADO");
  });
});

describe("guionAlAzar", () => {
  const sortear = (semilla: number, pesos: Partial<Record<Guion, number>>, n: number) => {
    const decidir = guionAlAzar(semilla, pesos);
    return Array.from({ length: n }, () => decidir(pedido(1n)));
  };

  it("se repite con la misma semilla y cambia con otra", () => {
    const pesos = { AUTORIZA: 5, RECHAZA: 2, INCIERTO: 1, AUTORIZA_Y_SE_CAE: 1, NO_ENVIADO: 1 };
    expect(sortear(7, pesos, 50)).toEqual(sortear(7, pesos, 50));
    expect(sortear(7, pesos, 50)).not.toEqual(sortear(8, pesos, 50));
  });

  it("solo sale lo que tiene peso", () => {
    expect(new Set(sortear(1, { AUTORIZA: 1, RECHAZA: 1 }, 100))).toEqual(
      new Set(["AUTORIZA", "RECHAZA"]),
    );
    expect(new Set(sortear(1, { INCIERTO: 3 }, 20))).toEqual(new Set(["INCIERTO"]));
    expect(new Set(sortear(1, { RECHAZA: 0, AUTORIZA: 1 }, 20))).toEqual(new Set(["AUTORIZA"]));
    expect(new Set(sortear(1, { NO_ENVIADO: 1, AUTORIZA_CON_OTROS_DATOS: 1 }, 100))).toEqual(
      new Set(["NO_ENVIADO", "AUTORIZA_CON_OTROS_DATOS"]),
    );
  });

  it("respeta los pesos aproximadamente", () => {
    const salidas = sortear(3, { AUTORIZA: 9, RECHAZA: 1 }, 2000);
    const rechazos = salidas.filter((g) => g === "RECHAZA").length;
    expect(rechazos).toBeGreaterThan(100);
    expect(rechazos).toBeLessThan(320);
  });

  it("sin pesos es un error", () => {
    expect(() => guionAlAzar(1, {})).toThrow(RangeError);
    expect(() => guionAlAzar(1, { AUTORIZA: 0 })).toThrow(RangeError);
  });
});
