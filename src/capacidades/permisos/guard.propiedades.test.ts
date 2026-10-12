import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { modulosActivosDe } from "../modulos/activos";
import { EFECTOS_DE_ACCION, type EfectoDeAccion } from "../modulos/catalogo";
import { evaluarGuard, type ModuloDelGuard, type MotivoDeRechazo } from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * P3: propiedades del guard sobre catálogos GENERADOS (no solo el real). El oráculo es una
 * reimplementación distinta de la del guard: una lista ordenada de condiciones de rechazo, en el orden
 * fijo desarrollo → no activo → solo lectura → capacidad → rol (corrección 16).
 */

const CAPACIDADES = ["caja", "balanza", "deposito"] as const;

type Escenario = Readonly<{
  catalogo: Record<string, ModuloDelGuard<string>>;
  permisos: Record<string, readonly RolDeEmpresa[]>;
  /** La acción que se evalúa y el módulo que la declara. */
  accion: string;
  modulo: string;
  capacidad: string | null;
  efecto: EfectoDeAccion;
  rol: RolDeEmpresa | null;
  activos: ReadonlySet<string>;
  /** Independiente de `activos`: pueden solaparse (el guard tiene que resolverlo). */
  soloLectura: ReadonlySet<string>;
  capacidades: ReadonlySet<string> | null;
}>;

const capacidadExigida = fc.option(fc.constantFrom(...CAPACIDADES), { nil: null });
const efecto = fc.constantFrom(...EFECTOS_DE_ACCION);
const rol = fc.option(fc.constantFrom(...ROLES_DE_EMPRESA), { nil: null });

