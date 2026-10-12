import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  CLAVES_DE_MODULOS_DE_PRUEBA,
  CLAVES_DE_PERILLAS_DE_PRUEBA,
  MODULOS_DE_PRUEBA,
  PERILLAS_DE_PRUEBA,
} from "../../../../test/utilidades/planes";
import { estadoDeModulos } from "../../../capacidades/modulos/activos";
import type { DefinicionDePerilla } from "../../../capacidades/planes/perillas";
import { estaEncendida, type ValorDePerilla } from "../../../capacidades/planes/valores";
import { vigenteEn } from "../../../capacidades/planes/vigencia";
import { planId, versionDePlanId } from "../../../primitivas/identificadores/marca";
import { decidirActivacion, decidirDesactivacion } from "./activacion";
import { decidirAjuste } from "./ajuste";
import { decidirAsignacion, type AsignacionDePlan } from "./asignacion";

/** Propiedades de las decisiones del módulo de planes sobre entradas GENERADAS. */

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const HORA = 3_600_000;
const ahora = new Date(BASE);
const catalogo = PERILLAS_DE_PRUEBA as Readonly<Record<string, DefinicionDePerilla>>;

const modulos = fc.subarray(CLAVES_DE_MODULOS_DE_PRUEBA);

describe("activación y desactivación: propiedades", () => {
  it("activar y quedar activo es coherente con estadoDeModulos: el módulo pasa a operar", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLAVES_DE_MODULOS_DE_PRUEBA),
        modulos,
        modulos,
        (modulo, activados, habilitados) => {
          const r = decidirActivacion({
            catalogo: MODULOS_DE_PRUEBA,
            modulo,
            activados,
            habilitados,
          });
          if (!r.ok || r.valor.yaEstabaActivo) return;
          const despues = estadoDeModulos(MODULOS_DE_PRUEBA, [...activados, modulo], habilitados);
          expect(despues.modulosActivos.has(modulo as never)).toBe(true);
          // Y todo lo que requiere ya estaba operando antes de activarlo.
          const antes = estadoDeModulos(MODULOS_DE_PRUEBA, activados, habilitados);
          for (const requerido of MODULOS_DE_PRUEBA[modulo as keyof typeof MODULOS_DE_PRUEBA]
            .requiere) {
            expect(antes.modulosActivos.has(requerido as never)).toBe(true);
          }
        },
      ),
    );
  });

  it("activar nunca deja pasar un obligatorio, un módulo en desarrollo ni uno fuera del techo", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLAVES_DE_MODULOS_DE_PRUEBA),
        modulos,
        modulos,
        (modulo, activados, habilitados) => {
          const r = decidirActivacion({
            catalogo: MODULOS_DE_PRUEBA,
            modulo,
            activados,
            habilitados,
          });
          const definicion = MODULOS_DE_PRUEBA[modulo as keyof typeof MODULOS_DE_PRUEBA];
          if (!r.ok) return;
          expect(definicion.obligatorio).toBe(false);
          expect(definicion.estado).toBe("disponible");
          if (!r.valor.yaEstabaActivo) expect(habilitados.includes(modulo)).toBe(true);
        },
      ),
    );
  });

  it("repetir no es un error: activar dos veces el mismo módulo da ok, y la segunda no escribe", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLAVES_DE_MODULOS_DE_PRUEBA),
        modulos,
        modulos,
        (modulo, activados, habilitados) => {
          const primera = decidirActivacion({
            catalogo: MODULOS_DE_PRUEBA,
            modulo,
            activados,
            habilitados,
          });
          if (!primera.ok) return;
          const segunda = decidirActivacion({
            catalogo: MODULOS_DE_PRUEBA,
            modulo,
            activados: [...new Set([...activados, modulo])],
            habilitados,
          });
          expect(segunda).toEqual({ ok: true, valor: { yaEstabaActivo: true } });
        },
      ),
    );
  });

  it("desactivar con éxito nunca deja a un módulo activado sin su requisito", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLAVES_DE_MODULOS_DE_PRUEBA), modulos, (modulo, activados) => {
        const r = decidirDesactivacion({ catalogo: MODULOS_DE_PRUEBA, modulo, activados });
        if (!r.ok || r.valor.yaEstabaInactivo) return;
        const quedan = activados.filter((m) => m !== modulo);
        for (const otro of quedan) {
          expect(
            MODULOS_DE_PRUEBA[otro as keyof typeof MODULOS_DE_PRUEBA].requiere.includes(
              modulo as never,
            ),
          ).toBe(false);
        }
      }),
    );
  });

  it("tras activar con éxito, desactivar el mismo módulo solo falla si otro activado lo requiere", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLAVES_DE_MODULOS_DE_PRUEBA),
        modulos,
        modulos,
        (modulo, activados, habilitados) => {
          const a = decidirActivacion({
            catalogo: MODULOS_DE_PRUEBA,
            modulo,
            activados,
            habilitados,
          });
          if (!a.ok || a.valor.yaEstabaActivo) return;
          const d = decidirDesactivacion({
            catalogo: MODULOS_DE_PRUEBA,
            modulo,
            activados: [...activados, modulo],
          });
          const hayDependiente = activados.some((otro) =>
            MODULOS_DE_PRUEBA[otro as keyof typeof MODULOS_DE_PRUEBA].requiere.includes(modulo),
          );
          expect(d.ok).toBe(!hayDependiente);
          if (d.ok) expect(d.valor).toEqual({ yaEstabaInactivo: false });
        },
      ),
    );
  });
});

