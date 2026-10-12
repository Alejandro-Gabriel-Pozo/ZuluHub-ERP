import { describe, expect, it } from "vitest";
import { planId, versionDePlanId } from "../../../primitivas/identificadores/marca";
import {
  decidirAsignacion,
  type AsignacionDePlan,
  type PedidoDeAsignacion,
  type VersionDeDestino,
} from "./asignacion";

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const DIA = 86_400_000;
const en = (ms: number) => new Date(BASE + ms);
const ahora = en(0);

const P1 = planId("plan-1");
const P2 = planId("plan-2");
const V1 = versionDePlanId("v1");
const V2 = versionDePlanId("v2");
const V3 = versionDePlanId("v3");

const asignacion = (
  numero: number,
  desdeMs: number,
  version = V1,
  plan = P1,
): AsignacionDePlan => ({
  numero,
  vigenteDesde: en(desdeMs),
  versionDePlanId: version,
  planId: plan,
});

const destino = (extra: Partial<VersionDeDestino> = {}): VersionDeDestino => ({
  planId: P1,
  versionDePlanId: V2,
  publicada: true,
  planRetirado: false,
  ...extra,
});

const pedido = (extra: Partial<PedidoDeAsignacion> = {}): PedidoDeAsignacion => ({
  ahora,
  destino: destino(),
  vigenteDesde: ahora,
  motivo: "Cambio acordado",
  numeroEsperado: null,
  reemplazaProgramada: false,
  origen: "CAMBIO",
  ...extra,
});

describe("decidirAsignacion: lo que se inserta", () => {
  it("la primera asignación de un tenant (el alta) lleva el número 1 y su origen", () => {
    expect(
      decidirAsignacion([], pedido({ origen: "ALTA", motivo: "  Alta de la empresa " })),
    ).toEqual({
      ok: true,
      valor: {
        resultado: "ASIGNA",
        numero: 1,
        versionDePlanId: V2,
        origen: "ALTA",
        motivo: "Alta de la empresa",
        reemplazadas: [],
      },
    });
  });

  it("un cambio de versión lleva el último + 1 y rige desde que empieza", () => {
    const r = decidirAsignacion([asignacion(1, -DIA)], pedido({ numeroEsperado: 1 }));
    expect(r).toEqual({
      ok: true,
      valor: {
        resultado: "ASIGNA",
        numero: 2,
        versionDePlanId: V2,
        origen: "CAMBIO",
        motivo: "Cambio acordado",
        reemplazadas: [],
      },
    });
  });

  it("el origen de la migración por lote se conserva", () => {
    const r = decidirAsignacion(
      [asignacion(1, -DIA)],
      pedido({ numeroEsperado: 1, origen: "MIGRACION_DE_VERSION" }),
    );
    expect(r.ok && r.valor.resultado === "ASIGNA" && r.valor.origen).toBe("MIGRACION_DE_VERSION");
  });

  it("una baja de plan se acepta: no mira módulos ni uso (F3 y D-M3: nada se rechaza)", () => {
    // El dominio no recibe módulos activados ni uso: bajar siempre es posible.
    const r = decidirAsignacion(
      [asignacion(1, -DIA, V3, P2)],
      pedido({ numeroEsperado: 1, destino: destino({ planId: P1, versionDePlanId: V1 }) }),
    );
    expect(r.ok).toBe(true);
  });

  it("una asignación programada reemplaza a la programada anterior si se pide", () => {
    const h = [asignacion(1, -DIA), asignacion(2, 2 * DIA, V3)];
    const r = decidirAsignacion(
      h,
      pedido({ numeroEsperado: 2, reemplazaProgramada: true, vigenteDesde: en(DIA) }),
    );
    expect(r).toMatchObject({
      ok: true,
      valor: { resultado: "ASIGNA", numero: 3, reemplazadas: [2] },
    });
  });
});

