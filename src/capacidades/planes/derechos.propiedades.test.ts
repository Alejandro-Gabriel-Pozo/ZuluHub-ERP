import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  CLAVES_DE_MODULOS_DE_PRUEBA,
  CLAVES_DE_PERILLAS_DE_PRUEBA,
  MODULOS_DE_PRUEBA,
  PERILLAS_DE_PRUEBA,
} from "../../../test/utilidades/planes";
import {
  empresaId,
  planId,
  tenantId,
  versionDePlanId,
} from "../../primitivas/identificadores/marca";
import { estadoDeModulos } from "../modulos/activos";
import {
  derechosDeUso,
  exigirPerilla,
  valorDePerilla,
  type AjusteDePerilla,
  type VersionDePlanVigente,
} from "./derechos";
import type { DefinicionDePerilla } from "./perillas";
import { esValorDeLaPerilla, estaEncendida, valorBaseDe, type ValorDePerilla } from "./valores";

/**
 * Propiedades de `derechosDeUso` y `exigirPerilla` (§D «Derechos (puro)»), con el oráculo escrito
 * aparte: no llama a las piezas que prueba, recalcula con bucles y comparaciones simples.
 */

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const HORA = 3_600_000;
const ahora = new Date(BASE);
const T = tenantId("tenant-1");
const E1 = empresaId("empresa-1");
const E2 = empresaId("empresa-2");
const catalogo = PERILLAS_DE_PRUEBA as Readonly<Record<string, DefinicionDePerilla>>;

const valorDe = (definicion: DefinicionDePerilla): fc.Arbitrary<ValorDePerilla> =>
  definicion.tipo === "INTERRUPTOR"
    ? fc.boolean().map((encendida) => ({ tipo: "INTERRUPTOR", encendida }))
    : fc
        .oneof(fc.integer({ min: 0, max: 6 }), fc.constant("ILIMITADO" as const))
        .map((limite) => ({ tipo: "LIMITE", limite }));

const perillasDelPlan = fc.record(
  Object.fromEntries(
    CLAVES_DE_PERILLAS_DE_PRUEBA.map((k) => [k, valorDe(catalogo[k] as DefinicionDePerilla)]),
  ),
  { requiredKeys: [] },
) as fc.Arbitrary<Record<string, ValorDePerilla>>;

const planes = fc.option(
  fc.record({
    modulos: fc.subarray(CLAVES_DE_MODULOS_DE_PRUEBA),
    perillas: perillasDelPlan,
  }),
  { nil: null },
);

const comoVersion = (
  p: { modulos: string[]; perillas: Record<string, ValorDePerilla> } | null,
): VersionDePlanVigente | null =>
  p === null
    ? null
    : {
        planId: planId("p"),
        versionDePlanId: versionDePlanId("v"),
        numero: 1,
        modulos: p.modulos,
        perillas: p.perillas,
      };

const ajusteAleatorio = fc
  .record({
    perilla: fc.constantFrom(...CLAVES_DE_PERILLAS_DE_PRUEBA),
    empresa: fc.constantFrom(null, E1, E2),
    horas: fc.integer({ min: -48, max: 48 }),
    delPlan: fc.boolean(),
    semilla: fc.nat(),
  })
  .chain((a) =>
    valorDe(catalogo[a.perilla] as DefinicionDePerilla).map((valor) => ({ ...a, valor })),
  );

/** Los ajustes con números consecutivos por (perilla, alcance), como los asigna la base. */
const ajustes = fc.array(ajusteAleatorio, { maxLength: 14 }).map((lista): AjusteDePerilla[] => {
  const contadores = new Map<string, number>();
  return lista.map((a) => {
    const serie = `${a.perilla}|${a.empresa}`;
    const numero = (contadores.get(serie) ?? 0) + 1;
    contadores.set(serie, numero);
    return {
      perilla: a.perilla,
      empresaId: a.empresa,
      numero,
      vigenteDesde: new Date(BASE + a.horas * HORA),
      valor: a.delPlan ? "DEL_PLAN" : a.valor,
    };
  });
});

const escenario = fc.record({
  plan: planes,
  ajustes,
  empresa: fc.constantFrom(null, E1, E2),
});

const calcular = (e: {
  plan: Parameters<typeof comoVersion>[0];
  ajustes: readonly AjusteDePerilla[];
  empresa: typeof E1 | null;
}) =>
  derechosDeUso({
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
    tenantId: T,
    empresaId: e.empresa,
    versionDePlan: comoVersion(e.plan),
    ajustes: e.ajustes,
    ahora,
  });