describe("asignación y ajuste: «la última decisión manda»", () => {
  const historial = fc
    .array(
      fc.record({
        horas: fc.integer({ min: -100, max: 100 }),
        version: fc.constantFrom("v1", "v2", "v3"),
      }),
      { maxLength: 6 },
    )
    .map((lista): AsignacionDePlan[] =>
      lista.map((a, i) => ({
        numero: i + 1,
        vigenteDesde: new Date(BASE + a.horas * HORA),
        versionDePlanId: versionDePlanId(a.version),
        planId: planId("plan"),
      })),
    );

  it("una asignación que empieza ya y se inserta pasa a regir (o ya regía: YA_ESTABA)", () => {
    fc.assert(
      fc.property(historial, fc.constantFrom("v1", "v2", "v3"), (h, version) => {
        const r = decidirAsignacion(h, {
          ahora,
          destino: {
            planId: planId("plan"),
            versionDePlanId: versionDePlanId(version),
            publicada: true,
            planRetirado: false,
          },
          vigenteDesde: ahora,
          motivo: "x",
          numeroEsperado: h.length === 0 ? null : h.length,
          reemplazaProgramada: true,
          origen: "CAMBIO",
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        if (r.valor.resultado === "YA_ESTABA") {
          expect(vigenteEn(h, ahora)?.versionDePlanId).toBe(version);
          return;
        }
        const con = [
          ...h,
          {
            numero: r.valor.numero,
            vigenteDesde: ahora,
            versionDePlanId: r.valor.versionDePlanId,
            planId: planId("plan"),
          },
        ];
        expect(vigenteEn(con, ahora)?.versionDePlanId).toBe(version);
      }),
    );
  });

  it("repetir la misma asignación ya hecha no es un error: la segunda vez es YA_ESTABA", () => {
    fc.assert(
      fc.property(historial, fc.constantFrom("v1", "v2", "v3"), (h, version) => {
        const destino = {
          planId: planId("plan"),
          versionDePlanId: versionDePlanId(version),
          publicada: true,
          planRetirado: false,
        };
        const pedido = (hist: readonly AsignacionDePlan[]) => ({
          ahora,
          destino,
          vigenteDesde: ahora,
          motivo: "x",
          numeroEsperado: hist.length === 0 ? null : hist.length,
          reemplazaProgramada: true,
          origen: "CAMBIO" as const,
        });
        const primera = decidirAsignacion(h, pedido(h));
        if (!primera.ok || primera.valor.resultado !== "ASIGNA") return;
        const con = [
          ...h,
          {
            numero: primera.valor.numero,
            vigenteDesde: ahora,
            versionDePlanId: primera.valor.versionDePlanId,
            planId: planId("plan"),
          },
        ];
        expect(decidirAsignacion(con, pedido(con))).toEqual({
          ok: true,
          valor: { resultado: "YA_ESTABA", numero: primera.valor.numero },
        });
      }),
    );
  });

  const perillaYValor = fc.constantFrom(...CLAVES_DE_PERILLAS_DE_PRUEBA).chain((perilla) => {
    const d = catalogo[perilla] as DefinicionDePerilla;
    const valor: fc.Arbitrary<ValorDePerilla> =
      d.tipo === "INTERRUPTOR"
        ? fc.boolean().map((encendida) => ({ tipo: "INTERRUPTOR", encendida }))
        : fc
            .oneof(fc.integer({ min: 0, max: 5 }), fc.constant("ILIMITADO" as const))
            .map((limite) => ({ tipo: "LIMITE", limite }));
    return valor.map((v) => ({ perilla, valor: v }));
  });

  it("un ajuste que enciende una perilla se acepta solo si su requerida está encendida", () => {
    fc.assert(
      fc.property(perillaYValor, fc.boolean(), ({ perilla, valor }, requeridaEncendida) => {
        const definicion = catalogo[perilla] as DefinicionDePerilla;
        const valoresActuales = new Map<string, ValorDePerilla>(
          definicion.requiere === undefined
            ? []
            : [[definicion.requiere, { tipo: "INTERRUPTOR", encendida: requeridaEncendida }]],
        );
        const r = decidirAjuste(catalogo, [], {
          ahora,
          perilla,
          empresaId: null,
          valor,
          vigenteDesde: ahora,
          motivo: "x",
          numeroEsperado: null,
          reemplazaProgramada: false,
          valoresActuales,
        });
        const debeRechazar =
          definicion.requiere !== undefined && estaEncendida(valor) && !requeridaEncendida;
        expect(r.ok).toBe(!debeRechazar);
        if (!r.ok) expect(r.error.codigo).toBe("PERILLA_REQUIERE_OTRA");
      }),
    );
  });
});
