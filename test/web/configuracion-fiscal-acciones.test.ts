import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Qué botones de Puntos de venta se ofrecen activos (I1 del PR #122): lo decide `permisosDelActor` (el servidor), no la pantalla.
 * `puntos_de_venta.cambiar_ambiente` es del módulo `facturacion`, en desarrollo: el guard la rechaza siempre y `permisosDelActor`
 * no la entrega, así que «Pasar a producción» sale apagado con «Esta función todavía está en desarrollo.». Las otras cuatro son de
 * `administracion`. Previene: que el gerente abra la ventana, confirme y recién ahí reciba el rechazo. Ocultar no autoriza: el guard
 * vuelve a decidir al enviar. Los motivos son SOLO textos que ya existen en el catálogo (`motivo.*`).
 */
vi.mock("server-only", () => ({}));

const mundo = vi.hoisted((): { respuesta: unknown; falla: boolean; contextos: unknown[] } => ({
  respuesta: null,
  falla: false,
  contextos: [],
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: (contexto: unknown) => {
        mundo.contextos.push(contexto);
        if (mundo.falla) return Promise.reject(new Error("la base no responde"));
        return Promise.resolve(mundo.respuesta);
      },
    }),
  },
}));

type Oferta = { permitida: boolean; motivo: string | null };
type Acciones = Record<
  "agregar" | "editar" | "activar" | "desactivar" | "pasarAProduccion",
  Oferta
>;
const RUTA = "../../apps/web/servidor/modulos";
// Ruta en una variable: el tipado de la raíz no arrastra los archivos del navegador que importa la barra.
const cargar = (
  ruta: string,
): Promise<{ accionesDePuntosDeVenta: (contexto: unknown) => Promise<Acciones> }> =>
  import(/* @vite-ignore */ ruta);
const acciones = async (): Promise<Acciones> =>
  (await cargar(RUTA)).accionesDePuntosDeVenta({ empresaId: "empresa-1" });

const DE_ADMINISTRACION = [
  "puntos_de_venta.crear",
  "puntos_de_venta.editar",
  "puntos_de_venta.activar",
  "puntos_de_venta.desactivar",
];
const permisos = (p: { acciones?: string[]; activos?: string[]; enSoloLectura?: string[] }) => {
  mundo.respuesta = ok({
    acciones: p.acciones ?? DE_ADMINISTRACION,
    modulos: { activos: p.activos ?? ["administracion"], enSoloLectura: p.enSoloLectura ?? [] },
  });
};
const PERMITIDA: Oferta = { permitida: true, motivo: null };
const apagada = (motivo: string): Oferta => ({ permitida: false, motivo });

const EN_DESARROLLO = "Esta función todavía está en desarrollo.";
const SIN_PERMISO = "No tiene permiso para hacer esto.";

let registro: MockInstance<typeof console.error>;
beforeEach(() => {
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mundo.falla = false;
  mundo.contextos = [];
  permisos({});
});
afterEach(() => {
  registro.mockRestore();
});

describe("las acciones de Puntos de venta según el servidor", () => {
  it("el gerente de hoy: agregar, editar, activar y desactivar activos; pasar a producción apagado por el módulo en desarrollo", async () => {
    expect(await acciones()).toEqual({
      agregar: PERMITIDA,
      editar: PERMITIDA,
      activar: PERMITIDA,
      desactivar: PERMITIDA,
      pasarAProduccion: apagada(EN_DESARROLLO),
    });
  });

  it("lee los permisos UNA vez por pedido, con el contexto de la empresa", async () => {
    await acciones();
    expect(mundo.contextos).toEqual([{ empresaId: "empresa-1" }]);
  });

  it("si el servidor entregara la acción de cambiar el ambiente, se ofrece activa (la pantalla no decide)", async () => {
    permisos({
      acciones: [...DE_ADMINISTRACION, "puntos_de_venta.cambiar_ambiente"],
      activos: ["administracion", "facturacion"],
    });
    expect((await acciones()).pasarAProduccion).toEqual(PERMITIDA);
  });

  it("una acción que el rol no tiene, con el módulo activo: «No tiene permiso para hacer esto.»", async () => {
    permisos({ acciones: ["puntos_de_venta.activar", "puntos_de_venta.desactivar"] });
    const a = await acciones();
    expect(a.agregar).toEqual(apagada(SIN_PERMISO));
    expect(a.editar).toEqual(apagada(SIN_PERMISO));
    expect(a.activar).toEqual(PERMITIDA);
    expect(a.desactivar).toEqual(PERMITIDA);
    // El módulo en desarrollo tiene precedencia sobre el rol, como en el guard.
    expect(a.pasarAProduccion).toEqual(apagada(EN_DESARROLLO));
  });

  it("módulo que la empresa no tiene activo: «Esta función no está activada para la empresa.»", async () => {
    permisos({ acciones: [], activos: [] });
    const a = await acciones();
    for (const clave of ["agregar", "editar", "activar", "desactivar"] as const) {
      expect(a[clave]).toEqual(apagada("Esta función no está activada para la empresa."));
    }
  });

  it("módulo en solo lectura: las que crean o amplían (alta, edición, activar) lo dicen; las que cierran, por el rol", async () => {
    permisos({ acciones: [], activos: [], enSoloLectura: ["administracion"] });
    const a = await acciones();
    const SOLO_LECTURA =
      "Esta función quedó en solo lectura porque el plan ya no la incluye. Todo lo cargado se conserva.";
    expect(a.agregar).toEqual(apagada(SOLO_LECTURA));
    expect(a.editar).toEqual(apagada(SOLO_LECTURA));
    expect(a.activar).toEqual(apagada(SOLO_LECTURA));
    // Desactivar es COMPLETA_CIERRA: en solo lectura el guard la deja pasar; si falta, es del rol.
    expect(a.desactivar).toEqual(apagada(SIN_PERMISO));
  });

  it("si no se pudieron leer los permisos (rechazo): todo sale apagado con el motivo de falta de permiso (falla cerrado)", async () => {
    mundo.respuesta = err("SIN_PERMISO");
    const a = await acciones();
    for (const oferta of Object.values(a)) expect(oferta).toEqual(apagada(SIN_PERMISO));
  });

  it("si la lectura lanza: todo sale apagado (falla cerrado) y el registro dice solo el TIPO de la falla", async () => {
    mundo.falla = true;
    const a = await acciones();
    for (const oferta of Object.values(a)) expect(oferta).toEqual(apagada(SIN_PERMISO));
    const lineas = registro.mock.calls.map((l) => l.map(String).join(" "));
    expect(lineas).toEqual(["[modulos] no se pudieron leer los permisos de la persona (Error)"]);
  });
});
