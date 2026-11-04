import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { estadoDeModulos } from "../../src/capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../src/capacidades/permisos/empresa";
import { accionesPermitidas, exigirAccion } from "../../src/capacidades/permisos/exigir";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../src/capacidades/permisos/roles";
import { DECLARACIONES_DE_FACTURACION } from "../../src/modulos/fiscal/publico";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * La barra de módulos (D-13): «Comprobantes» se muestra solo si la persona tiene hoy `comprobantes.ver` Y el módulo de facturación
 * está activo o en solo lectura (`permisosDelActor`, calculado por el servidor). Previene: ofrecer un destino que el servidor va a
 * rechazar, y abrir uno cuando no se pudo saber (ante el error, cierra). Ocultar no autoriza: la consulta del listado vuelve al guard.
 */
vi.mock("server-only", () => ({}));

const mundo = vi.hoisted((): { respuesta: unknown; falla: unknown; contextos: unknown[] } => ({
  respuesta: null,
  falla: false,
  contextos: [],
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: (contexto: unknown) => {
        mundo.contextos.push(contexto);
        if (mundo.falla !== false) {
          // Un «thenable» y no `Promise.reject`: la prueba tiene que poder fallar con algo que no es un Error.
          const razon = mundo.falla === true ? new Error("la base no responde") : mundo.falla;
          return { then: (_resolver: unknown, rechazar: (r: unknown) => void) => rechazar(razon) };
        }
        return Promise.resolve(mundo.respuesta);
      },
    }),
  },
}));

const RUTA = "../../apps/web/servidor/modulos";
// Ruta en una variable: el tipado de la raíz no arrastra los archivos del navegador que importa la barra.
const cargar = (
  ruta: string,
): Promise<{
  destinosDeModulos: (contexto: unknown) => Promise<readonly { clave: string }[]>;
  puedeEmitirNotasDeCredito: (contexto: unknown) => Promise<boolean>;
  puedeEmitirFacturas: (contexto: unknown) => Promise<boolean>;
}> => import(/* @vite-ignore */ ruta);

const claves = async (): Promise<string[]> => {
  const { destinosDeModulos } = await cargar(RUTA);
  return (await destinosDeModulos({ empresaId: "empresa-1" })).map((d) => d.clave);
};
const permisos = (p: { acciones?: string[]; activos?: string[]; enSoloLectura?: string[] }) => {
  mundo.respuesta = ok({
    acciones: p.acciones ?? ["comprobantes.ver"],
    modulos: { activos: p.activos ?? [], enSoloLectura: p.enSoloLectura ?? [] },
  });
};

// El registro del servidor (`console.error`) se captura en todas las pruebas: las que provocan una falla lo leen, las demás no ensucian la salida.
let registro: MockInstance<typeof console.error>;
const lineasDelRegistro = (): string[] => registro.mock.calls.map((l) => l.map(String).join(" "));

beforeEach(() => {
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mundo.falla = false;
  mundo.contextos = [];
  permisos({ activos: ["facturacion"] });
});

afterEach(() => {
  registro.mockRestore();
});

describe("destinosDeModulos", () => {
  it("con comprobantes.ver y el módulo de facturación activo: «Comprobantes»; la consulta usa el contexto de la empresa", async () => {
    expect(await claves()).toEqual(["comprobantes"]);
    expect(mundo.contextos).toEqual([{ empresaId: "empresa-1" }]);
  });

  it("SUPUESTO: con el módulo en solo lectura también aparece (el Listado solo consulta)", async () => {
    permisos({ enSoloLectura: ["facturacion"] });
    expect(await claves()).toEqual(["comprobantes"]);
  });

  it("sin comprobantes.ver no aparece, aunque el módulo esté activo", async () => {
    permisos({ acciones: ["comprobantes.emitir_manual"], activos: ["facturacion"] });
    expect(await claves()).toEqual([]);
  });

  it("sin el módulo de facturación (ni activo ni en solo lectura) no aparece, aunque figure la acción", async () => {
    permisos({ activos: ["administracion"] });
    expect(await claves()).toEqual([]);
  });

  it("si no se pudieron leer los permisos (rechazo): no aparece", async () => {
    mundo.respuesta = err({ codigo: "SIN_PERMISO" });
    expect(await claves()).toEqual([]);
  });

  it("si la consulta falla con una excepción: no aparece y no rompe", async () => {
    mundo.falla = true;
    expect(await claves()).toEqual([]);
  });
});

