import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planId } from "../../../primitivas/identificadores/marca";
import "../../../../test/propiedades/configuracion";
import {
  ASPECTO_POR_DEFECTO,
  ESQUINAS_DE_ASPECTO,
  ESTILOS_DE_ASPECTO,
  INGRESOS_DE_ASPECTO,
  LISTAS_DE_ASPECTO,
  SUPERFICIES_DE_ASPECTO,
  TITULOS_DE_ASPECTO,
  TOKENS_DE_ASPECTO,
  completarAspecto,
} from "./aspecto";
import { completarDefinicion, resolverDefinicion, type DefinicionDeMarca } from "./definicion";
import { decidirAltaDeMarca } from "./jerarquia";
import {
  COLORES_DE_SUPERFICIE,
  TOKENS_DE_TEMA,
  luminanciaRelativa,
  razonDeContraste,
  validarTema,
  type TokenDeTema,
} from "./tema";
import { decidirConfirmacionDeMarca } from "./version";
import { estadosDeVigencia, versionVigente, type VersionConVigencia } from "./vigencia";

const color = fc
  .tuple(...[0, 1, 2].map(() => fc.integer({ min: 0, max: 255 })))
  .map(
    ([r, g, b]) => `#${[r, g, b].map((c) => (c as number).toString(16).padStart(2, "0")).join("")}`,
  );

// ----- Tema y contraste -----------------------------------------------------------------------------