/** El valor "crudo" según el oráculo: ajuste que rige (empresa, si no tenant), plan o base. */
function crudoSegunOraculo(
  perilla: string,
  e: {
    plan: Parameters<typeof comoVersion>[0];
    ajustes: readonly AjusteDePerilla[];
    empresa: typeof E1 | null;
  },
): { valor: ValorDePerilla; origen: "BASE" | "PLAN" | "AJUSTE" } {
  const definicion = catalogo[perilla] as DefinicionDePerilla;
  const delPlan = e.plan?.perillas[perilla];
  const dePlan =
    delPlan === undefined
      ? { valor: valorBaseDe(definicion), origen: "BASE" as const }
      : { valor: delPlan, origen: "PLAN" as const };
  const serieVigente = (alcance: typeof E1 | null) => {
    const empezadas = e.ajustes.filter(
      (a) => a.perilla === perilla && a.empresaId === alcance && a.vigenteDesde.getTime() <= BASE,
    );
    let mejor: AjusteDePerilla | undefined;
    for (const a of empezadas) if (mejor === undefined || a.numero > mejor.numero) mejor = a;
    return mejor;
  };
  const deEmpresa =
    e.empresa !== null && definicion.ambito !== "TENANT" ? serieVigente(e.empresa) : undefined;
  const rige = deEmpresa ?? serieVigente(null);
  if (rige === undefined || rige.valor === "DEL_PLAN") return dePlan;
  return { valor: rige.valor, origen: "AJUSTE" };
}

/** ¿Rige la cadena de `requiere` de esta perilla (todas encendidas hasta el final)? */
function cadenaEncendida(perilla: string, e: Parameters<typeof crudoSegunOraculo>[1]): boolean {
  let actual: string | undefined = perilla;
  for (let paso = 0; actual !== undefined && paso < 20; paso++) {
    if (!estaEncendida(crudoSegunOraculo(actual, e).valor)) return false;
    actual = (catalogo[actual] as DefinicionDePerilla).requiere;
  }
  return true;
}

