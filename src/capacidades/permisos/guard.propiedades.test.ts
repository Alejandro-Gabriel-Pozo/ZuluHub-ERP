import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { modulosActivosDe } from "../modulos/activos";
import { evaluarGuard, type ModuloDelGuard, type MotivoDeRechazo } from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * P3: propiedades del guard sobre catálogos GENERADOS (no solo el real). El oráculo es una
 * reimplementación distinta de la del guard: una lista ordenada de condiciones de rechazo.
 */

const CAPACIDADES = ["caja", "balanza", "deposito"] as const;

type Escenario = Readonly<{
  catalogo: Record<string, ModuloDelGuard<string>>;
  permisos: Record<string, readonly RolDeEmpresa[]>;
  /** La acción que se evalúa y el módulo que la declara. */
  accion: string;
  modulo: string;
  capacidad: string | null;
  rol: RolDeEmpresa | null;
  activos: ReadonlySet<string>;
  capacidades: ReadonlySet<string> | null;
}>;

const capacidadExigida = fc.option(fc.constantFrom(...CAPACIDADES), { nil: null });
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
    capacidades: fc.option(fc.subarray([...CAPACIDADES]), { nil: null }),
  })
  .map((g) => {
    const catalogo: Record<string, ModuloDelGuard<string>> = {};
    const permisos: Record<string, readonly RolDeEmpresa[]> = {};
    const todas: { accion: string; modulo: string; capacidad: string | null }[] = [];
    g.modulos.forEach((m, i) => {
      const acciones: Record<string, { capacidad: string | null }> = {};
      m.acciones.forEach((a, j) => {
        const nombre = `m${i}.a${j}`;
        acciones[nombre] = { capacidad: a.capacidad };
        permisos[nombre] = a.roles;
        todas.push({ accion: nombre, modulo: `m${i}`, capacidad: a.capacidad });
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
      capacidades: g.capacidades === null ? null : new Set(g.capacidades),
    };
  });

const evaluar = (e: Escenario, activos = e.activos, capacidades = e.capacidades) =>
  evaluarGuard({ catalogo: e.catalogo, permisos: e.permisos }, e.accion, {
    rol: e.rol,
    modulosActivos: activos,
    capacidadesDeSucursal: capacidades,
  });

/** El oráculo: la lista ordenada de condiciones de rechazo; el primer motivo que se cumple. */
function motivoEsperado(e: Escenario): MotivoDeRechazo | null {
  const condiciones: readonly (readonly [boolean, MotivoDeRechazo])[] = [
    [e.catalogo[e.modulo]?.estado === "en_desarrollo", "MODULO_EN_DESARROLLO"],
    [!e.activos.has(e.modulo), "MODULO_NO_ACTIVO"],
    [
      e.capacidad !== null && (e.capacidades === null || !e.capacidades.has(e.capacidad)),
      "SIN_CAPACIDAD",
    ],
    [e.rol === null || !(e.permisos[e.accion] ?? []).includes(e.rol), "SIN_PERMISO"],
  ];
  return condiciones.find(([falla]) => falla)?.[1] ?? null;
}

describe("evaluarGuard: propiedades", () => {
  it("(a) equivale al oráculo: ok ⇔ disponible ∧ activo ∧ capacidad ∧ rol; si no, el primer motivo", () => {
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

  it("(a') ok ⇔ las cuatro condiciones a la vez", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const cumple =
          e.catalogo[e.modulo]?.estado === "disponible" &&
          e.activos.has(e.modulo) &&
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
        const dueno = e.catalogo[e.modulo];
        if (dueno === undefined) throw new Error("falta el módulo del escenario");
        const enDesarrollo = {
          ...e.catalogo,
          [e.modulo]: { ...dueno, estado: "en_desarrollo" as const },
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
        const fotoCapacidades = JSON.stringify(e.capacidades === null ? null : [...e.capacidades]);
        expect(evaluar(e)).toEqual(evaluar(e));
        expect(JSON.stringify(e.catalogo)).toBe(fotoCatalogo);
        expect(JSON.stringify(e.permisos)).toBe(fotoPermisos);
        expect(JSON.stringify([...e.activos])).toBe(fotoActivos);
        expect(JSON.stringify(e.capacidades === null ? null : [...e.capacidades])).toBe(
          fotoCapacidades,
        );
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