describe("luminancia y contraste (WCAG)", () => {
  it("la luminancia está entre 0 y 1", () => {
    fc.assert(
      fc.property(color, (c) => {
        const l = luminanciaRelativa(c);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1 + 1e-12);
      }),
    );
  });

  it("subir un canal nunca baja la luminancia", () => {
    fc.assert(
      fc.property(
        fc.tuple(...[0, 1, 2].map(() => fc.integer({ min: 0, max: 254 }))),
        fc.constantFrom(0, 1, 2),
        (canales, cual) => {
          const hex = (cs: number[]) =>
            `#${cs.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const mas = canales.map((c, i) => (i === cual ? c + 1 : c));
          expect(luminanciaRelativa(hex(mas))).toBeGreaterThan(luminanciaRelativa(hex(canales)));
        },
      ),
    );
  });

  it("la razón es simétrica, está entre 1 y 21, y con uno mismo vale 1", () => {
    fc.assert(
      fc.property(color, color, (a, b) => {
        const r = razonDeContraste(a, b);
        expect(r).toBe(razonDeContraste(b, a));
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(21 + 1e-9);
        expect(razonDeContraste(a, a)).toBe(1);
      }),
    );
  });

  it("alejar un color del otro nunca baja la razón", () => {
    fc.assert(
      fc.property(color, (c) => {
        // Entre un color y el blanco, un gris más oscuro contrasta al menos tanto.
        expect(razonDeContraste("#000000", "#ffffff")).toBeGreaterThanOrEqual(
          razonDeContraste(c, "#ffffff") - 1e-12,
        );
      }),
    );
  });
});

describe("validarTema: propiedades", () => {
  const tokenOCualquiera = fc.oneof(
    fc.constantFrom(...TOKENS_DE_TEMA),
    fc.string({ maxLength: 8 }),
  );
  const valorOCualquiera = fc.oneof(
    color,
    fc.string({ maxLength: 10 }),
    color.map((c) => c.toUpperCase()),
    fc.constantFrom(1, null, undefined),
  );

  it("acepta exactamente cuando todas las claves son tokens y todos los valores son #rrggbb en minúsculas", () => {
    fc.assert(
      fc.property(fc.dictionary(tokenOCualquiera, valorOCualquiera, { maxKeys: 4 }), (tema) => {
        const sirve = Object.entries(tema).every(
          ([token, valor]) =>
            (TOKENS_DE_TEMA as readonly string[]).includes(token) &&
            typeof valor === "string" &&
            /^#[0-9a-f]{6}$/.test(valor),
        );
        expect(validarTema(tema).ok).toBe(sirve);
      }),
    );
  });

  it("un tema aceptado se devuelve igual, sin inventar ni perder tokens", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...TOKENS_DE_TEMA), color, { maxKeys: 4 }),
        (tema) => {
          const r = validarTema(tema);
          expect(r).toEqual({ ok: true, valor: tema });
        },
      ),
    );
  });
});

// ----- Herencia -------------------------------------------------------------------------------------

const PLANES = [planId("plan-a"), planId("plan-b")];

const definicion: fc.Arbitrary<DefinicionDeMarca> = fc.record({
  nombreVisible: fc.option(fc.constantFrom("Uno", "Dos", "Tres"), { nil: null }),
  tema: fc.dictionary(fc.constantFrom(...TOKENS_DE_TEMA), color, { maxKeys: 4 }),
  aspecto: fc.record(
    {
      estilo: fc.constantFrom(...ESTILOS_DE_ASPECTO),
      superficie: fc.constantFrom(...SUPERFICIES_DE_ASPECTO),
      esquinas: fc.constantFrom(...ESQUINAS_DE_ASPECTO),
      titulos: fc.constantFrom(...TITULOS_DE_ASPECTO),
      ingreso: fc.constantFrom(...INGRESOS_DE_ASPECTO),
    },
    { requiredKeys: [] },
  ),
  logo: fc.option(fc.constantFrom("/marcas/a/uno.png", "/marcas/b/dos.webp"), { nil: null }),
  vocabulario: fc.dictionary(
    fc.constantFrom(
      "rol.gerente.nombre",
      "rol.operador.nombre",
      "motivo.sin_permiso",
      "vieja.clave",
    ),
    fc.constantFrom("Texto uno", "Texto dos", "", "<b>"),
    { maxKeys: 3 },
  ),
  modulosIniciales: fc.option(fc.subarray(["reservas", "stock", "caja"], { minLength: 0 }), {
    nil: null,
  }),
  planPorDefectoId: fc.option(fc.constantFrom(...PLANES), { nil: null }),
});
const cadena = fc.array(fc.option(definicion, { nil: null }), { maxLength: 3 });

const presentes = (c: readonly (DefinicionDeMarca | null)[]) =>
  c.filter((e): e is DefinicionDeMarca => e !== null);

describe("herencia entre marcas: propiedades", () => {
  it("cada campo sale del primer eslabón que lo define, y si nadie lo define queda sin definir", () => {
    fc.assert(
      fc.property(cadena, (c) => {
        const r = resolverDefinicion(c);
        const e = presentes(c);
        expect(r.nombreVisible).toBe(
          e.find((x) => x.nombreVisible !== null)?.nombreVisible ?? null,
        );
        expect(r.logo).toBe(e.find((x) => x.logo !== null)?.logo ?? null);
        expect(r.modulosIniciales).toEqual(
          e.find((x) => x.modulosIniciales !== null)?.modulosIniciales ?? null,
        );
        expect(r.planPorDefectoId).toBe(
          e.find((x) => x.planPorDefectoId !== null)?.planPorDefectoId ?? null,
        );
      }),
    );
  });

  it("el tema no pierde ni inventa tokens: sale token por token del primer eslabón que lo trae", () => {
    fc.assert(
      fc.property(cadena, (c) => {
        const r = resolverDefinicion(c).tema;
        const e = presentes(c);
        for (const token of TOKENS_DE_TEMA as readonly TokenDeTema[]) {
          expect(r[token]).toBe(e.find((x) => x.tema[token] !== undefined)?.tema[token]);
        }
        expect(Object.keys(r).every((k) => (TOKENS_DE_TEMA as readonly string[]).includes(k))).toBe(
          true,
        );
      }),
    );
  });

  it("el aspecto no pierde ni inventa tokens: sale token por token del primer eslabón que lo trae, y completo nunca queda sin valor", () => {
    fc.assert(
      fc.property(cadena, (c) => {
        const r = resolverDefinicion(c).aspecto;
        const e = presentes(c);
        for (const token of TOKENS_DE_ASPECTO) {
          expect(r[token]).toBe(e.find((x) => x.aspecto[token] !== undefined)?.aspecto[token]);
        }
        expect(
          Object.keys(r).every((k) => (TOKENS_DE_ASPECTO as readonly string[]).includes(k)),
        ).toBe(true);
        const completo = completarAspecto(r);
        for (const token of TOKENS_DE_ASPECTO) {
          expect(completo[token]).toBe(r[token] ?? ASPECTO_POR_DEFECTO[token]);
          expect((LISTAS_DE_ASPECTO[token] as readonly string[]).includes(completo[token])).toBe(
            true,
          );
        }
      }),
    );
  });

  it("el vocabulario resuelto solo trae claves que algún eslabón tenía", () => {
    fc.assert(
      fc.property(cadena, (c) => {
        const claves = new Set(presentes(c).flatMap((e) => Object.keys(e.vocabulario)));
        for (const k of Object.keys(resolverDefinicion(c).vocabulario))
          expect(claves.has(k)).toBe(true);
      }),
    );
  });

  it("un eslabón de más al final, vacío o sin versión, no cambia nada", () => {
    fc.assert(
      fc.property(cadena, (c) => {
        const base = resolverDefinicion(c);
        expect(resolverDefinicion([...c, null])).toEqual(base);
        expect(
          resolverDefinicion([
            ...c,
            {
              nombreVisible: null,
              tema: {},
              aspecto: {},
              logo: null,
              vocabulario: {},
              modulosIniciales: null,
              planPorDefectoId: null,
            },
          ]),
        ).toEqual(base);
      }),
    );
  });

  it("resolver es idempotente: lo resuelto, resuelto de nuevo, no cambia", () => {
    fc.assert(
      fc.property(cadena, (c) => {
        const r = resolverDefinicion(c);
        expect(resolverDefinicion([r as DefinicionDeMarca])).toEqual(r);
      }),
    );
  });

  it("completa exactamente cuando la marca define su nombre y la herencia llena todo lo demás", () => {
    fc.assert(
      fc.property(definicion, cadena, (propia, ancestros) => {
        const r = resolverDefinicion([propia, ...ancestros]);
        const completa = completarDefinicion(propia, r);
        const sinHuecos =
          propia.nombreVisible !== null &&
          TOKENS_DE_TEMA.every((t) => r.tema[t] !== undefined) &&
          r.logo !== null &&
          r.modulosIniciales !== null &&
          r.planPorDefectoId !== null;
        expect(completa.ok).toBe(sinHuecos);
        if (!completa.ok) expect(completa.error.length).toBeGreaterThan(0);
      }),
    );
  });
});

// ----- Vigencia -------------------------------------------------------------------------------------

const BASE = Date.UTC(2026, 9, 12);
const versiones = fc
  .uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 6 })
  .chain((numeros) =>
    fc.tuple(
      ...numeros.map((numero) =>
        fc.integer({ min: -6, max: 6 }).map((dias) => ({
          numero,
          vigenteDesde: new Date(BASE + dias * 86_400_000),
        })),
      ),
    ),
  );
const ahoras = fc.integer({ min: -7, max: 7 }).map((dias) => new Date(BASE + dias * 86_400_000));

describe("vigencia («la última decisión manda»): propiedades", () => {
  it("si alguna ya empezó, hay exactamente una vigente, la de mayor número entre las empezadas", () => {
    fc.assert(
      fc.property(versiones, ahoras, (vs, ahora) => {
        const empezadas = vs.filter((v) => v.vigenteDesde.getTime() <= ahora.getTime());
        const estados = estadosDeVigencia(vs, ahora);
        const vigentes = estados.filter((e) => e.estado === "VIGENTE");
        expect(vigentes).toHaveLength(empezadas.length === 0 ? 0 : 1);
        if (empezadas.length > 0) {
          expect(vigentes[0]?.numero).toBe(Math.max(...empezadas.map((v) => v.numero)));
          expect(versionVigente(vs, ahora)?.numero).toBe(vigentes[0]?.numero);
        } else {
          expect(versionVigente(vs, ahora)).toBeNull();
        }
      }),
    );
  });

  it("una versión nunca rige si y solo si es SIN_EFECTO: se mira qué rige en el instante en que empezaría", () => {
    fc.assert(
      fc.property(versiones, ahoras, (vs, ahora) => {
        for (const e of estadosDeVigencia(vs, ahora)) {
          const alEmpezar = versionVigente(vs, e.vigenteDesde);
          expect(e.estado === "SIN_EFECTO").toBe(alEmpezar?.numero !== e.numero);
        }
      }),
    );
  });

  it("PROGRAMADA es lo que empieza en el futuro y va a regir; ANTERIOR, lo que rigió y se reemplazó", () => {
    fc.assert(
      fc.property(versiones, ahoras, (vs, ahora) => {
        for (const e of estadosDeVigencia(vs, ahora)) {
          const futura = e.vigenteDesde.getTime() > ahora.getTime();
          if (e.estado === "PROGRAMADA") expect(futura).toBe(true);
          if (e.estado === "ANTERIOR" || e.estado === "VIGENTE") expect(futura).toBe(false);
          if (e.estado === "ANTERIOR")
            expect(e.numero).toBeLessThan(versionVigente(vs, ahora)?.numero ?? 0);
        }
      }),
    );
  });

  it("el orden en que vienen no cambia ningún estado", () => {
    fc.assert(
      fc.property(versiones, ahoras, fc.nat(), (vs, ahora, giro) => {
        const giradas =
          vs.length === 0 ? vs : [...vs.slice(giro % vs.length), ...vs.slice(0, giro % vs.length)];
        const porNumero = (xs: readonly VersionConVigencia[]) =>
          Object.fromEntries(estadosDeVigencia(xs, ahora).map((e) => [e.numero, e.estado]));
        expect(porNumero(giradas.reverse())).toEqual(porNumero(vs));
      }),
    );
  });
});

// ----- Confirmación ---------------------------------------------------------------------------------

describe("confirmar una versión: propiedades", () => {
  const AHORA = new Date(BASE);
  const MODULOS = ["reservas", "stock", "caja"];

  const borrador: fc.Arbitrary<DefinicionDeMarca> = fc.record({
    nombreVisible: fc.option(fc.constant("Marca"), { nil: null }),
    tema: fc.record(
      { primary: color, "on-primary": color, secondary: color, accent: color },
      { requiredKeys: [] },
    ),
    aspecto: fc.constant({}),
    logo: fc.option(fc.constant("/marcas/a/logo.png"), { nil: null }),
    vocabulario: fc.constant({}),
    modulosIniciales: fc.option(fc.subarray(MODULOS), { nil: null }),
    planPorDefectoId: fc.option(fc.constant(PLANES[0] as (typeof PLANES)[number]), { nil: null }),
  });
  const plan = fc.record({
    id: fc.constant(PLANES[0] as (typeof PLANES)[number]),
    retirado: fc.boolean(),
    modulos: fc.subarray(MODULOS),
  });
  const pedido = fc.record({
    vigenteDesde: fc
      .integer({ min: -5 * 60_000, max: 5 * 60_000 })
      .map((ms) => new Date(BASE + ms)),
    motivo: fc.constantFrom("", "  ", "Cambio de colores", " por pedido "),
    reemplazaProgramada: fc.boolean(),
  });

  it("si se confirma, la definición está completa, legible, dentro del plan, y el pedido es válido", () => {
    fc.assert(
      fc.property(borrador, plan, pedido, versiones, (b, p, ped, vs) => {
        const r = decidirConfirmacionDeMarca({
          borrador: b,
          ancestros: [],
          versiones: vs,
          planPorDefecto: p,
          pedido: ped,
          ahora: AHORA,
        });
        if (!r.ok) return;
        const d = r.valor.definicion;
        expect(r.valor.motivo).toBe(ped.motivo.trim());
        expect(r.valor.motivo).not.toBe("");
        expect(ped.vigenteDesde.getTime()).toBeGreaterThanOrEqual(AHORA.getTime() - 60_000);
        expect(razonDeContraste(d.tema["on-primary"], d.tema.primary)).toBeGreaterThanOrEqual(4.5);
        const colores = COLORES_DE_SUPERFICIE[d.aspecto.superficie];
        expect(razonDeContraste(d.tema.accent, colores.fondo)).toBeGreaterThanOrEqual(3);
        expect(razonDeContraste(d.tema.accent, colores.superficie)).toBeGreaterThanOrEqual(3);
        expect(d.modulosIniciales.every((m) => p.modulos.includes(m))).toBe(true);
        expect(p.retirado).toBe(false);
        expect(d.nombreVisible).toBe(b.nombreVisible);
      }),
    );
  });

  it("un borrador completo, legible y dentro del plan, con un pedido válido y sin programadas, siempre se confirma", () => {
    const legible = fc
      .record({
        primary: color,
        accent: color,
        superficie: fc.constantFrom(...SUPERFICIES_DE_ASPECTO),
      })
      .filter(
        ({ primary, accent, superficie }) =>
          razonDeContraste("#ffffff", primary) >= 4.5 &&
          razonDeContraste(accent, COLORES_DE_SUPERFICIE[superficie].fondo) >= 3 &&
          razonDeContraste(accent, COLORES_DE_SUPERFICIE[superficie].superficie) >= 3,
      );
    fc.assert(
      fc.property(legible, fc.subarray(MODULOS), color, (colores, modulos, secundario) => {
        const b: DefinicionDeMarca = {
          nombreVisible: "Marca",
          tema: {
            primary: colores.primary,
            accent: colores.accent,
            "on-primary": "#ffffff",
            secondary: secundario,
          },
          aspecto: { superficie: colores.superficie },
          logo: "/marcas/a/logo.png",
          vocabulario: {},
          modulosIniciales: modulos,
          planPorDefectoId: PLANES[0] as (typeof PLANES)[number],
        };
        const r = decidirConfirmacionDeMarca({
          borrador: b,
          ancestros: [],
          versiones: [],
          planPorDefecto: {
            id: PLANES[0] as (typeof PLANES)[number],
            retirado: false,
            modulos: MODULOS,
          },
          pedido: { vigenteDesde: AHORA, motivo: "ok", reemplazaProgramada: false },
          ahora: AHORA,
        });
        expect(r.ok).toBe(true);
      }),
    );
  });
});

// ----- Jerarquía ------------------------------------------------------------------------------------

describe("alta de marca: propiedades", () => {
  it("si se da el alta, la marca nace en el nivel 0 sin padre o en el 1 bajo la principal activa, nunca más abajo", () => {
    // Un padre coherente: la principal está siempre en el nivel 0; las demás, en el 0, el 1 o el 2.
    const padre = fc.option(
      fc.oneof(
        fc.record({
          id: fc.constant("m-1" as never),
          nivel: fc.constant(0),
          esPrincipal: fc.constant(true),
          estado: fc.constantFrom("ACTIVA" as const, "RETIRADA" as const),
        }),
        fc.record({
          id: fc.constant("m-2" as never),
          nivel: fc.integer({ min: 0, max: 2 }),
          esPrincipal: fc.constant(false),
          estado: fc.constantFrom("ACTIVA" as const, "RETIRADA" as const),
        }),
      ),
      { nil: null },
    );
    fc.assert(
      fc.property(fc.constantFrom("abc", "mi-marca", "X", "1a"), padre, (codigo, p) => {
        const r = decidirAltaDeMarca(codigo, p);
        if (!r.ok) return;
        expect(r.valor.nivel).toBe(p === null ? 0 : 1);
        expect(r.valor.nivel).toBeLessThanOrEqual(1);
        if (p !== null) {
          expect(p.esPrincipal).toBe(true);
          expect(p.estado).toBe("ACTIVA");
        }
      }),
    );
  });
});
