import { describe, expect, it } from "vitest";
import { armarLasExistencias } from "../../apps/web/ui/plantillas/stock/existencias/modelo-de-existencias";
import {
  hrefDeLectura,
  leerLaLectura,
} from "../../apps/web/ui/plantillas/stock/lectura/modelo-de-lectura";
import {
  armarLosMovimientos,
  CLAVE_DE_TEXTO_DE_LA_CLASE,
  CLAVE_DE_TEXTO_DEL_MOTIVO,
} from "../../apps/web/ui/plantillas/stock/movimientos/modelo-de-movimientos";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * Los modelos de vista de «Existencias» y «Movimientos» (STK-B1): qué se ve en cada tarjeta, cómo se escribe la cantidad (texto decimal exacto, nunca `number`, con signo en el libro), la hora de Argentina,
 * que solo se rotulan las clases y los motivos aprobados, y cómo viajan el depósito y el cursor en la dirección. Puros: sin React ni servidor.
 */
const D = [
  { id: "d1", nombre: "Salón" },
  { id: "d2", nombre: "Cocina" },
];
const mov = (c: Record<string, unknown> = {}) => ({
  movimientoId: "m1",
  numero: 1,
  clase: "ENTRADA",
  motivo: "COMPRA",
  hechoEn: "2026-11-25T15:30:00.000Z",
  quien: "ana@ejemplo.com",
  nombre: "Harina",
  unidadId: "KILOGRAMO",
  cantidad: "5.5000",
  anulado: false,
  ...c,
});
const armar = (movimientos: readonly ReturnType<typeof mov>[], siguiente: string | null = null) =>
  armarLosMovimientos({ depositos: D, depositoId: "d2", movimientos, siguiente }, (clave) =>
    texto({}, clave),
  );

describe("la dirección de las pantallas de lectura", () => {
  it("lleva el depósito y el cursor opaco, y sin ellos es la dirección sola", () => {
    expect(hrefDeLectura("existencias", null)).toBe("/stock/existencias");
    expect(hrefDeLectura("movimientos", "d1")).toBe("/stock/movimientos?deposito=d1");
    expect(hrefDeLectura("movimientos", "d1", "ab_-9")).toBe(
      "/stock/movimientos?deposito=d1&despues=ab_-9",
    );
  });

  it("de la dirección solo se toman el depósito y el cursor, como texto; lo repetido o vacío se descarta", () => {
    expect(leerLaLectura({ deposito: "d1", despues: "x", otro: "y" })).toEqual({
      depositoId: "d1",
      despues: "x",
    });
    expect(leerLaLectura({ deposito: ["a", "b"], despues: "" })).toEqual({});
    expect(leerLaLectura({})).toEqual({});
  });
});

describe("armarLasExistencias", () => {
  it("una fila por artículo con la existencia como texto exacto y su unidad; el depósito elegido, marcado", () => {
    const vista = armarLasExistencias({
      depositos: D,
      depositoId: "d2",
      existencias: [
        {
          articuloId: "a1",
          nombre: "Harina",
          unidadId: "KILOGRAMO",
          existencia: "12.5000",
          negativa: false,
        },
        {
          articuloId: "a2",
          nombre: "Sal",
          unidadId: "KILOGRAMO",
          existencia: "-2.0000",
          negativa: true,
        },
      ],
      siguiente: "cur",
    });
    expect(vista.filas.map((f) => [f.titulo, f.cantidad, f.negativa])).toEqual([
      ["Harina", "12,5 Kilogramo", false],
      ["Sal", "-2 Kilogramo", true],
    ]);
    expect(vista.opciones.map((o) => [o.nombre, o.actual, o.href])).toEqual([
      ["Salón", false, "/stock/existencias?deposito=d1"],
      ["Cocina", true, "/stock/existencias?deposito=d2"],
    ]);
    expect(vista.hrefDeSiguiente).toBe("/stock/existencias?deposito=d2&despues=cur");
  });

  it("sin depósitos no hay selector ni filas ni página siguiente", () => {
    const vista = armarLasExistencias({
      depositos: [],
      depositoId: null,
      existencias: [],
      siguiente: null,
    });
    expect(vista).toEqual({ opciones: [], filas: [], hrefDeSiguiente: null });
  });
});

describe("armarLosMovimientos", () => {
  it("la tarjeta lleva la clase, la cantidad con signo y unidad, el detalle y la hora de Argentina (UTC-3)", () => {
    const [entrada, salida] = armar([
      mov(),
      mov({ movimientoId: "m2", clase: "SALIDA", motivo: "MERMA", cantidad: "-1.2500" }),
    ]).tarjetas;
    expect(entrada).toMatchObject({
      clase: "Entrada",
      cantidad: "+5,5 Kilogramo",
      detalle: "Harina · Compra · ana@ejemplo.com",
      anulado: false,
    });
    expect(entrada?.cuando).toContain("12:30");
    expect(salida).toMatchObject({ clase: "Salida", cantidad: "-1,25 Kilogramo" });
  });

  it("«Anulado» sale del dato; sin motivo aprobado y sin correo, el detalle no deja separadores", () => {
    const [t] = armar([
      mov({ clase: "ANULACION", motivo: "ANULACION", quien: null, anulado: true }),
    ]).tarjetas;
    expect(t).toMatchObject({ clase: "Anulación", anulado: true, detalle: "Harina" });
  });

  it("una clase que no conoce no se rotula (lista de permitidos)", () => {
    expect(armar([mov({ clase: "INVENTADA" })]).tarjetas[0]?.clase).toBeNull();
  });

  it("el ajuste por conteo se rotula «Ajuste»", () => {
    expect(armar([mov({ clase: "AJUSTE_POR_CONTEO", motivo: "CONTEO" })]).tarjetas[0]?.clase).toBe(
      "Ajuste",
    );
  });

  it("la página siguiente conserva el depósito y el cursor; la clave de la tarjeta distingue los renglones de un movimiento", () => {
    const vista = armar([mov(), mov({ numero: 2 })], "cur");
    expect(vista.hrefDeSiguiente).toBe("/stock/movimientos?deposito=d2&despues=cur");
    expect(new Set(vista.tarjetas.map((t) => t.id)).size).toBe(2);
  });
});

describe("las claves de texto de las clases y los motivos", () => {
  it("todas existen en el catálogo", () => {
    for (const clave of [
      ...Object.values(CLAVE_DE_TEXTO_DE_LA_CLASE),
      ...Object.values(CLAVE_DE_TEXTO_DEL_MOTIVO),
    ]) {
      expect(Object.keys(CATALOGO_DE_TEXTOS), clave).toContain(clave);
    }
  });
});
