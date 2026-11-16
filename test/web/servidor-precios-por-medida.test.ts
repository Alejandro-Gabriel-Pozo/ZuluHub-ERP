import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/precios-por-medida.ts`: la empresa y la persona las fija el SERVIDOR; del formulario solo se toman los precios por posición, y la medida y la fila vista las liga la página.
 * La composición es la real; las consultas y el caso de uso son falsos (con la base real: `test/integracion/precios-por-medida-web.test.ts`). Previene: cambiar el precio de una medida de otro
 * producto porque lo dijo el navegador y un doble toque que escribe dos veces.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`);
  },
}));
const revalidadas: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (r: string) => revalidadas.push(r) }));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const CHICO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const GRANDE = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const VISTO = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const mundo = vi.hoisted((): { cambios: unknown[]; resultado: unknown } => ({
  cambios: [],
  resultado: null,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      cambiarPreciosPorMedida: (_c: unknown, entrada: unknown) => {
        mundo.cambios.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      verProducto: () =>
        Promise.resolve(
          ok({
            producto: { id: ID, nombre: "Latte", claseDeUso: "VENDIBLE" },
            grupos: [
              {
                id: "g",
                clase: "VARIANTE",
                activo: true,
                opciones: [
                  { id: CHICO, nombre: "Chico", orden: 1, activa: true },
                  { id: GRANDE, nombre: "Grande", orden: 2, activa: true },
                ],
              },
            ],
            preciosVigentes: [
              { id: VISTO, opcionId: CHICO, sucursalId: null, precio: "3200.000000" },
            ],
            historial: [],
          }),
        ),
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (c: unknown) => unknown) => hacer(CONTEXTO),
}));

import {
  cambiarLosPreciosDeLasMedidas,
  cargarLosPreciosPorMedida,
} from "../../apps/web/servidor/precios-por-medida";

const LIGADO = {
  productoId: ID,
  claveDelCambio: CLAVE,
  medidas: [
    { opcionId: CHICO, precioIdEsperado: VISTO },
    { opcionId: GRANDE, precioIdEsperado: null },
  ],
};
const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [k, v] of Object.entries(campos)) datos.set(k, v);
  return datos;
};

beforeEach(() => {
  mundo.cambios = [];
  mundo.resultado = ok({ precioId: CLAVE, vigenteDesde: new Date(), yaExistia: false });
  revalidadas.length = 0;
});

describe("la lectura", () => {
  it("trae las medidas con su vigente y una clave de cambio nueva cada vez", async () => {
    const a = await cargarLosPreciosPorMedida(CONTEXTO as never, ID);
    const b = await cargarLosPreciosPorMedida(CONTEXTO as never, ID);
    expect(a.ok && a.dato.medidas.map((m) => m.nombre)).toEqual(["Chico", "Grande"]);
    expect(a.ok && b.ok && a.dato.claveDelCambio).not.toBe(b.ok && b.dato.claveDelCambio);
  });
});

describe("cambiarLosPreciosDeLasMedidas", () => {
  it("cambia solo lo escrito, con la medida y la fila vista que ligó la página, y vuelve a la pantalla pidiéndola de nuevo", async () => {
    await expect(
      cambiarLosPreciosDeLasMedidas(LIGADO, formulario({ precio_0: "3500.00", precio_1: "" })),
    ).rejects.toThrow(`NEXT_REDIRECT /catalogo/productos/${ID}/precios/medidas`);
    expect(mundo.cambios).toHaveLength(1);
    expect(mundo.cambios[0]).toMatchObject({
      productoId: ID,
      cambios: [{ opcionId: CHICO, precioIdEsperado: VISTO, precio: "3500.00" }],
    });
    expect(JSON.stringify(mundo.cambios[0])).not.toContain("sucursalId");
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/precios/medidas`]);
  });

  it("del formulario no pasan la empresa, la sucursal, la medida ni la fila vista que mande el navegador", async () => {
    await expect(
      cambiarLosPreciosDeLasMedidas(
        LIGADO,
        formulario({
          precio_1: "10.00",
          empresaId: "otra",
          sucursalId: "x",
          opcionId: CHICO,
          precioIdEsperado: "w",
          precio_9: "5.00",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mundo.cambios).toHaveLength(1);
    expect(mundo.cambios[0]).toMatchObject({
      cambios: [{ opcionId: GRANDE, precioIdEsperado: null }],
    });
    expect(JSON.stringify(mundo.cambios[0])).not.toContain("sucursalId");
  });

  it("un precio que no es texto o que falta es vacío: esa medida no se toca", async () => {
    await expect(
      cambiarLosPreciosDeLasMedidas(LIGADO, formulario({ precio_0: new File(["1"], "p.txt") })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mundo.cambios).toEqual([]);
  });

  it("si el servidor rechaza, devuelve el error en el campo de la medida y pide la pantalla de nuevo", async () => {
    mundo.resultado = err("PRECIO_INVALIDO");
    const r = await cambiarLosPreciosDeLasMedidas(LIGADO, formulario({ precio_1: "abc" }));
    expect(r.error).toMatchObject({ codigo: "CATALOGO_PRECIO_INVALIDO", campo: "precio_1" });
    expect(revalidadas).toHaveLength(1);
  });

  it("sin permiso sale el motivo del guard; repetir manda pedidos idénticos con la misma clave", async () => {
    mundo.resultado = err("SIN_PERMISO");
    expect(
      (await cambiarLosPreciosDeLasMedidas(LIGADO, formulario({ precio_1: "1.00" }))).error?.codigo,
    ).toBe("SIN_PERMISO");
    mundo.resultado = ok({ precioId: CLAVE, vigenteDesde: null, yaExistia: true });
    for (let i = 0; i < 2; i += 1) {
      await expect(
        cambiarLosPreciosDeLasMedidas(LIGADO, formulario({ precio_1: "1.00" })),
      ).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(mundo.cambios[1]).toEqual(mundo.cambios[2]);
  });
});
