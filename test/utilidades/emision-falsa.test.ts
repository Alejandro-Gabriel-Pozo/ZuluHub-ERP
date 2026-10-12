import { describe, expect, it } from "vitest";
import type { SolicitudDeAutorizacion } from "../../src/modulos/fiscal/casos-de-uso/emision-electronica";
import { EmisionFalsa, guionAlAzar, type Guion } from "./emision-falsa";
import { CUIT_A, CUIT_B, SOLICITUD_1 } from "./fiscal";

const pv = { cuit: CUIT_A, numero: 1 };
const pedido = (numero: bigint, cambios: Partial<SolicitudDeAutorizacion> = {}) => ({
  puntoDeVenta: pv,
  tipo: "FACTURA_B" as const,
  numero,
  solicitud: SOLICITUD_1,
  ...cambios,
});

describe("EmisionFalsa", () => {
  it("autoriza por defecto y avanza el último número", async () => {
    const falsa = new EmisionFalsa();
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "AUTORIZADO",
      codigo: `CAE-${CUIT_A}-1-1`,
      vence: "2099-12-31",
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 1n });
    expect(falsa.pedidos).toHaveLength(1);
  });

  it("arranca desde el último número inicial", async () => {
    const falsa = new EmisionFalsa({ ultimoInicial: 40n });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 40n });
    expect((await falsa.autorizar(pedido(41n))).tipo).toBe("AUTORIZADO");
  });

  it("exige la secuencia: un número que no es el siguiente se rechaza sin tocar nada", async () => {
    const falsa = new EmisionFalsa();
    for (const n of [0n, 2n, 5n]) {
      expect(await falsa.autorizar(pedido(n))).toEqual({
        tipo: "RECHAZADO",
        observaciones: ["numeración fuera de secuencia: se esperaba 1"],
      });
    }
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
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

  it("RECHAZA: rechaza sin avanzar", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("RECHAZA");
    expect(await falsa.autorizar(pedido(1n))).toEqual({
      tipo: "RECHAZADO",
      observaciones: ["rechazado (falso)"],
    });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
  });

  it("INCIERTO: no autoriza", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("INCIERTO");
    expect(await falsa.autorizar(pedido(1n))).toEqual({ tipo: "INCIERTO" });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 0n });
  });

  it("AUTORIZA_Y_SE_CAE: autoriza pero responde incierto", async () => {
    const falsa = new EmisionFalsa();
    falsa.programar("AUTORIZA_Y_SE_CAE");
    expect(await falsa.autorizar(pedido(1n))).toEqual({ tipo: "INCIERTO" });
    expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({ ok: true, valor: 1n });
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
    const pesos = { AUTORIZA: 5, RECHAZA: 2, INCIERTO: 1, AUTORIZA_Y_SE_CAE: 1 };
    expect(sortear(7, pesos, 50)).toEqual(sortear(7, pesos, 50));
    expect(sortear(7, pesos, 50)).not.toEqual(sortear(8, pesos, 50));
  });

  it("solo sale lo que tiene peso", () => {
    expect(new Set(sortear(1, { AUTORIZA: 1, RECHAZA: 1 }, 100))).toEqual(
      new Set(["AUTORIZA", "RECHAZA"]),
    );
    expect(new Set(sortear(1, { INCIERTO: 3 }, 20))).toEqual(new Set(["INCIERTO"]));
    expect(new Set(sortear(1, { RECHAZA: 0, AUTORIZA: 1 }, 20))).toEqual(new Set(["AUTORIZA"]));
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
