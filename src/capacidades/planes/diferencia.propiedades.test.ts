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
  valorDePerilla,
  type AjusteDePerilla,
  type VersionDePlanVigente,
} from "./derechos";
import { diferenciaEntreVersiones } from "./diferencia";
import type { DefinicionDePerilla } from "./perillas";
import type { ValorDePerilla } from "./valores";

/**
 * §D «Cambio de plan N2»: la diferencia entre versiones coincide con aplicar una y otra versión a
 * `derechosDeUso`. El oráculo ES `derechosDeUso` (la fuente de verdad de lo que rige), comparado con
 * lo que dice la diferencia.
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
        .oneof(fc.integer({ min: 0, max: 5 }), fc.constant("ILIMITADO" as const))
        .map((limite) => ({ tipo: "LIMITE", limite }));

const contenido = fc.record({
  modulos: fc.subarray(CLAVES_DE_MODULOS_DE_PRUEBA),
  perillas: fc.record(
    Object.fromEntries(
      CLAVES_DE_PERILLAS_DE_PRUEBA.map((k) => [k, valorDe(catalogo[k] as DefinicionDePerilla)]),
    ),
    { requiredKeys: [] },
  ) as fc.Arbitrary<Record<string, ValorDePerilla>>,
});

const ajustesAleatorios = fc
  .array(
    fc
      .record({
        perilla: fc.constantFrom(...CLAVES_DE_PERILLAS_DE_PRUEBA),
        empresa: fc.constantFrom(null, E1, E2),
        horas: fc.integer({ min: -24, max: 24 }),
        delPlan: fc.boolean(),
      })
      .chain((a) =>
        valorDe(catalogo[a.perilla] as DefinicionDePerilla).map((valor) => ({ ...a, valor })),
      ),
    { maxLength: 8 },
  )
  .map((lista): AjusteDePerilla[] =>
    lista.map((a, i) => ({
      perilla: a.perilla,
      empresaId: a.empresa,
      numero: i + 1,
      vigenteDesde: new Date(BASE + a.horas * HORA),
      valor: a.delPlan ? "DEL_PLAN" : a.valor,
    })),
  );

const comoVersion = (c: {
  modulos: string[];
  perillas: Record<string, ValorDePerilla>;
}): VersionDePlanVigente => ({
  planId: planId("p"),
  versionDePlanId: versionDePlanId("v"),
  numero: 1,
  ...c,
});

const derechos = (
  c: { modulos: string[]; perillas: Record<string, ValorDePerilla> },
  ajustes: readonly AjusteDePerilla[],
  empresa: typeof E1 | null,
) =>
  derechosDeUso({
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
    tenantId: T,
    empresaId: empresa,
    versionDePlan: comoVersion(c),
    ajustes,
    ahora,
  });

const orden = (v: ValorDePerilla): number =>
  v.tipo === "INTERRUPTOR"
    ? Number(v.encendida)
    : v.limite === "ILIMITADO"
      ? Number.POSITIVE_INFINITY
      : v.limite;

const sinOrigen = (v: ValorDePerilla): ValorDePerilla =>
  v.tipo === "INTERRUPTOR"
    ? { tipo: "INTERRUPTOR", encendida: v.encendida }
    : { tipo: "LIMITE", limite: v.limite };

describe("diferenciaEntreVersiones: coincide con aplicar las dos versiones a derechosDeUso", () => {
  const diferencia = (
    desde: Parameters<typeof comoVersion>[0],
    hasta: Parameters<typeof comoVersion>[0],
    tenants: Parameters<typeof diferenciaEntreVersiones>[0]["tenants"] = [],
  ) =>
    diferenciaEntreVersiones({
      catalogoDeModulos: MODULOS_DE_PRUEBA,
      catalogoDePerillas: PERILLAS_DE_PRUEBA,
      desde,
      hasta,
      tenants,
      ahora,
    });

  it("los módulos que entran y salen son la diferencia de los módulos habilitados", () => {
    fc.assert(
      fc.property(contenido, contenido, (desde, hasta) => {
        const a = derechos(desde, [], null).modulosHabilitados;
        const b = derechos(hasta, [], null).modulosHabilitados;
        const r = diferencia(desde, hasta);
        expect(new Set(r.modulosQueEntran)).toEqual(new Set([...b].filter((m) => !a.has(m))));
        expect(new Set(r.modulosQueSalen)).toEqual(new Set([...a].filter((m) => !b.has(m))));
        // Disjuntos y sin repetidos.
        expect(r.modulosQueEntran.some((m) => r.modulosQueSalen.includes(m))).toBe(false);
        expect(new Set(r.modulosQueEntran).size).toBe(r.modulosQueEntran.length);
      }),
    );
  });

  it("las perillas listadas son exactamente las que cambian de valor efectivo, con el sentido correcto", () => {
    fc.assert(
      fc.property(contenido, contenido, (desde, hasta) => {
        const a = derechos(desde, [], null);
        const b = derechos(hasta, [], null);
        const r = diferencia(desde, hasta);
        const cambian = CLAVES_DE_PERILLAS_DE_PRUEBA.filter(
          (p) => orden(valorDePerilla(a, p)) !== orden(valorDePerilla(b, p)),
        );
        expect(r.perillas.map((c) => c.perilla)).toEqual(cambian);
        for (const c of r.perillas) {
          expect(c.desde).toEqual(sinOrigen(valorDePerilla(a, c.perilla)));
          expect(c.hasta).toEqual(sinOrigen(valorDePerilla(b, c.perilla)));
          expect(c.sentido).toBe(orden(c.hasta) > orden(c.desde) ? "SUBE" : "BAJA");
        }
      }),
    );
  });

  it("comparar una versión consigo misma, o ir y volver, es consistente", () => {
    fc.assert(
      fc.property(contenido, contenido, (x, y) => {
        const mismo = diferencia(x, x);
        expect(mismo.modulosQueEntran).toEqual([]);
        expect(mismo.modulosQueSalen).toEqual([]);
        expect(mismo.perillas).toEqual([]);
        const ida = diferencia(x, y);
        const vuelta = diferencia(y, x);
        expect(vuelta.modulosQueEntran).toEqual(ida.modulosQueSalen);
        expect(vuelta.modulosQueSalen).toEqual(ida.modulosQueEntran);
        expect(vuelta.perillas.map((c) => [c.perilla, c.desde, c.hasta])).toEqual(
          ida.perillas.map((c) => [c.perilla, c.hasta, c.desde]),
        );
        for (const c of ida.perillas) {
          const opuesto = vuelta.perillas.find((o) => o.perilla === c.perilla);
          expect(opuesto?.sentido).toBe(c.sentido === "SUBE" ? "BAJA" : "SUBE");
        }
      }),
    );
  });

  it("por tenant: los módulos en solo lectura son los de estadoDeModulos con el techo de destino", () => {
    fc.assert(
      fc.property(
        contenido,
        contenido,
        fc.subarray(CLAVES_DE_MODULOS_DE_PRUEBA),
        (desde, hasta, activados) => {
          const r = diferencia(desde, hasta, [
            {
              tenantId: T,
              ajustes: [],
              empresas: [{ empresaId: E1, modulosActivados: activados }],
            },
          ]);
          const antes = estadoDeModulos(MODULOS_DE_PRUEBA, activados, [
            ...derechos(desde, [], E1).modulosHabilitados,
          ]);
          const despues = estadoDeModulos(MODULOS_DE_PRUEBA, activados, [
            ...derechos(hasta, [], E1).modulosHabilitados,
          ]);
          const p = r.porTenant[0];
          expect(new Set(p?.modulosEnSoloLectura.map((m) => m.modulo))).toEqual(
            despues.modulosEnSoloLectura,
          );
          for (const m of p?.modulosEnSoloLectura ?? []) {
            expect(m.yaLoEstaba).toBe(antes.modulosEnSoloLectura.has(m.modulo as never));
          }
          expect(new Set(p?.modulosQueVuelvenAOperar.map((m) => m.modulo))).toEqual(
            new Set([...antes.modulosEnSoloLectura].filter((m) => despues.modulosActivos.has(m))),
          );
        },
      ),
    );
  });

  it("por tenant: un ajuste del tenant que pisa un cambio deja la perilla igual con las dos versiones", () => {
    fc.assert(
      fc.property(contenido, contenido, ajustesAleatorios, (desde, hasta, ajustes) => {
        const r = diferencia(desde, hasta, [{ tenantId: T, ajustes, empresas: [] }]);
        const a = derechos(desde, ajustes, null);
        const b = derechos(hasta, ajustes, null);
        for (const ajuste of r.porTenant[0]?.ajustes ?? []) {
          if (ajuste.empresaId !== null) continue;
          // Una perilla sin `requiere`: el plan no puede apagarla por una requerida distinta en cada versión.
          if ((catalogo[ajuste.perilla] as DefinicionDePerilla).requiere !== undefined) continue;
          // Si el ajuste del tenant manda en las dos versiones, el valor es el mismo (el cambio se pierde).
          const x = valorDePerilla(a, ajuste.perilla);
          const y = valorDePerilla(b, ajuste.perilla);
          if (x.origen === "AJUSTE" && y.origen === "AJUSTE") {
            expect(sinOrigen(x)).toEqual(sinOrigen(y));
          }
        }
      }),
    );
  });
});