describe("derechosDeUso: propiedades", () => {
  it("es total y cada valor es del tipo de su perilla", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const d = calcular(e);
        expect([...d.perillas.keys()]).toEqual(CLAVES_DE_PERILLAS_DE_PRUEBA);
        for (const [perilla, valor] of d.perillas) {
          expect(esValorDeLaPerilla(catalogo[perilla] as DefinicionDePerilla, valor)).toBe(true);
        }
      }),
    );
  });

  it("coincide con el oráculo: ajuste más específico → plan → base, apagado si su cadena de requiere corta", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const d = calcular(e);
        for (const perilla of CLAVES_DE_PERILLAS_DE_PRUEBA) {
          const crudo = crudoSegunOraculo(perilla, e);
          const obtenido = valorDePerilla(d, perilla);
          expect(obtenido.origen).toBe(crudo.origen);
          if (cadenaEncendida(perilla, e)) {
            expect(obtenido).toEqual({ ...crudo.valor, origen: crudo.origen });
          } else {
            expect(estaEncendida(obtenido)).toBe(false);
          }
        }
      }),
    );
  });

  it("si una perilla está encendida, la que requiere también lo está", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const d = calcular(e);
        for (const [perilla, valor] of d.perillas) {
          const requiere = (catalogo[perilla] as DefinicionDePerilla).requiere;
          if (requiere !== undefined && estaEncendida(valor)) {
            expect(estaEncendida(valorDePerilla(d, requiere))).toBe(true);
          }
        }
      }),
    );
  });

  it("sin ajustes, el valor es el del plan o la base: nunca supera lo que el plan fija", () => {
    fc.assert(
      fc.property(planes, fc.constantFrom(null, E1), (plan, empresa) => {
        const d = calcular({ plan, ajustes: [], empresa });
        for (const [perilla, valor] of d.perillas) {
          expect(valor.origen).toBe(plan?.perillas[perilla] === undefined ? "BASE" : "PLAN");
          const fijado =
            plan?.perillas[perilla] ?? valorBaseDe(catalogo[perilla] as DefinicionDePerilla);
          if (valor.tipo === "LIMITE" && fijado.tipo === "LIMITE") {
            const tope = fijado.limite === "ILIMITADO" ? Infinity : fijado.limite;
            const efectivo = valor.limite === "ILIMITADO" ? Infinity : valor.limite;
            expect(efectivo).toBeLessThanOrEqual(tope);
          }
          if (valor.tipo === "INTERRUPTOR" && fijado.tipo === "INTERRUPTOR") {
            expect(Number(valor.encendida)).toBeLessThanOrEqual(Number(fijado.encendida));
          }
        }
      }),
    );
  });

  it("el orden de los ajustes no cambia el resultado", () => {
    fc.assert(
      fc.property(
        escenario.chain((e) =>
          fc
            .shuffledSubarray(e.ajustes, {
              minLength: e.ajustes.length,
              maxLength: e.ajustes.length,
            })
            .map((mezclados) => ({ e, mezclados })),
        ),
        ({ e, mezclados }) => {
          expect(calcular({ ...e, ajustes: mezclados })).toEqual(calcular(e));
        },
      ),
    );
  });

  it("un ajuste vigente sobrevive al cambio de plan: su perilla vale lo mismo con cualquier plan", () => {
    fc.assert(
      fc.property(escenario, planes, (e, otroPlan) => {
        const a = calcular(e);
        const b = calcular({ ...e, plan: otroPlan });
        for (const perilla of CLAVES_DE_PERILLAS_DE_PRUEBA) {
          const crudo = crudoSegunOraculo(perilla, e);
          const otro = crudoSegunOraculo(perilla, { ...e, plan: otroPlan });
          if (crudo.origen !== "AJUSTE" || otro.origen !== "AJUSTE") continue;
          // Con el mismo ajuste ganando, el valor crudo es el mismo; solo cambia por la cadena `requiere`.
          expect(crudo.valor).toEqual(otro.valor);
          if (cadenaEncendida(perilla, e) && cadenaEncendida(perilla, { ...e, plan: otroPlan })) {
            expect(valorDePerilla(a, perilla)).toEqual(valorDePerilla(b, perilla));
          }
        }
      }),
    );
  });

  it("los módulos: los obligatorios siempre, y el resto solo si el plan los incluye", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const d = calcular(e);
        for (const [clave, definicion] of Object.entries(MODULOS_DE_PRUEBA)) {
          const esperado = definicion.obligatorio || (e.plan?.modulos.includes(clave) ?? false);
          expect(d.modulosHabilitados.has(clave as never)).toBe(esperado);
        }
      }),
    );
  });

  it("activos ⊆ obligatorios ∪ habilitados, para cualquier conjunto de activados", () => {
    fc.assert(
      fc.property(escenario, fc.subarray(CLAVES_DE_MODULOS_DE_PRUEBA), (e, activados) => {
        const d = calcular(e);
        const estado = estadoDeModulos(MODULOS_DE_PRUEBA, activados, [...d.modulosHabilitados]);
        for (const activo of estado.modulosActivos) {
          expect(d.modulosHabilitados.has(activo)).toBe(true);
        }
        for (const soloLectura of estado.modulosEnSoloLectura) {
          expect(d.modulosHabilitados.has(soloLectura)).toBe(false);
        }
      }),
    );
  });

  it("es determinista y no depende de nada fuera de sus entradas", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        expect(calcular(e)).toEqual(calcular(e));
      }),
    );
  });
});

describe("exigirPerilla: propiedades", () => {
  const limites = fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant("ILIMITADO" as const));

  it("un límite pasa exactamente si el uso es menor que el tope (ILIMITADO siempre)", () => {
    fc.assert(
      fc.property(limites, fc.integer({ min: 0, max: 30 }), (limite, uso) => {
        const d = {
          empresaId: null,
          perillas: new Map([["p", { tipo: "LIMITE" as const, limite, origen: "PLAN" as const }]]),
        };
        const r = exigirPerilla(d, "p", {}, uso);
        expect(r.ok).toBe(limite === "ILIMITADO" || uso < limite);
        if (!r.ok) {
          expect(r.error).toEqual({
            codigo: "LIMITE_DEL_PLAN",
            perilla: "p",
            limite,
            usoActual: uso,
          });
        }
      }),
    );
  });

  it("un interruptor depende solo de si está encendido, sea cual sea el uso", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.option(fc.nat(100), { nil: undefined }), (encendida, uso) => {
        const d = {
          empresaId: null,
          perillas: new Map([
            ["p", { tipo: "INTERRUPTOR" as const, encendida, origen: "BASE" as const }],
          ]),
        };
        const r = exigirPerilla(d, "p", {}, uso);
        expect(r.ok).toBe(encendida);
        if (!r.ok) expect(r.error).toEqual({ codigo: "FUNCION_NO_INCLUIDA", perilla: "p" });
      }),
    );
  });

  it("con derechos calculados, exigir sin uso equivale a «está encendida»", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const d = calcular(e);
        for (const perilla of CLAVES_DE_PERILLAS_DE_PRUEBA) {
          expect(exigirPerilla(d, perilla, {}).ok).toBe(estaEncendida(valorDePerilla(d, perilla)));
        }
      }),
    );
  });
});