const escenario: fc.Arbitrary<Escenario> = fc
  .record({
    modulos: fc.array(
      fc.record({
        estado: fc.constantFrom("disponible", "en_desarrollo"),
        obligatorio: fc.boolean(),
        acciones: fc.array(
          fc.record({
            capacidad: capacidadExigida,
            efecto,
            roles: fc.subarray([...ROLES_DE_EMPRESA]),
          }),
          { minLength: 1, maxLength: 3 },
        ),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    elegido: fc.nat(),
    rol,
    activos: fc.subarray([0, 1, 2, 3]),
    soloLectura: fc.subarray([0, 1, 2, 3]),
    capacidades: fc.option(fc.subarray([...CAPACIDADES]), { nil: null }),
  })
  .map((g) => {
    const catalogo: Record<string, ModuloDelGuard<string>> = {};
    const permisos: Record<string, readonly RolDeEmpresa[]> = {};
    const todas: {
      accion: string;
      modulo: string;
      capacidad: string | null;
      efecto: EfectoDeAccion;
    }[] = [];
    g.modulos.forEach((m, i) => {
      const acciones: Record<string, { capacidad: string | null; efecto: EfectoDeAccion }> = {};
      m.acciones.forEach((a, j) => {
        const nombre = `m${i}.a${j}`;
        acciones[nombre] = { capacidad: a.capacidad, efecto: a.efecto };
        permisos[nombre] = a.roles;
        todas.push({ accion: nombre, modulo: `m${i}`, capacidad: a.capacidad, efecto: a.efecto });
      });
      catalogo[`m${i}`] = { estado: m.estado, obligatorio: m.obligatorio, acciones };
    });
    const elegida = todas[g.elegido % todas.length];
    if (elegida === undefined) throw new Error("el generador no produjo acciones");
    return {
      catalogo,
      permisos,
      ...elegida,
      rol: g.rol,
      activos: new Set(g.activos.map((i) => `m${i}`)),
      soloLectura: new Set(g.soloLectura.map((i) => `m${i}`)),
      capacidades: g.capacidades === null ? null : new Set(g.capacidades),
    };
  });

const evaluar = (
  e: Escenario,
  activos = e.activos,
  capacidades = e.capacidades,
  soloLectura = e.soloLectura,
) =>
  evaluarGuard({ catalogo: e.catalogo, permisos: e.permisos }, e.accion, {
    rol: e.rol,
    modulosActivos: activos,
    modulosEnSoloLectura: soloLectura,
    capacidadesDeSucursal: capacidades,
  });

/** El módulo dueño de la acción, que el escenario siempre trae. */
function duenoDe(e: Escenario): ModuloDelGuard<string> {
  const dueno = e.catalogo[e.modulo];
  if (dueno === undefined) throw new Error("falta el módulo del escenario");
  return dueno;
}

/** Solo lectura efectiva: lo marcaron Y no es obligatorio (el núcleo no depende de un plan). */
const enSoloLectura = (e: Escenario, soloLectura = e.soloLectura): boolean =>
  soloLectura.has(e.modulo) && !duenoDe(e).obligatorio;

/** El oráculo: la lista ordenada de condiciones de rechazo; el primer motivo que se cumple. */
function motivoEsperado(e: Escenario): MotivoDeRechazo | null {
  const condiciones: readonly (readonly [boolean, MotivoDeRechazo])[] = [
    [e.catalogo[e.modulo]?.estado === "en_desarrollo", "MODULO_EN_DESARROLLO"],
    [!e.activos.has(e.modulo) && !enSoloLectura(e), "MODULO_NO_ACTIVO"],
    [enSoloLectura(e) && e.efecto === "CREA_AMPLIA", "MODULO_EN_SOLO_LECTURA"],
    [
      e.capacidad !== null && (e.capacidades === null || !e.capacidades.has(e.capacidad)),
      "SIN_CAPACIDAD",
    ],
    [e.rol === null || !(e.permisos[e.accion] ?? []).includes(e.rol), "SIN_PERMISO"],
  ];
  return condiciones.find(([falla]) => falla)?.[1] ?? null;
}

describe("evaluarGuard: propiedades", () => {
  it("(a) equivale al oráculo: ok ⇔ disponible ∧ activo ∧ solo lectura ∧ capacidad ∧ rol; si no, el primer motivo", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const esperado = motivoEsperado(e);
        const resultado = evaluar(e);
        expect(resultado).toEqual(
          esperado === null ? { ok: true, valor: null } : { ok: false, error: esperado },
        );
      }),
    );
  });

  it("(a') ok ⇔ las cinco condiciones a la vez", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const cumple =
          e.catalogo[e.modulo]?.estado === "disponible" &&
          (e.activos.has(e.modulo) || enSoloLectura(e)) &&
          !(enSoloLectura(e) && e.efecto === "CREA_AMPLIA") &&
          (e.capacidad === null || (e.capacidades !== null && e.capacidades.has(e.capacidad))) &&
          e.rol !== null &&
          (e.permisos[e.accion] ?? []).includes(e.rol);
        expect(evaluar(e).ok).toBe(cumple);
      }),
    );
  });

  it("(b) monotonía: sumar módulos activos o capacidades nunca convierte un ok en rechazo", () => {
    fc.assert(
      fc.property(
        escenario,
        fc.subarray(["m0", "m1", "m2", "m3", "otro"]),
        fc.subarray([...CAPACIDADES]),
        (e, masModulos, masCapacidades) => {
          if (!evaluar(e).ok) return;
          const activos = new Set([...e.activos, ...masModulos]);
          const capacidades =
            e.capacidades === null ? null : new Set([...e.capacidades, ...masCapacidades]);
          expect(evaluar(e, activos, capacidades).ok).toBe(true);
        },
      ),
    );
  });

  it("(c) sin rol nunca hay ok", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        expect(evaluar({ ...e, rol: null }).ok).toBe(false);
      }),
    );
  });

  it("(d) un módulo en desarrollo siempre da MODULO_EN_DESARROLLO, sea cual sea el resto", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const enDesarrollo = {
          ...e.catalogo,
          [e.modulo]: { ...duenoDe(e), estado: "en_desarrollo" as const },
        };
        expect(evaluar({ ...e, catalogo: enDesarrollo })).toEqual({
          ok: false,
          error: "MODULO_EN_DESARROLLO",
        });
      }),
    );
  });

  it("(e) es determinista y no modifica sus entradas", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const fotoCatalogo = JSON.stringify(e.catalogo);
        const fotoPermisos = JSON.stringify(e.permisos);
        const fotoActivos = JSON.stringify([...e.activos]);
        const fotoSoloLectura = JSON.stringify([...e.soloLectura]);
        const fotoCapacidades = JSON.stringify(e.capacidades === null ? null : [...e.capacidades]);
        expect(evaluar(e)).toEqual(evaluar(e));
        expect(JSON.stringify(e.catalogo)).toBe(fotoCatalogo);
        expect(JSON.stringify(e.permisos)).toBe(fotoPermisos);
        expect(JSON.stringify([...e.activos])).toBe(fotoActivos);
        expect(JSON.stringify([...e.soloLectura])).toBe(fotoSoloLectura);
        expect(JSON.stringify(e.capacidades === null ? null : [...e.capacidades])).toBe(
          fotoCapacidades,
        );
      }),
    );
  });

  it("(g) en solo lectura, una acción que crea o amplía da MODULO_EN_SOLO_LECTURA, sea cual sea la capacidad y el rol", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const dueno = duenoDe(e);
        fc.pre(dueno.estado === "disponible" && !dueno.obligatorio && e.efecto === "CREA_AMPLIA");
        const marcado = new Set([...e.soloLectura, e.modulo]);
        expect(evaluar(e, e.activos, e.capacidades, marcado)).toEqual({
          ok: false,
          error: "MODULO_EN_SOLO_LECTURA",
        });
      }),
    );
  });

  it("(h) pasar un módulo de activo a solo lectura solo cambia lo que era una acción que crea o amplía", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const dueno = duenoDe(e);
        fc.pre(dueno.estado === "disponible" && !dueno.obligatorio);
        const activo = evaluar(
          e,
          new Set([...e.activos, e.modulo]),
          e.capacidades,
          new Set([...e.soloLectura].filter((m) => m !== e.modulo)),
        );
        const enLectura = evaluar(
          e,
          new Set([...e.activos].filter((m) => m !== e.modulo)),
          e.capacidades,
          new Set([...e.soloLectura, e.modulo]),
        );
        if (e.efecto === "CREA_AMPLIA") {
          expect(enLectura).toEqual({ ok: false, error: "MODULO_EN_SOLO_LECTURA" });
        } else {
          expect(enLectura).toEqual(activo);
        }
      }),
    );
  });

  it("(i) un módulo obligatorio (el núcleo) nunca está en solo lectura: marcarlo no cambia nada", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        fc.pre(duenoDe(e).obligatorio);
        const con = new Set([...e.soloLectura, e.modulo]);
        const sin = new Set([...e.soloLectura].filter((m) => m !== e.modulo));
        expect(evaluar(e, e.activos, e.capacidades, con)).toEqual(
          evaluar(e, e.activos, e.capacidades, sin),
        );
      }),
    );
  });

  it("(j) omitir modulosEnSoloLectura equivale a un conjunto vacío", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const reglas = { catalogo: e.catalogo, permisos: e.permisos };
        const sinEl = evaluarGuard(reglas, e.accion, {
          rol: e.rol,
          modulosActivos: e.activos,
          capacidadesDeSucursal: e.capacidades,
        });
        expect(sinEl).toEqual(evaluar(e, e.activos, e.capacidades, new Set()));
      }),
    );
  });
});

