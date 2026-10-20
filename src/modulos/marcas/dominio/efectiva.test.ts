import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { planId } from "../../../primitivas/identificadores/marca";
import {
  ASPECTO_POR_DEFECTO,
  ESQUINAS_DE_ASPECTO,
  ESTILOS_DE_ASPECTO,
  INGRESOS_DE_ASPECTO,
  SUPERFICIES_DE_ASPECTO,
  TITULOS_DE_ASPECTO,
  TOKENS_DE_ASPECTO,
} from "./aspecto";
import {
  DEFINICION_VACIA,
  resolverDefinicion,
  type DefinicionDeMarca,
  type DefinicionResuelta,
} from "./definicion";
import { resolverConOrigen } from "./efectiva";
import { TOKENS_DE_TEMA } from "./tema";

const PLAN_A = planId("plan-a");
const PLAN_B = planId("plan-b");

const definicion = (cambios: Partial<DefinicionDeMarca> = {}): DefinicionDeMarca => ({
  ...DEFINICION_VACIA,
  ...cambios,
});

const PRINCIPAL: DefinicionDeMarca = {
  nombreVisible: "Pedernal",
  tema: {
    primary: "#1a73e8",
    "on-primary": "#ffffff",
    secondary: "#5f6368",
    accent: "#d93025",
  },
  aspecto: { estilo: "CLASICO", esquinas: "RECTA" },
  logo: "/marcas/pedernal/logo.png",
  vocabulario: { "rol.gerente.nombre": "Gerente general" },
  modulosIniciales: ["reservas"],
  planPorDefectoId: PLAN_A,
};

const PROPIO = { tipo: "propio" } as const;
const DEFECTO = { tipo: "defecto" } as const;
const heredado = (eslabon: number) => ({ tipo: "heredado", eslabon }) as const;