/**
 * Anular con nota de crédito: se ofrece (botón del detalle y pantalla) con solo que `permisosDelActor().acciones` incluya
 * `notas_de_credito.emitir`, también con el módulo en solo lectura (la acción es COMPLETA_CIERRA y el guard la deja pasar; corrección
 * del dueño, 2026-10-29, cuestionario en la sesión web del carril web). Ante un error, no se ofrece. Ocultar no autoriza: la acción
 * de emitir vuelve a pasar por el guard.
 */
describe("puedeEmitirNotasDeCredito", () => {
  const puede = async (): Promise<boolean> => {
    const { puedeEmitirNotasDeCredito } = await cargar(RUTA);
    return puedeEmitirNotasDeCredito({ empresaId: "empresa-1" });
  };
  const EMITE = "notas_de_credito.emitir";

  it("con la acción: sí; la consulta usa el contexto de la empresa", async () => {
    permisos({ acciones: ["comprobantes.ver", EMITE], activos: ["facturacion"] });
    expect(await puede()).toBe(true);
    expect(mundo.contextos).toEqual([{ empresaId: "empresa-1" }]);
  });

  it("sin la acción: no, aunque pueda emitir facturas", async () => {
    permisos({
      acciones: ["comprobantes.ver", "comprobantes.emitir_manual"],
      activos: ["facturacion"],
    });
    expect(await puede()).toBe(false);
  });

  it("con el módulo en solo lectura y la acción: sí (el servidor la permite)", async () => {
    permisos({ acciones: [EMITE], activos: [], enSoloLectura: ["facturacion"] });
    expect(await puede()).toBe(true);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no, cierra", async () => {
    mundo.respuesta = err({ codigo: "SIN_PERMISO" });
    expect(await puede()).toBe(false);
    mundo.falla = true;
    expect(await puede()).toBe(false);
  });
});

/**
 * El botón de emitir una factura: se ofrece si y solo si el guard dejaría emitir (`comprobantes.emitir_manual`, la acción de
 * `emitirComprobanteManual`). Previene: ofrecer a quien el servidor va a rechazar, o esconder el botón a quien puede, si la regla
 * del botón se escribiera aparte de la del guard. Ocultar no autoriza: emitir vuelve a pasar por el guard.
 */
