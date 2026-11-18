import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones del salón y de las comandas: cada uno sale activo solo si `permisosDelActor` (el mismo cálculo que el guard) incluye SU acción y el módulo está disponible y activo. Previene: ofrecer el botón a quien
 * el servidor va a rechazar (un operador que administra impresoras), con el módulo apagado o si no se pudieron leer los permisos («todo nace cerrado»). Es solo una ayuda: la acción vuelve a pasar por el guard.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted((): { permisos: unknown; fallan: boolean } => ({
  permisos: null,
  fallan: false,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        mundo.fallan
          ? Promise.reject(new Error("la base no responde"))
          : Promise.resolve(mundo.permisos),
    }),
  },
}));
const RUTA = "../../apps/web/servidor/modulos";
type Puede = (contexto: never) => Promise<boolean>;
const cargar = async () =>
  (await import(/* @vite-ignore */ RUTA)) as unknown as {
    puedeCambiarDeMesa: Puede;
    puedeUnirMesas: Puede;
    puedeDividirCuentas: Puede;
    puedeEnviarAComandas: Puede;
    puedeImprimir: Puede;
    puedeReimprimir: Puede;
    puedeAdministrarImpresoras: Puede;
  };
const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["salon", "comandas"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};
beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

/** Una función por grupo, con la acción que la habilita. */
const GRUPOS = [
  ["puedeCambiarDeMesa", "salon.cambiar_mesa"],
  ["puedeUnirMesas", "salon.unir"],
  ["puedeDividirCuentas", "salon.dividir"],
  ["puedeEnviarAComandas", "comandas.enviar"],
  ["puedeImprimir", "impresiones.imprimir"],
  ["puedeReimprimir", "impresiones.reimprimir"],
  ["puedeAdministrarImpresoras", "impresoras.editar"],
] as const;

describe.each(GRUPOS)("%s", (nombre, accion) => {
  it(`con ${accion} y el módulo activo: sí`, async () => {
    conPermisos([accion]);
    expect(await (await cargar())[nombre](contexto())).toBe(true);
  });
  it("con otras acciones del salón pero no esa: no", async () => {
    conPermisos(GRUPOS.map(([, a]) => a).filter((a) => a !== accion));
    expect(await (await cargar())[nombre](contexto())).toBe(false);
  });
  it("con el módulo apagado (la acción no figura entre las del actor): no", async () => {
    conPermisos([], []);
    expect(await (await cargar())[nombre](contexto())).toBe(false);
  });
  it("sin permisos leídos (error o falla): no", async () => {
    mundo.permisos = err("SIN_PERMISO");
    expect(await (await cargar())[nombre](contexto())).toBe(false);
    mundo.fallan = true;
    expect(await (await cargar())[nombre](contexto())).toBe(false);
  });
});

describe("el reparto de los roles", () => {
  it("quien solo puede enviar e imprimir (un operador) no administra las impresoras ni se le abre otro botón", async () => {
    conPermisos([
      "comandas.enviar",
      "impresiones.imprimir",
      "impresiones.reimprimir",
      "salon.unir",
    ]);
    const p = await cargar();
    expect(await p.puedeEnviarAComandas(contexto())).toBe(true);
    expect(await p.puedeImprimir(contexto())).toBe(true);
    expect(await p.puedeReimprimir(contexto())).toBe(true);
    expect(await p.puedeUnirMesas(contexto())).toBe(true);
    expect(await p.puedeAdministrarImpresoras(contexto())).toBe(false);
    expect(await p.puedeDividirCuentas(contexto())).toBe(false);
    expect(await p.puedeCambiarDeMesa(contexto())).toBe(false);
  });
});
