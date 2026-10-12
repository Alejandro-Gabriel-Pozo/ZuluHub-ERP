import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import "../../../../test/propiedades/configuracion";
import { decidirAsignaciones, type AsignacionActual, type SucursalDeLaEmpresa } from "./asignacion";

const id = sucursalId;
const A = id("s-a");
const B = id("s-b");
const C = id("s-c");
const D = id("s-d");

const asignada = (sucursal: SucursalId, activa = true): AsignacionActual => ({
  sucursalId: sucursal,
  activa,
});
const sucursal = (cual: SucursalId, activa = true): SucursalDeLaEmpresa => ({ id: cual, activa });

const TODAS = [sucursal(A), sucursal(B), sucursal(C), sucursal(D)];
const SIN_CAMBIOS = { agregadas: [], reactivadas: [], quitadas: [] };

describe("decidirAsignaciones", () => {
  it("sin nada asignado, agrega todas las pedidas", () => {
    expect(decidirAsignaciones([], [A, B], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [A, B], reactivadas: [], quitadas: [] },
    });
  });

  it("pedir el mismo conjunto no cambia nada (idempotente), en cualquier orden", () => {
    const actuales = [asignada(A), asignada(B)];
    expect(decidirAsignaciones(actuales, [A, B], TODAS)).toEqual({ ok: true, valor: SIN_CAMBIOS });
    expect(decidirAsignaciones(actuales, [B, A], TODAS)).toEqual({ ok: true, valor: SIN_CAMBIOS });
  });

  it("un conjunto vacío está permitido: quita todo lo activo", () => {
    expect(decidirAsignaciones([asignada(B), asignada(A)], [], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [], reactivadas: [], quitadas: [A, B] },
    });
    expect(decidirAsignaciones([], [], TODAS)).toEqual({ ok: true, valor: SIN_CAMBIOS });
  });

  it("reactiva las apagadas que se piden y no toca las apagadas que no se piden", () => {
    expect(decidirAsignaciones([asignada(A, false), asignada(B, false)], [A], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [], reactivadas: [A], quitadas: [] },
    });
  });

  it("quita las activas que sobran y conserva las que se piden", () => {
    expect(decidirAsignaciones([asignada(A), asignada(B)], [B, C], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [C], reactivadas: [], quitadas: [A] },
    });
  });

  it("combina agregar, reactivar y quitar en una sola decisión", () => {
    const actuales = [asignada(A), asignada(B, false), asignada(C)];
    expect(decidirAsignaciones(actuales, [B, D, C], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [D], reactivadas: [B], quitadas: [A] },
    });
  });

  it("ignora los repetidos del conjunto pedido", () => {
    expect(decidirAsignaciones([], [B, A, B, A], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [A, B], reactivadas: [], quitadas: [] },
    });
  });

  it("devuelve cada lista ordenada por id, sin importar el orden de entrada", () => {
    const actuales = [asignada(D, false), asignada(C), asignada(B), asignada(A, false)];
    expect(decidirAsignaciones(actuales, [D, A], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [], reactivadas: [A, D], quitadas: [B, C] },
    });
    expect(decidirAsignaciones([], [C, D, B], TODAS)).toEqual({
      ok: true,
      valor: { agregadas: [B, C, D], reactivadas: [], quitadas: [] },
    });
  });

  it("una sucursal que no es de la empresa es SUCURSAL_NO_ES_DE_LA_EMPRESA", () => {
    const ajena = id("s-ajena");
    expect(decidirAsignaciones([], [A, ajena], TODAS)).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ES_DE_LA_EMPRESA",
    });
    expect(decidirAsignaciones([], [ajena], [])).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ES_DE_LA_EMPRESA",
    });
  });

  it("no agrega ni reactiva una sucursal desactivada: SUCURSAL_INACTIVA", () => {
    const sucursales = [sucursal(A), sucursal(B, false)];
    const inactiva = { ok: false, error: "SUCURSAL_INACTIVA" };
    expect(decidirAsignaciones([], [A, B], sucursales)).toEqual(inactiva);
    expect(decidirAsignaciones([asignada(B, false)], [B], sucursales)).toEqual(inactiva);
  });

  it("conservar una asignación activa a una sucursal desactivada no es error (reenviar el mismo conjunto)", () => {
    const sucursales = [sucursal(A), sucursal(B, false)];
    expect(decidirAsignaciones([asignada(A), asignada(B)], [A, B], sucursales)).toEqual({
      ok: true,
      valor: SIN_CAMBIOS,
    });
  });

  it("quitar una asignación a una sucursal desactivada es posible", () => {
    const sucursales = [sucursal(A), sucursal(B, false)];
    expect(decidirAsignaciones([asignada(A), asignada(B)], [A], sucursales)).toEqual({
      ok: true,
      valor: { agregadas: [], reactivadas: [], quitadas: [B] },
    });
  });

  it("el error de sucursal ajena gana sobre el de sucursal inactiva, en cualquier orden", () => {
    const sucursales = [sucursal(A), sucursal(B, false)];
    const ajena = id("s-ajena");
    const esAjena = { ok: false, error: "SUCURSAL_NO_ES_DE_LA_EMPRESA" };
    expect(decidirAsignaciones([], [B, ajena], sucursales)).toEqual(esAjena);
    expect(decidirAsignaciones([], [ajena, B], sucursales)).toEqual(esAjena);
  });

  it("no cambia los datos que recibe", () => {
    const actuales = [asignada(B), asignada(A, false)];
    const pedidas = [D, B];
    decidirAsignaciones(actuales, pedidas, TODAS);
    expect(actuales).toEqual([asignada(B), asignada(A, false)]);
    expect(pedidas).toEqual([D, B]);
  });
});