describe("puedeEmitirFacturas", () => {
  const puede = async (): Promise<boolean> => {
    const { puedeEmitirFacturas } = await cargar(RUTA);
    return puedeEmitirFacturas({ empresaId: "empresa-1" });
  };
  const EMITE = "comprobantes.emitir_manual";

  it("pregunta por la acción que exige el caso de uso de emitir una factura", () => {
    expect(DECLARACIONES_DE_FACTURACION.emitirComprobanteManual.accion).toBe(EMITE);
  });

  it("con la acción: sí; la consulta usa el contexto de la empresa", async () => {
    permisos({ acciones: ["comprobantes.ver", EMITE], activos: ["facturacion"] });
    expect(await puede()).toBe(true);
    expect(mundo.contextos).toEqual([{ empresaId: "empresa-1" }]);
  });

  it("sin la acción: no, aunque pueda emitir notas de crédito y ver comprobantes", async () => {
    permisos({
      acciones: ["comprobantes.ver", "notas_de_credito.emitir"],
      activos: ["facturacion"],
    });
    expect(await puede()).toBe(false);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no, cierra", async () => {
    mundo.respuesta = err({ codigo: "SIN_PERMISO" });
    expect(await puede()).toBe(false);
    mundo.falla = true;
    expect(await puede()).toBe(false);
  });

  describe("coincide con el guard, con los permisos que calcula el servidor de verdad", () => {
    // El catálogo real ya trae la facturación disponible (dueño, 2026-11-04). Esta variante la fuerza «en desarrollo» para
    // seguir probando que un módulo sin construir no ofrece nada aunque esté activo y en el plan (nace cerrado).
    const EN_DESARROLLO: ReglasDeEmpresa = {
      catalogo: {
        ...CATALOGO_DE_MODULOS,
        facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "en_desarrollo" },
      },
      permisos: PERMISOS_DE_EMPRESA,
    };
    const ESTADOS = {
      "módulo activo": { activados: ["facturacion"], habilitados: ["facturacion"] },
      "módulo en solo lectura (baja de plan)": { activados: ["facturacion"], habilitados: [] },
      "módulo sin activar": { activados: [], habilitados: ["facturacion"] },
    };
    type Caso = {
      nombre: string;
      reglas: ReglasDeEmpresa;
      actor: { rol: RolDeEmpresa | null; activados: string[]; habilitados: string[] };
    };
    const casos: Caso[] = [
      ...ROLES_DE_EMPRESA.flatMap((rol) =>
        Object.entries(ESTADOS).map(([estado, m]) => ({
          nombre: `${rol}, ${estado}`,
          reglas: REGLAS_DE_EMPRESA,
          actor: { rol, ...m },
        })),
      ),
      {
        nombre: "sin membresía",
        reglas: REGLAS_DE_EMPRESA,
        actor: { rol: null, ...ESTADOS["módulo activo"] },
      },
      ...ROLES_DE_EMPRESA.map((rol) => ({
        nombre: `${rol}, facturación en desarrollo`,
        reglas: EN_DESARROLLO,
        actor: { rol, ...ESTADOS["módulo activo"] },
      })),
    ];

    it.each(casos)("$nombre", async ({ reglas, actor }) => {
      const cargado = {
        rol: actor.rol,
        modulosActivados: actor.activados,
        modulosHabilitados: actor.habilitados,
      };
      const modulos = estadoDeModulos(reglas.catalogo, actor.activados, actor.habilitados);
      mundo.respuesta = ok({
        acciones: accionesPermitidas(reglas, cargado),
        modulos: {
          activos: [...modulos.modulosActivos].sort(),
          enSoloLectura: [...modulos.modulosEnSoloLectura].sort(),
        },
      });
      const guard = await exigirAccion(reglas, EMITE, () => Promise.resolve(cargado));
      expect(await puede()).toBe(guard.ok);
    });

    it("el efecto de la acción es el que hace que en solo lectura el botón no se ofrezca", () => {
      expect(CATALOGO_DE_MODULOS.facturacion.acciones[EMITE].efecto).toBe("CREA_AMPLIA");
    });
  });
});

/**
 * El rastro de `permisosDeLaPersona` (el dueño pide no tragar errores): una excepción queda en el registro del servidor con el
 * formato de los demás (`[etiqueta] qué falló (Tipo)`), SOLO el tipo de la falla y nunca su texto (puede traer datos de la base),
 * y la barra y el botón de anular siguen cerrados.
 */
describe("el rastro cuando no se pueden leer los permisos", () => {
  const SECRETO = "password authentication failed for user admin at db.interno:5432";

  it("una excepción: queda un renglón con el tipo de la falla, sin su texto, y la barra queda vacía", async () => {
    mundo.falla = true;
    expect(await claves()).toEqual([]);
    const lineas = lineasDelRegistro();
    expect(lineas).toEqual(["[modulos] no se pudieron leer los permisos de la persona (Error)"]);
    expect(lineas.join(" ")).not.toContain("la base no responde");
  });

  it("el nombre del tipo es el de la falla, y el texto de la base no se registra jamás", async () => {
    class ErrorDeLaBase extends Error {
      override name = "ErrorDeLaBase";
    }
    mundo.falla = new ErrorDeLaBase(SECRETO);
    const { puedeEmitirNotasDeCredito } = await cargar(RUTA);
    expect(await puedeEmitirNotasDeCredito({ empresaId: "empresa-1" })).toBe(false);
    const lineas = lineasDelRegistro();
    expect(lineas).toEqual([
      "[modulos] no se pudieron leer los permisos de la persona (ErrorDeLaBase)",
    ]);
    expect(lineas.join(" ")).not.toMatch(/password|admin|5432/);
  });

  it("si lo que se lanza no es un Error, se dice sin inventar un nombre", async () => {
    mundo.falla = SECRETO;
    expect(await claves()).toEqual([]);
    const lineas = lineasDelRegistro();
    expect(lineas).toEqual([
      "[modulos] no se pudieron leer los permisos de la persona (falla que no es un Error)",
    ]);
  });

  it("sin falla no se registra nada", async () => {
    expect(await claves()).toEqual(["comprobantes"]);
    const lineas = lineasDelRegistro();
    expect(lineas).toEqual([]);
  });
});