describe("resolverConOrigen", () => {
  it("el valor es el de resolverDefinicion y el aspecto sale completado con los defectos", () => {
    const hija = definicion({ nombreVisible: "Hija", aspecto: { titulos: "SERIF" } });
    const r = resolverConOrigen([hija, PRINCIPAL]);
    expect(r.resuelta).toEqual(resolverDefinicion([hija, PRINCIPAL]));
    expect(r.aspecto).toEqual({
      estilo: "CLASICO",
      superficie: ASPECTO_POR_DEFECTO.superficie,
      esquinas: "RECTA",
      titulos: "SERIF",
      ingreso: ASPECTO_POR_DEFECTO.ingreso,
    });
  });

  it("una marca sola: lo que define es propio y lo que no, defecto", () => {
    const r = resolverConOrigen([PRINCIPAL]);
    expect(r.origenes.nombreVisible).toEqual(PROPIO);
    expect(r.origenes.logo).toEqual(PROPIO);
    expect(r.origenes.modulosIniciales).toEqual(PROPIO);
    expect(r.origenes.planPorDefecto).toEqual(PROPIO);
    expect(r.origenes.tema).toEqual({
      primary: PROPIO,
      "on-primary": PROPIO,
      secondary: PROPIO,
      accent: PROPIO,
    });
    expect(r.origenes.aspecto).toEqual({
      estilo: PROPIO,
      superficie: DEFECTO,
      esquinas: PROPIO,
      titulos: DEFECTO,
      ingreso: DEFECTO,
    });
    expect(r.origenes.vocabulario).toEqual({ "rol.gerente.nombre": PROPIO });
  });

  it("sin nada definido todo es defecto y el vocabulario no lista textos", () => {
    for (const cadena of [[], [null], [DEFINICION_VACIA, null, DEFINICION_VACIA]]) {
      const r = resolverConOrigen(cadena);
      expect(r.origenes).toEqual({
        nombreVisible: DEFECTO,
        tema: { primary: DEFECTO, "on-primary": DEFECTO, secondary: DEFECTO, accent: DEFECTO },
        aspecto: {
          estilo: DEFECTO,
          superficie: DEFECTO,
          esquinas: DEFECTO,
          titulos: DEFECTO,
          ingreso: DEFECTO,
        },
        logo: DEFECTO,
        vocabulario: {},
        modulosIniciales: DEFECTO,
        planPorDefecto: DEFECTO,
      });
      expect(r.aspecto).toEqual(ASPECTO_POR_DEFECTO);
    }
  });

  it("lo que la hija no define lo hereda del padre (eslabón 1) y de ahí del abuelo (eslabón 2), campo por campo", () => {
    const abuelo = PRINCIPAL;
    const padre = definicion({
      nombreVisible: "Padre",
      tema: { primary: "#111111", secondary: "#222222" },
      planPorDefectoId: PLAN_B,
      aspecto: { superficie: "CALIDA" },
      vocabulario: { "rol.operador.nombre": "Mozo" },
    });
    const hija = definicion({
      tema: { primary: "#333333" },
      aspecto: { estilo: "MODERNO" },
      vocabulario: { "rol.gerente.nombre": "Jefe" },
    });
    const r = resolverConOrigen([hija, padre, abuelo]);
    expect(r.origenes.nombreVisible).toEqual(heredado(1));
    expect(r.origenes.tema).toEqual({
      primary: PROPIO,
      "on-primary": heredado(2),
      secondary: heredado(1),
      accent: heredado(2),
    });
    expect(r.origenes.aspecto).toEqual({
      estilo: PROPIO,
      superficie: heredado(1),
      esquinas: heredado(2),
      titulos: DEFECTO,
      ingreso: DEFECTO,
    });
    expect(r.origenes.logo).toEqual(heredado(2));
    expect(r.origenes.modulosIniciales).toEqual(heredado(2));
    expect(r.origenes.planPorDefecto).toEqual(heredado(1));
    expect(r.origenes.vocabulario).toEqual({
      "rol.gerente.nombre": PROPIO,
      "rol.operador.nombre": heredado(1),
    });
  });

  it("un eslabón sin versión (null) no aporta pero cuenta en la posición: el abuelo sigue siendo el eslabón 2", () => {
    const hija = definicion({ nombreVisible: "Hija" });
    const r = resolverConOrigen([hija, null, PRINCIPAL]);
    expect(r.origenes.nombreVisible).toEqual(PROPIO);
    expect(r.origenes.logo).toEqual(heredado(2));
    expect(r.origenes.tema.primary).toEqual(heredado(2));
  });

  it("la marca sin versión propia (primer eslabón null) no tiene nada propio", () => {
    const r = resolverConOrigen([null, PRINCIPAL]);
    expect(r.origenes.nombreVisible).toEqual(heredado(1));
    expect(r.origenes.logo).toEqual(heredado(1));
  });

  it("módulos iniciales: [] es una definición propia (solo administración) y no hereda; null sí", () => {
    const vacia = resolverConOrigen([definicion({ modulosIniciales: [] }), PRINCIPAL]);
    expect(vacia.resuelta.modulosIniciales).toEqual([]);
    expect(vacia.origenes.modulosIniciales).toEqual(PROPIO);
    const hereda = resolverConOrigen([definicion({ modulosIniciales: null }), PRINCIPAL]);
    expect(hereda.resuelta.modulosIniciales).toEqual(["reservas"]);
    expect(hereda.origenes.modulosIniciales).toEqual(heredado(1));
  });

  it("vocabulario: un reemplazo inválido o huérfano no cuenta como definido, igual que al resolver", () => {
    const hija = definicion({
      vocabulario: {
        "rol.operador.nombre": "  Mozo ",
        "vieja.clave.huerfana": "x",
        "rol.gerente.nombre": "<b>",
      },
    });
    const r = resolverConOrigen([hija, PRINCIPAL]);
    expect(r.resuelta.vocabulario).toEqual({
      "rol.operador.nombre": "Mozo",
      "rol.gerente.nombre": "Gerente general",
    });
    expect(r.origenes.vocabulario).toEqual({
      "rol.operador.nombre": PROPIO,
      "rol.gerente.nombre": heredado(1),
    });
  });

  it("el mismo texto definido en dos eslabones cuenta del primero", () => {
    const hija = definicion({ vocabulario: { "rol.gerente.nombre": "Jefe" } });
    const r = resolverConOrigen([hija, PRINCIPAL]);
    expect(r.resuelta.vocabulario["rol.gerente.nombre"]).toBe("Jefe");
    expect(r.origenes.vocabulario["rol.gerente.nombre"]).toEqual(PROPIO);
  });

  it("no modifica sus entradas", () => {
    const hija = definicion({ tema: { primary: "#333333" } });
    const copia = structuredClone([hija, PRINCIPAL]);
    resolverConOrigen([hija, PRINCIPAL]);
    expect([hija, PRINCIPAL]).toEqual(copia);
  });
});

// ----- Propiedad: el origen informado es el eslabón del que sale el valor ------------------------------------

const color = fc
  .tuple(...[0, 1, 2].map(() => fc.integer({ min: 0, max: 255 })))
  .map(
    ([r, g, b]) => `#${[r, g, b].map((c) => (c as number).toString(16).padStart(2, "0")).join("")}`,
  );

const temaAleatorio = fc.record(
  {
    primary: color,
    "on-primary": color,
    secondary: color,
    accent: color,
  },
  { requiredKeys: [] },
);

const aspectoAleatorio = fc.record(
  {
    estilo: fc.constantFrom(...ESTILOS_DE_ASPECTO),
    superficie: fc.constantFrom(...SUPERFICIES_DE_ASPECTO),
    esquinas: fc.constantFrom(...ESQUINAS_DE_ASPECTO),
    titulos: fc.constantFrom(...TITULOS_DE_ASPECTO),
    ingreso: fc.constantFrom(...INGRESOS_DE_ASPECTO),
  },
  { requiredKeys: [] },
);