describe("propiedades de decidirAsignaciones", () => {
  const ids = ["s-0", "s-1", "s-2", "s-3", "s-4", "s-5"].map(id);
  const unaSucursal = fc.constantFrom(...ids);
  /** Una fila por sucursal como mucho, activa o apagada. */
  const actuales = fc
    .uniqueArray(unaSucursal, { maxLength: 6 })
    .chain((lista) =>
      fc
        .array(fc.boolean(), { minLength: lista.length, maxLength: lista.length })
        .map((estados) => lista.map((s, n) => asignada(s, estados[n] === true))),
    );
  const sucursales = fc
    .array(fc.boolean(), { minLength: 6, maxLength: 6 })
    .map((estados) => ids.map((s, n) => sucursal(s, estados[n] === true)));
  const pedidas = fc.array(unaSucursal, { maxLength: 10 });

  const activasDe = (lista: readonly AsignacionActual[]) =>
    new Set(lista.filter((a) => a.activa).map((a) => a.sucursalId));

  it("el resultado de asignar es exactamente el conjunto pedido", () => {
    fc.assert(
      fc.property(actuales, pedidas, sucursales, (antes, quiero, todas) => {
        const r = decidirAsignaciones(antes, quiero, todas);
        if (!r.ok) return;
        const despues = activasDe(antes);
        for (const s of r.valor.agregadas) despues.add(s);
        for (const s of r.valor.reactivadas) despues.add(s);
        for (const s of r.valor.quitadas) despues.delete(s);
        expect([...despues].sort()).toEqual([...new Set(quiero)].sort());
      }),
    );
  });

  it("cada lista es ordenada, sin repetidos, y agregar, reactivar y quitar son conjuntos disjuntos", () => {
    fc.assert(
      fc.property(actuales, pedidas, sucursales, (antes, quiero, todas) => {
        const r = decidirAsignaciones(antes, quiero, todas);
        if (!r.ok) return;
        const { agregadas, reactivadas, quitadas } = r.valor;
        for (const lista of [agregadas, reactivadas, quitadas]) {
          expect([...lista]).toEqual([...new Set(lista)].sort());
        }
        expect(new Set([...agregadas, ...reactivadas, ...quitadas]).size).toBe(
          agregadas.length + reactivadas.length + quitadas.length,
        );
        // Solo se agrega lo que no tenía fila, se reactiva lo apagado y se quita lo activo.
        const filas = new Map(antes.map((a) => [a.sucursalId, a.activa]));
        for (const s of agregadas) expect(filas.has(s)).toBe(false);
        for (const s of reactivadas) expect(filas.get(s)).toBe(false);
        for (const s of quitadas) expect(filas.get(s)).toBe(true);
      }),
    );
  });

  it("repetir el mismo conjunto sobre el resultado no escribe nada (idempotente)", () => {
    fc.assert(
      fc.property(actuales, pedidas, sucursales, (antes, quiero, todas) => {
        const r = decidirAsignaciones(antes, quiero, todas);
        if (!r.ok) return;
        const filas = new Map(antes.map((a) => [a.sucursalId, a.activa]));
        for (const s of [...r.valor.agregadas, ...r.valor.reactivadas]) filas.set(s, true);
        for (const s of r.valor.quitadas) filas.set(s, false);
        const despues = [...filas].map(([sucursalId, activa]) => ({ sucursalId, activa }));
        expect(decidirAsignaciones(despues, quiero, todas)).toEqual({
          ok: true,
          valor: SIN_CAMBIOS,
        });
      }),
    );
  });

  it("el orden y los repetidos del pedido no cambian la decisión", () => {
    fc.assert(
      fc.property(actuales, pedidas, sucursales, (antes, quiero, todas) => {
        const otroOrden = [...quiero].reverse().concat(quiero);
        expect(decidirAsignaciones(antes, otroOrden, todas)).toEqual(
          decidirAsignaciones(antes, quiero, todas),
        );
      }),
    );
  });

  it("rechaza exactamente lo que no es de la empresa o habría que escribir en una sucursal desactivada", () => {
    fc.assert(
      fc.property(
        actuales,
        pedidas,
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.integer({ min: 0, max: 6 }),
        (antes, quiero, estados, sinFila) => {
          // `sinFila` saca una sucursal de la empresa para probar también las ajenas.
          const todas = ids
            .map((s, n) => sucursal(s, estados[n] === true))
            .filter((_, n) => n !== sinFila);
          const r = decidirAsignaciones(antes, quiero, todas);
          const deLaEmpresa = new Set(todas.map((s) => s.id));
          const filas = new Map(antes.map((a) => [a.sucursalId, a.activa]));
          const activas = new Set(todas.filter((s) => s.activa).map((s) => s.id));
          const ajena = quiero.some((s) => !deLaEmpresa.has(s));
          const inactiva = quiero.some(
            (s) => deLaEmpresa.has(s) && filas.get(s) !== true && !activas.has(s),
          );
          if (ajena) expect(r).toEqual({ ok: false, error: "SUCURSAL_NO_ES_DE_LA_EMPRESA" });
          else if (inactiva) expect(r).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
          else expect(r.ok).toBe(true);
        },
      ),
    );
  });
});