describe("decidirAsignacion: los errores, en su orden", () => {
  it("motivo obligatorio (vacío o en blanco)", () => {
    for (const motivo of ["", "   "]) {
      expect(decidirAsignacion([], pedido({ motivo }))).toEqual({
        ok: false,
        error: { codigo: "MOTIVO_OBLIGATORIO" },
      });
    }
  });

  it("versión no publicada", () => {
    expect(decidirAsignacion([], pedido({ destino: destino({ publicada: false }) }))).toEqual({
      ok: false,
      error: { codigo: "VERSION_DE_PLAN_NO_PUBLICADA" },
    });
  });

  it("plan retirado: se rechaza para un tenant sin plan o con un plan distinto", () => {
    const retirado = destino({ planRetirado: true });
    expect(decidirAsignacion([], pedido({ destino: retirado }))).toEqual({
      ok: false,
      error: { codigo: "PLAN_RETIRADO" },
    });
    expect(
      decidirAsignacion(
        [asignacion(1, -DIA, V3, P2)],
        pedido({ numeroEsperado: 1, destino: retirado }),
      ),
    ).toEqual({ ok: false, error: { codigo: "PLAN_RETIRADO" } });
  });

  it("plan retirado: se permite moverse a otra versión del MISMO plan que ya rige", () => {
    const r = decidirAsignacion(
      [asignacion(1, -DIA, V1, P1)],
      pedido({ numeroEsperado: 1, destino: destino({ planRetirado: true }) }),
    );
    expect(r.ok).toBe(true);
  });

  it("plan retirado: «el que rige» es el vigente, no una programada", () => {
    const h = [asignacion(1, -DIA, V3, P2), asignacion(2, DIA, V1, P1)];
    const r = decidirAsignacion(
      h,
      pedido({
        numeroEsperado: 2,
        reemplazaProgramada: true,
        destino: destino({ planRetirado: true }),
      }),
    );
    expect(r).toEqual({ ok: false, error: { codigo: "PLAN_RETIRADO" } });
  });

  it("los errores de vigencia de decidirCambio: retroactiva, desactualizada, programada pendiente", () => {
    expect(decidirAsignacion([], pedido({ vigenteDesde: en(-DIA) }))).toEqual({
      ok: false,
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
    expect(decidirAsignacion([asignacion(1, -DIA)], pedido({ numeroEsperado: null }))).toEqual({
      ok: false,
      error: { codigo: "VERSION_DESACTUALIZADA" },
    });
    expect(
      decidirAsignacion(
        [asignacion(1, -DIA), asignacion(2, DIA, V3)],
        pedido({ numeroEsperado: 2 }),
      ),
    ).toEqual({ ok: false, error: { codigo: "CAMBIO_PROGRAMADO_PENDIENTE" } });
  });

  it("orden: motivo, versión no publicada, plan retirado, vigencia", () => {
    const todoMal = pedido({
      motivo: "",
      destino: destino({ publicada: false, planRetirado: true }),
      vigenteDesde: en(-DIA),
    });
    expect(decidirAsignacion([], todoMal)).toMatchObject({
      error: { codigo: "MOTIVO_OBLIGATORIO" },
    });
    expect(decidirAsignacion([], { ...todoMal, motivo: "x" })).toMatchObject({
      error: { codigo: "VERSION_DE_PLAN_NO_PUBLICADA" },
    });
    expect(
      decidirAsignacion([], { ...todoMal, motivo: "x", destino: destino({ planRetirado: true }) }),
    ).toMatchObject({ error: { codigo: "PLAN_RETIRADO" } });
    expect(decidirAsignacion([], { ...todoMal, motivo: "x", destino: destino() })).toMatchObject({
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
  });
});

describe("decidirAsignacion: repetir no es un error (YA_ESTABA)", () => {
  it("la versión pedida ya rige y no hay nada programado: no se inserta nada", () => {
    const r = decidirAsignacion(
      [asignacion(1, -2 * DIA, V1), asignacion(2, -DIA, V2)],
      pedido({ numeroEsperado: 2, destino: destino({ versionDePlanId: V2 }) }),
    );
    expect(r).toEqual({ ok: true, valor: { resultado: "YA_ESTABA", numero: 2 } });
  });

  it("vale también para el lote de la migración", () => {
    const r = decidirAsignacion(
      [asignacion(1, -DIA, V2)],
      pedido({ numeroEsperado: 1, origen: "MIGRACION_DE_VERSION" }),
    );
    expect(r).toEqual({ ok: true, valor: { resultado: "YA_ESTABA", numero: 1 } });
  });

  it("si hay una programada, volver a pedir la vigente la cancela: es una asignación nueva", () => {
    const h = [asignacion(1, -DIA, V2), asignacion(2, DIA, V3)];
    const r = decidirAsignacion(h, pedido({ numeroEsperado: 2, reemplazaProgramada: true }));
    expect(r).toMatchObject({
      ok: true,
      valor: { resultado: "ASIGNA", numero: 3, reemplazadas: [2] },
    });
  });

  it("si lo que rige es una versión distinta, se inserta aunque otra pasada haya tenido la pedida", () => {
    const h = [asignacion(1, -2 * DIA, V2), asignacion(2, -DIA, V3)];
    const r = decidirAsignacion(h, pedido({ numeroEsperado: 2 }));
    expect(r).toMatchObject({ ok: true, valor: { resultado: "ASIGNA", numero: 3 } });
  });

  it("antes de decir que ya estaba, se comprueba el número esperado y la vigencia", () => {
    const h = [asignacion(1, -DIA, V2)];
    expect(decidirAsignacion(h, pedido({ numeroEsperado: 5 }))).toEqual({
      ok: false,
      error: { codigo: "VERSION_DESACTUALIZADA" },
    });
    expect(decidirAsignacion(h, pedido({ numeroEsperado: 1, vigenteDesde: en(-DIA) }))).toEqual({
      ok: false,
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
  });

  it("una versión que solo está programada todavía no «ya estaba»", () => {
    const h = [asignacion(1, -DIA, V1), asignacion(2, DIA, V2)];
    const r = decidirAsignacion(
      h,
      pedido({
        numeroEsperado: 2,
        reemplazaProgramada: true,
        destino: destino({ versionDePlanId: V2 }),
      }),
    );
    expect(r).toMatchObject({ ok: true, valor: { resultado: "ASIGNA", numero: 3 } });
  });
});

describe("decidirAsignacion: no modifica sus entradas", () => {
  it("el historial y el pedido quedan intactos", () => {
    const h = [asignacion(2, DIA, V3), asignacion(1, -DIA)];
    const p = pedido({ numeroEsperado: 2, reemplazaProgramada: true });
    const copia = structuredClone({ h, p });
    decidirAsignacion(h, p);
    expect({ h, p }).toEqual(copia);
  });
});
