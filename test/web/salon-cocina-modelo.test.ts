import { describe, expect, it } from "vitest";
import {
  RUTA_DE_LA_COCINA,
  armarLaCocina,
  type EnvioDeLaCocinaDeLaPantalla,
} from "../../apps/web/ui/plantillas/salon/modelo-de-la-cocina";

/** El modelo de la pantalla de la cocina (SAL-H): lo que se ve y nada más, con los textos aprobados y sin ningún texto nuevo salvo el título. */
const envio = (
  cambios: Partial<EnvioDeLaCocinaDeLaPantalla> = {},
): EnvioDeLaCocinaDeLaPantalla => ({
  trabajoId: "11111111-1111-4111-8111-111111111111",
  envioId: "22222222-2222-4222-8222-222222222222",
  rotulo: "Mesa 5",
  numero: 2,
  hora: "21:14",
  estado: "PENDIENTE",
  intentos: 1,
  sinImpresora: false,
  ...cambios,
});

describe("el modelo de la pantalla de la cocina", () => {
  it("la ruta es /salon/comandas y el título es «Comandas»", () => {
    expect(RUTA_DE_LA_COCINA).toBe("/salon/comandas");
    expect(armarLaCocina({}, []).titulo).toBe("Comandas");
  });

  it("cada fila dice mesa, «Envío N» y la hora, con su trabajo y su estado; el orden es el del servidor", () => {
    const cocina = armarLaCocina({}, [
      envio(),
      envio({
        envioId: "33333333-3333-4333-8333-333333333333",
        trabajoId: "44444444-4444-4444-8444-444444444444",
        rotulo: "Mesa 3",
        numero: 1,
        hora: "21:09",
        estado: "FALLIDA",
        intentos: 3,
        sinImpresora: true,
      }),
    ]);
    expect(cocina.filas).toEqual([
      {
        envioId: "22222222-2222-4222-8222-222222222222",
        trabajoId: "11111111-1111-4111-8111-111111111111",
        titulo: "Mesa 5",
        detalle: "Envío 2 · 21:14",
        estado: "PENDIENTE",
        intentos: 1,
        sinImpresora: false,
      },
      {
        envioId: "33333333-3333-4333-8333-333333333333",
        trabajoId: "44444444-4444-4444-8444-444444444444",
        titulo: "Mesa 3",
        detalle: "Envío 1 · 21:09",
        estado: "FALLIDA",
        intentos: 3,
        sinImpresora: true,
      },
    ]);
  });

  it("un estado que la pantalla no conoce (por ejemplo IMPRESA) no se muestra; sin nada pendiente la lista queda vacía, sin leyenda", () => {
    expect(
      armarLaCocina({}, [envio({ estado: "IMPRESA" }), envio({ estado: "OTRO" })]).filas,
    ).toEqual([]);
    expect(armarLaCocina({}, []).filas).toEqual([]);
  });

  it("«Envío N» respeta el texto aprobado aunque una marca lo redacte sin la N (el número va al final)", () => {
    const d = { "comandas.texto.envio_envio_n": "Pedido" };
    expect(armarLaCocina(d, [envio()]).filas[0]?.detalle).toBe("Pedido 2 · 21:14");
  });
});
