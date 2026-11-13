import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/precios-de-producto.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del formulario solo se toma el precio; el producto, la clave del
 * cambio y la fila vista vienen ligados por la página. La composición es la real (`src/composicion/precios-de-producto-web.ts`); las consultas y el caso de uso son falsos (con la base
 * real se prueban en `test/integracion/precios-de-producto-web.test.ts`). Previene: cambiar el precio de un producto de otra empresa o de una sucursal porque lo dijo el navegador,
 * un doble clic que escribe dos veces, y un reintento tras «otra persona cambió el precio» que vuelve a fallar por llevar la fila vieja.
 */
vi.mock("server-only", () => ({}));
const REDIRIGIO = "NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`${REDIRIGIO} ${destino}`);
  },
}));
const revalidadas: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => {
    revalidadas.push(ruta);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const VISTO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const PRODUCTO = {
  id: ID,
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  version: 4,
};
const VIGENTE = {
  id: VISTO,
  opcionId: null,
  sucursalId: null,
  precio: "13000.000000",
  vigenteDesde: new Date("2026-11-02T12:00:00Z"),
};
const mundo = vi.hoisted(
  (): { contextos: unknown[]; cambios: unknown[]; resultado: unknown; producto: unknown } => ({
    contextos: [],
    cambios: [],
    resultado: null,
    producto: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      cambiarPrecio: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.cambios.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      verProducto: () =>
        Promise.resolve(
          ok(
            mundo.producto === null
              ? null
              : { producto: mundo.producto, grupos: [], preciosVigentes: [VIGENTE], historial: [] },
          ),
        ),
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));

import { cambiarElPrecio, cargarLosPrecios } from "../../apps/web/servidor/precios-de-producto";

const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    cambios: [],
    resultado: ok({ precioId: CLAVE, vigenteDesde: new Date(), yaExistia: false }),
    producto: PRODUCTO,
  });
  revalidadas.length = 0;
});

describe("la lectura de los precios", () => {
  it("pide los precios con el contexto que ya resolvió la página, y trae una clave nueva de cambio cada vez", async () => {
    const a = await cargarLosPrecios(CONTEXTO as never, ID);
    const b = await cargarLosPrecios(CONTEXTO as never, ID);
    expect(a.ok && a.dato.vigente?.precioId).toBe(VISTO);
    expect(a.ok && b.ok && a.dato.claveDelCambio).not.toBe(b.ok && b.dato.claveDelCambio);
    expect(a.ok && a.dato.claveDelCambio).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("cambiarElPrecio", () => {
  it("si sale bien, vuelve a los precios del producto tras escribir una vez con el contexto del servidor", async () => {
    await expect(
      cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "14000.00" })),
    ).rejects.toThrow(`${REDIRIGIO} /catalogo/productos/${ID}/precios`);
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.cambios).toEqual([
      {
        precioId: CLAVE,
        productoId: ID,
        opcionId: null,
        sucursalId: null,
        precioIdEsperado: VISTO,
        precio: "14000.00",
      },
    ]);
    expect(revalidadas).toEqual([]);
  });

  it("del formulario solo se toma el precio: la empresa, la sucursal, la opción, la clave y la fila vista que mande el navegador no pasan", async () => {
    await expect(
      cambiarElPrecio(
        ID,
        CLAVE,
        VISTO,
        formulario({
          precio: "14000.00",
          empresaId: "otra",
          sucursalId: "x",
          opcionId: "y",
          precioId: "z",
          precioIdEsperado: "w",
          productoId: "otro",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.cambios[0]).toMatchObject({
      productoId: ID,
      precioId: CLAVE,
      precioIdEsperado: VISTO,
      sucursalId: null,
      opcionId: null,
    });
  });

  it("un producto sin precio previo manda precioIdEsperado nulo", async () => {
    await expect(cambiarElPrecio(ID, CLAVE, null, formulario({ precio: "1.00" }))).rejects.toThrow(
      REDIRIGIO,
    );
    expect(mundo.cambios[0]).toMatchObject({ precioIdEsperado: null });
  });

  it("un precio que no es texto (un archivo) o que falta es vacío: «Escribí un precio válido», sin salir del formulario", async () => {
    mundo.resultado = err("PRECIO_INVALIDO");
    for (const datos of [formulario({}), formulario({ precio: new File(["1"], "precio.txt") })]) {
      const r = await cambiarElPrecio(ID, CLAVE, VISTO, datos);
      expect(r.error).toMatchObject({ codigo: "CATALOGO_PRECIO_INVALIDO", campo: "precio" });
    }
    expect(mundo.cambios.map((c) => (c as { precio: string }).precio)).toEqual(["", ""]);
  });

  it("el mismo precio que ya rige no escribe y vuelve a la pantalla", async () => {
    await expect(
      cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "13000" })),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.cambios).toEqual([]);
  });

  it("si otra persona cambió el precio: devuelve la frase con el importe vigente, sin redirigir, y pide la página de nuevo para que el reintento lleve la fila nueva", async () => {
    mundo.resultado = err({
      error: "PRECIO_DESACTUALIZADO",
      vigente: { precioId: "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", precio: "15000.000000" },
    });
    const r = await cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "14000.00" }));
    expect(r).toEqual({
      error: {
        codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
        clave: "catalogo.precio.vigente_ahora",
        presentacion: "AVISO",
        campo: "precio",
        parametros: { importe: "15000.000000" },
      },
    });
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/precios`]);
  });

  it("los demás errores no piden la página de nuevo", async () => {
    mundo.resultado = err("ID_REUTILIZADO");
    const r = await cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "14000.00" }));
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(revalidadas).toEqual([]);
  });

  it("sin permiso (el guard del caso de uso) sale su motivo, sin redirigir", async () => {
    mundo.resultado = err("SIN_PERMISO");
    const r = await cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "14000.00" }));
    expect(r.error?.codigo).toBe("SIN_PERMISO");
  });

  it("repetir el mismo cambio (doble toque) manda dos pedidos idénticos, con la misma clave: el caso de uso decide y ambos terminan igual", async () => {
    await expect(
      cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "14000.00" })),
    ).rejects.toThrow(REDIRIGIO);
    await expect(
      cambiarElPrecio(ID, CLAVE, VISTO, formulario({ precio: "14000.00" })),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.cambios).toHaveLength(2);
    expect(mundo.cambios[0]).toEqual(mundo.cambios[1]);
  });
});
