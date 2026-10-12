import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { empresaId, sucursalId } from "../../../primitivas/identificadores/marca";
import "../../../../test/propiedades/configuracion";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL,
  decidirAltaConNombreOcupado,
  decidirDesactivacion,
  decidirEdicion,
  decidirReactivacion,
  nombreDeSucursalValido,
  type Sucursal,
} from "./sucursal";

const sucursal = (id: string, cambios: Partial<Sucursal> = {}): Sucursal => ({
  id: sucursalId(id),
  empresaId: empresaId("e-1"),
  nombre: `Sucursal ${id}`,
  activa: true,
  version: 1,
  ...cambios,
});

const INVALIDO = { ok: false, error: "NOMBRE_DE_SUCURSAL_INVALIDO" } as const;

describe("nombreDeSucursalValido", () => {
  it("devuelve el nombre sin espacios en los extremos", () => {
    expect(nombreDeSucursalValido("Casa central")).toEqual({ ok: true, valor: "Casa central" });
    expect(nombreDeSucursalValido("  Casa central \t")).toEqual({
      ok: true,
      valor: "Casa central",
    });
  });

  it("conserva los espacios del medio y las mayúsculas", () => {
    expect(nombreDeSucursalValido("Local  Nº 2")).toEqual({ ok: true, valor: "Local  Nº 2" });
  });

  it("rechaza el vacío y el que es solo espacios", () => {
    expect(nombreDeSucursalValido("")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("   ")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("  ")).toEqual(INVALIDO);
  });

  it("acepta hasta el largo máximo y rechaza uno más", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL).toBe(100);
    const justo = "a".repeat(100);
    expect(nombreDeSucursalValido(justo)).toEqual({ ok: true, valor: justo });
    expect(nombreDeSucursalValido(`${justo}a`)).toEqual(INVALIDO);
    // El largo se cuenta en caracteres, no en piezas del texto: 100 emojis entran.
    const emojis = "😀".repeat(100);
    expect(nombreDeSucursalValido(emojis)).toEqual({ ok: true, valor: emojis });
    expect(nombreDeSucursalValido(`${emojis}😀`)).toEqual(INVALIDO);
  });

  it("el largo máximo se mide después de limpiar los extremos", () => {
    const justo = "a".repeat(100);
    expect(nombreDeSucursalValido(`   ${justo}   `)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza los caracteres de control, también en el medio", () => {
    expect(nombreDeSucursalValido("Casa\ncentral")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("Casa\tcentral")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("Casa\u0000central")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("Casa\u007fcentral")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("Casa\u0085central")).toEqual(INVALIDO);
    expect(nombreDeSucursalValido("Casa central\r\n")).toEqual({ ok: true, valor: "Casa central" });
  });

  it("acepta letras con acento, ñ, símbolos y números", () => {
    for (const nombre of ["Sucursal Ñandú", "Local 3 – Norte", "Éxito & Cía.", "东京店"]) {
      expect(nombreDeSucursalValido(nombre)).toEqual({ ok: true, valor: nombre });
    }
  });

  it("normaliza a NFC: una letra escrita de una o de dos piezas es el mismo nombre", () => {
    const compuesta = "Café";
    const descompuesta = "Café";
    expect(descompuesta).not.toBe(compuesta);
    expect(nombreDeSucursalValido(descompuesta)).toEqual({ ok: true, valor: compuesta });
    expect(nombreDeSucursalValido(compuesta)).toEqual({ ok: true, valor: compuesta });
  });

  it("propiedad: lo que devuelve ok es estable (limpiarlo otra vez no lo cambia) y sin extremos en blanco", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (texto) => {
        const r = nombreDeSucursalValido(texto);
        if (!r.ok) return;
        expect(r.valor).toBe(r.valor.trim());
        expect(r.valor).not.toBe("");
        expect(nombreDeSucursalValido(r.valor)).toEqual(r);
      }),
    );
  });
});