/** Textos de vocabulario válidos, inválidos (con `<`) y claves que el catálogo no tiene. */
const vocabularioAleatorio = fc.dictionary(
  fc.constantFrom(
    "rol.gerente.nombre",
    "rol.operador.nombre",
    "rol.administrador.nombre",
    "modulo.administracion.nombre",
    "clave.huerfana.vieja",
  ),
  fc.constantFrom("Jefe", "Mozo", "  Encargado ", "<b>", ""),
);

const definicionAleatoria = fc.record({
  nombreVisible: fc.option(fc.constantFrom("Uno", "Dos"), { nil: null }),
  tema: temaAleatorio,
  aspecto: aspectoAleatorio,
  logo: fc.option(fc.constantFrom("/marcas/a/logo.png", "/marcas/b/logo.webp"), { nil: null }),
  vocabulario: vocabularioAleatorio,
  modulosIniciales: fc.option(fc.constantFrom([], ["reservas"], ["reservas", "stock"]), {
    nil: null,
  }),
  planPorDefectoId: fc.option(fc.constantFrom(PLAN_A, PLAN_B), { nil: null }),
}) as fc.Arbitrary<DefinicionDeMarca>;

const cadenaAleatoria = fc.array(fc.option(definicionAleatoria, { nil: null }), {
  minLength: 0,
  maxLength: 3,
});

describe("resolverConOrigen: propiedades", () => {
  it("el valor resuelto de cada campo es el que dice por sí solo el eslabón de origen, y con defecto nadie lo define", () => {
    fc.assert(
      fc.property(cadenaAleatoria, (cadena) => {
        const { resuelta, origenes } = resolverConOrigen(cadena);
        const solo = (origen: { tipo: string; eslabon?: number }): DefinicionResuelta | null => {
          if (origen.tipo === "defecto") return null;
          const eslabon = cadena[origen.tipo === "propio" ? 0 : (origen.eslabon as number)];
          // Un campo con origen siempre sale de un eslabón que existe.
          expect(eslabon).toBeTruthy();
          return resolverDefinicion([eslabon as DefinicionDeMarca]);
        };
        const escalares = [
          ["nombreVisible", origenes.nombreVisible, (d: typeof resuelta) => d.nombreVisible],
          ["logo", origenes.logo, (d: typeof resuelta) => d.logo],
          [
            "modulosIniciales",
            origenes.modulosIniciales,
            (d: typeof resuelta) => d.modulosIniciales,
          ],
          ["planPorDefecto", origenes.planPorDefecto, (d: typeof resuelta) => d.planPorDefectoId],
        ] as const;
        for (const [nombre, origen, leer] of escalares) {
          const dueno = solo(origen);
          expect(leer(resuelta), nombre).toEqual(dueno === null ? null : leer(dueno));
        }
        for (const token of TOKENS_DE_TEMA) {
          const dueno = solo(origenes.tema[token]);
          expect(resuelta.tema[token], token).toEqual(
            dueno === null ? undefined : dueno?.tema[token],
          );
        }
        for (const token of TOKENS_DE_ASPECTO) {
          const dueno = solo(origenes.aspecto[token]);
          expect(resuelta.aspecto[token], token).toEqual(
            dueno === null ? undefined : dueno?.aspecto[token],
          );
        }
      }),
    );
  });

  it("el origen es el PRIMER eslabón que define: ninguno anterior lo definía", () => {
    fc.assert(
      fc.property(cadenaAleatoria, (cadena) => {
        const { origenes } = resolverConOrigen(cadena);
        for (const token of TOKENS_DE_TEMA) {
          const origen = origenes.tema[token];
          const hasta =
            origen.tipo === "propio"
              ? 0
              : origen.tipo === "heredado"
                ? origen.eslabon
                : cadena.length;
          for (let i = 0; i < hasta; i++) {
            const eslabon = cadena[i];
            if (eslabon !== null && eslabon !== undefined) {
              expect(resolverDefinicion([eslabon]).tema[token]).toBeUndefined();
            }
          }
        }
      }),
    );
  });

  it("los textos listados son exactamente los del vocabulario resuelto, y el aspecto completo no deja huecos", () => {
    fc.assert(
      fc.property(cadenaAleatoria, (cadena) => {
        const { resuelta, origenes, aspecto } = resolverConOrigen(cadena);
        expect(Object.keys(origenes.vocabulario).sort()).toEqual(
          Object.keys(resuelta.vocabulario).sort(),
        );
        for (const token of TOKENS_DE_ASPECTO) {
          expect(aspecto[token]).toBe(resuelta.aspecto[token] ?? ASPECTO_POR_DEFECTO[token]);
        }
      }),
    );
  });
});