describe("modulosActivosDe: propiedades", () => {
  const generado = fc.record({
    modulos: fc.array(
      fc.record({
        estado: fc.constantFrom("disponible", "en_desarrollo"),
        obligatorio: fc.boolean(),
      }),
      { maxLength: 5 },
    ),
    activados: fc.array(
      fc.oneof(
        fc.constantFrom<string>("m0", "m1", "m2", "m3", "m4"),
        fc.constantFrom<string>("desconocido", "constructor", "toString", "__proto__", ""),
      ),
      { maxLength: 8 },
    ),
  });

  it("(f) incluye siempre los obligatorios, e ignora claves desconocidas y módulos en desarrollo", () => {
    fc.assert(
      fc.property(generado, ({ modulos, activados }) => {
        const catalogo: Record<string, ModuloDelGuard<string>> = {};
        modulos.forEach((m, i) => {
          catalogo[`m${i}`] = { ...m, acciones: {} };
        });
        const activos = modulosActivosDe(catalogo, activados);
        for (const [clave, m] of Object.entries(catalogo)) {
          if (m.obligatorio) expect(activos.has(clave)).toBe(true);
          // Un no obligatorio está activo solo si lo activaron Y está disponible.
          if (!m.obligatorio) {
            expect(activos.has(clave)).toBe(m.estado === "disponible" && activados.includes(clave));
          }
        }
        for (const clave of activos) expect(Object.hasOwn(catalogo, clave)).toBe(true);
      }),
    );
  });
});