describe("decidirDesactivacion", () => {
  const a = sucursal("a");
  const b = sucursal("b");

  it("una sucursal que no existe es SUCURSAL_NO_ENCONTRADA", () => {
    expect(decidirDesactivacion(null, [a, b])).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ENCONTRADA",
    });
    expect(decidirDesactivacion(null, [])).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
  });

  it("desactivar una ya inactiva es idempotente (aunque sea la única que queda activa de otras)", () => {
    const inactiva = sucursal("c", { activa: false });
    expect(decidirDesactivacion(inactiva, [a, b])).toEqual({ ok: true, valor: "YA_INACTIVA" });
    expect(decidirDesactivacion(inactiva, [])).toEqual({ ok: true, valor: "YA_INACTIVA" });
  });

  it("con otra activa se puede desactivar", () => {
    expect(decidirDesactivacion(a, [a, b])).toEqual({ ok: true, valor: "DESACTIVAR" });
    expect(decidirDesactivacion(b, [a, b])).toEqual({ ok: true, valor: "DESACTIVAR" });
  });

  it("la última activa no se puede desactivar: la objetivo no cuenta como otra activa", () => {
    expect(decidirDesactivacion(a, [a])).toEqual({ ok: false, error: "ULTIMA_SUCURSAL_ACTIVA" });
    expect(decidirDesactivacion(a, [])).toEqual({ ok: false, error: "ULTIMA_SUCURSAL_ACTIVA" });
  });

  it("solo cuentan las activas de la lista, aunque venga una inactiva", () => {
    const inactiva = sucursal("c", { activa: false });
    expect(decidirDesactivacion(a, [a, inactiva])).toEqual({
      ok: false,
      error: "ULTIMA_SUCURSAL_ACTIVA",
    });
  });

  it("propiedad: nunca se decide desactivar si no queda otra sucursal activa", () => {
    const lista = fc.array(
      fc.record({ id: fc.integer({ min: 0, max: 5 }), activa: fc.boolean() }),
      { maxLength: 8 },
    );
    fc.assert(
      fc.property(
        fc.record({ id: fc.integer({ min: 0, max: 5 }), activa: fc.boolean() }),
        lista,
        (objetivo, otras) => {
          const s = sucursal(`s${objetivo.id}`, { activa: objetivo.activa });
          const activas = otras
            .filter((o) => o.activa)
            .map((o) => sucursal(`s${o.id}`, { activa: true }));
          const r = decidirDesactivacion(s, [...activas, ...(s.activa ? [s] : [])]);
          const hayOtraActiva = activas.some((x) => x.id !== s.id);
          if (!s.activa) expect(r).toEqual({ ok: true, valor: "YA_INACTIVA" });
          else if (hayOtraActiva) expect(r).toEqual({ ok: true, valor: "DESACTIVAR" });
          else expect(r).toEqual({ ok: false, error: "ULTIMA_SUCURSAL_ACTIVA" });
        },
      ),
    );
  });
});

describe("decidirReactivacion", () => {
  it("una sucursal que no existe es SUCURSAL_NO_ENCONTRADA", () => {
    expect(decidirReactivacion(null)).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
  });

  it("una ya activa es idempotente", () => {
    expect(decidirReactivacion(sucursal("a"))).toEqual({ ok: true, valor: "YA_ACTIVA" });
  });

  it("una inactiva se reactiva", () => {
    expect(decidirReactivacion(sucursal("a", { activa: false }))).toEqual({
      ok: true,
      valor: "REACTIVAR",
    });
  });
});

describe("decidirAltaConNombreOcupado", () => {
  it("si la que tiene ese nombre está activa, el alta ya estaba hecha", () => {
    expect(decidirAltaConNombreOcupado(sucursal("a"))).toEqual({ ok: true, valor: "YA_EXISTIA" });
  });

  it("si está desactivada, hay que reactivarla: no se crea otra", () => {
    expect(decidirAltaConNombreOcupado(sucursal("a", { activa: false }))).toEqual({
      ok: false,
      error: "SUCURSAL_INACTIVA_CON_ESE_NOMBRE",
    });
  });
});

describe("decidirEdicion", () => {
  const s = sucursal("a", { nombre: "Casa central", version: 3 });

  it("una sucursal que no existe es SUCURSAL_NO_ENCONTRADA", () => {
    expect(decidirEdicion(null, 1, "Otra")).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ENCONTRADA",
    });
  });

  it("con la versión vigente y otro nombre se renombra", () => {
    expect(decidirEdicion(s, 3, "Casa matriz")).toEqual({ ok: true, valor: "RENOMBRAR" });
  });

  it("con otra versión es VERSION_DESACTUALIZADA (más vieja o más nueva)", () => {
    expect(decidirEdicion(s, 2, "Casa matriz")).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirEdicion(s, 4, "Casa matriz")).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirEdicion(s, Number.NaN, "Casa matriz")).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
  });

  it("si ya tiene ese nombre no hay cambios, con cualquier versión (repetir es idempotente)", () => {
    expect(decidirEdicion(s, 3, "Casa central")).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
    expect(decidirEdicion(s, 1, "Casa central")).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
  });

  it("cambiar solo las mayúsculas es un cambio", () => {
    expect(decidirEdicion(s, 3, "casa central")).toEqual({ ok: true, valor: "RENOMBRAR" });
  });

  it("se puede editar una sucursal inactiva (conserva su nombre, pero se puede corregir)", () => {
    const inactiva = sucursal("a", { nombre: "Vieja", version: 2, activa: false });
    expect(decidirEdicion(inactiva, 2, "Nueva")).toEqual({ ok: true, valor: "RENOMBRAR" });
  });
});
