import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones de «Cierre del día» se ofrecen activos solo si el servidor deja hacer su acción hoy (`permisosDelActor`, el mismo cálculo que el guard): cada botón con SU acción, sin
 * permisos leídos todo apagado (ante la duda el sistema cierra). Es una ayuda: apagar no autoriza ni deniega, cada acción vuelve al guard dentro de su transacción.
 */
vi.mock("server-only", () => ({}));

const mundo = vi.hoisted((): { respuesta: unknown; falla: boolean } => ({
  respuesta: null,
  falla: false,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        mundo.falla
          ? Promise.reject(new Error("la base no responde"))
          : Promise.resolve(mundo.respuesta),
    }),
  },
}));

const RUTA = "../../apps/web/servidor/modulos";
const cargar = (
  ruta: string,
): Promise<{ accionesDelCierre: (contexto: unknown) => Promise<Record<string, boolean>> }> =>
  import(/* @vite-ignore */ ruta);

const permisos = (acciones: string[]) => {
  mundo.respuesta = ok({ acciones, modulos: { activos: ["cierre", "caja"], enSoloLectura: [] } });
};
const acciones = async () => (await cargar(RUTA)).accionesDelCierre({ empresaId: "empresa-1" });

let registro: MockInstance<typeof console.error>;
beforeEach(() => {
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mundo.falla = false;
});
afterEach(() => {
  registro.mockRestore();
});

describe("accionesDelCierre", () => {
  it("cada botón sale activo solo con SU acción", async () => {
    const porAccion: [string, string][] = [
      ["jornadas.iniciar_auditoria", "empezar"],
      ["jornadas.cancelar_auditoria", "cancelar"],
      ["jornadas.cerrar", "cerrar"],
      ["cobros.corregir_medio", "corregirMedio"],
      ["declaraciones_de_total.registrar", "declarar"],
    ];
    for (const [accion, boton] of porAccion) {
      permisos([accion, "jornadas.ver"]);
      const r = await acciones();
      expect(
        Object.entries(r).filter(([, activo]) => activo),
        accion,
      ).toEqual([[boton, true]]);
    }
  });

  it("con todas las acciones, todo activo; con ninguna, todo apagado", async () => {
    permisos([
      "jornadas.iniciar_auditoria",
      "jornadas.cancelar_auditoria",
      "jornadas.cerrar",
      "cobros.corregir_medio",
      "declaraciones_de_total.registrar",
    ]);
    expect(await acciones()).toEqual({
      empezar: true,
      cancelar: true,
      cerrar: true,
      corregirMedio: true,
      declarar: true,
    });
    permisos(["jornadas.ver"]);
    expect(await acciones()).toEqual({
      empezar: false,
      cancelar: false,
      cerrar: false,
      corregirMedio: false,
      declarar: false,
    });
  });

  it("si no se pudieron leer los permisos (un rechazo o una excepción), todo apagado", async () => {
    const apagado = {
      empezar: false,
      cancelar: false,
      cerrar: false,
      corregirMedio: false,
      declarar: false,
    };
    mundo.respuesta = err({ codigo: "SIN_PERMISO" });
    expect(await acciones()).toEqual(apagado);
    mundo.falla = true;
    expect(await acciones()).toEqual(apagado);
  });
});
