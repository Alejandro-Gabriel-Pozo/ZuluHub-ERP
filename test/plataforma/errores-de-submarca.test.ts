import { describe, expect, it } from "vitest";
import { errorParaLaPantalla } from "../../apps/plataforma/logica/errores-de-plataforma";

/** Los códigos que en la pantalla de submarca significan otra cosa que en el alta. */
describe("errorParaLaPantalla en el contexto de submarca", () => {
  it("CAMBIO_PROGRAMADO_PENDIENTE tiene salida: pantalla vieja (el botón «Recargar»)", () => {
    const e = errorParaLaPantalla("CAMBIO_PROGRAMADO_PENDIENTE", "SUBMARCA");
    expect(e.tipo).toBe("PANTALLA_VIEJA");
    if (e.tipo !== "PANTALLA_VIEJA") return;
    expect(e.texto).toContain("Recargala");
    expect(e.texto).toContain("cambio programado");
  });

  it("sin contexto, CAMBIO_PROGRAMADO_PENDIENTE sigue siendo el texto general", () => {
    expect(errorParaLaPantalla("CAMBIO_PROGRAMADO_PENDIENTE").tipo).toBe("GENERAL");
  });

  it("MARCA_RETIRADA es su propio tipo, con un texto claro y sin decir que la pantalla quedó vieja", () => {
    const e = errorParaLaPantalla("MARCA_RETIRADA", "SUBMARCA");
    expect(e.tipo).toBe("MARCA_RETIRADA");
    if (e.tipo !== "MARCA_RETIRADA") return;
    expect(e.texto).toContain("retirada");
    expect(e.texto).not.toMatch(/vieja/i);
  });

  it("sin contexto, MARCA_RETIRADA sigue siendo un error del campo submarca del alta", () => {
    expect(errorParaLaPantalla("MARCA_RETIRADA").tipo).toBe("CAMPO");
  });
});
