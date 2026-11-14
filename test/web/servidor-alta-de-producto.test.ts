import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/alta-de-producto.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del formulario solo se toman los campos que la acción declara; la clave de
 * creación viene ligada por la página. La composición es la real (`src/composicion/alta-de-producto-web.ts`); las consultas y el caso de uso son falsos (con la base real se prueban
 * en `test/integracion/alta-de-producto-web.test.ts`). Previene: crear un producto en otra empresa o con una descripción, una unidad de venta o un id que mandó el navegador, y que un
 * doble toque o un reintento (la misma clave) escriba dos productos distintos.
 */
vi.mock("server-only", () => ({}));
const REDIRIGIO = "NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`${REDIRIGIO} ${destino}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const CLAVE = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const NUEVO = "7d2e1f00-1111-4222-8333-944455556666";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const mundo = vi.hoisted(
  (): { contextos: unknown[]; altas: unknown[]; resultado: unknown; secciones: unknown } => ({
    contextos: [],
    altas: [],
    resultado: null,
    secciones: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      crearProducto: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.altas.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      listarSeccionesDeCarta: () => Promise.resolve(mundo.secciones),
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));

import {
  cargarLasOpcionesDelAlta,
  darDeAltaElProducto,
  nuevaClaveDeAlta,
} from "../../apps/web/servidor/alta-de-producto";

const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};
const COMPLETO = {
  claseDeUso: "VENDIBLE",
  unidadBaseId: "KILOGRAMO",
  nombre: "Milanesa",
  nombreDeCocina: "MILA",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "10.5",
  seccionDeCartaId: SECCION,
};

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    altas: [],
    resultado: ok({ productoId: NUEVO, yaExistia: false }),
    secciones: ok([{ id: SECCION, nombre: "Minutas", orden: 1, activa: true, version: 1 }]),
  });
});

describe("nuevaClaveDeAlta", () => {
  it("es un uuid, y cada apertura de la página trae otra", () => {
    const a = nuevaClaveDeAlta();
    const b = nuevaClaveDeAlta();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("la lectura de lo que se ofrece", () => {
  it("pide las secciones con el contexto que ya resolvió la página", async () => {
    const r = await cargarLasOpcionesDelAlta(CONTEXTO as never);
    expect(r.ok && r.dato.secciones).toEqual([{ id: SECCION, nombre: "Minutas" }]);
  });
});

describe("darDeAltaElProducto", () => {
  it("si sale bien, va a la ficha del producto nuevo tras escribir una vez con el contexto del servidor y la clave como id", async () => {
    await expect(darDeAltaElProducto(CLAVE, formulario(COMPLETO))).rejects.toThrow(
      `${REDIRIGIO} /catalogo/productos/${NUEVO}`,
    );
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.altas).toEqual([
      {
        id: CLAVE,
        claseDeUso: "VENDIBLE",
        unidadBaseId: "KILOGRAMO",
        nombre: "Milanesa",
        nombreDeCocina: "MILA",
        codigo: "MIL-1",
        codigoDeBarras: "12345678",
        alicuota: "10.5",
        seccionDeCartaId: SECCION,
      },
    ]);
  });

  it("del formulario solo se toman los campos declarados: el id, la empresa, la descripción, la unidad de venta y el paso que mande el navegador no pasan", async () => {
    await expect(
      darDeAltaElProducto(
        CLAVE,
        formulario({
          ...COMPLETO,
          id: "otro",
          claveDeCreacion: "otra",
          empresaId: "otra",
          descripcionEnCarta: "otra descripción",
          unidadDeVentaId: "GRAMO",
          pasoMinimo: "0.5",
          faltaCompletar: "true",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    const alta = mundo.altas[0] as Record<string, unknown>;
    expect(alta["id"]).toBe(CLAVE);
    expect(Object.keys(alta).sort()).toEqual([
      "alicuota",
      "claseDeUso",
      "codigo",
      "codigoDeBarras",
      "id",
      "nombre",
      "nombreDeCocina",
      "seccionDeCartaId",
      "unidadBaseId",
    ]);
  });

  it("un campo que no llegó (los que una clase que no se vende no muestra) o no es texto (un archivo) cuenta como vacío", async () => {
    await expect(
      darDeAltaElProducto(
        CLAVE,
        formulario({ claseDeUso: "INSUMO", unidadBaseId: "UNIDAD", nombre: "Servilletas" }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    await expect(
      darDeAltaElProducto(
        CLAVE,
        formulario({
          claseDeUso: "INSUMO",
          unidadBaseId: "UNIDAD",
          nombre: "Servilletas",
          codigo: new File(["x"], "codigo.txt"),
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.altas[0]).toMatchObject({ codigo: "", codigoDeBarras: "", alicuota: null });
    expect(mundo.altas[1]).toMatchObject({ codigo: "" });
  });

  it("sin nombre: «Falta el nombre», sin escribir y sin volver", async () => {
    const r = await darDeAltaElProducto(CLAVE, formulario({ ...COMPLETO, nombre: "  " }));
    expect(r.error?.codigo).toBe("CATALOGO_FALTA_EL_NOMBRE");
    expect(r.error?.campo).toBe("nombre");
    expect(mundo.altas).toEqual([]);
  });

  it("una clave que no es un uuid (no la fijó la página) es el genérico y no se escribe", async () => {
    const r = await darDeAltaElProducto("no-es-una-clave", formulario(COMPLETO));
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(mundo.altas).toEqual([]);
  });

  it("el error del servidor vuelve a la pantalla ya traducido, sin redirigir", async () => {
    mundo.resultado = err("PRODUCTO_DUPLICADO");
    const r = await darDeAltaElProducto(CLAVE, formulario(COMPLETO));
    expect(r).toEqual({
      error: {
        codigo: "CATALOGO_NOMBRE_REPETIDO",
        clave: "catalogo.error.nombre_repetido",
        presentacion: "AVISO",
        campo: "nombre",
      },
    });
  });

  it("repetir el mismo envío (doble toque, reintento) manda dos pedidos idénticos con la MISMA clave; el servidor devuelve el mismo producto y ambos van a su ficha", async () => {
    mundo.resultado = ok({ productoId: NUEVO, yaExistia: true });
    await expect(darDeAltaElProducto(CLAVE, formulario(COMPLETO))).rejects.toThrow(
      `${REDIRIGIO} /catalogo/productos/${NUEVO}`,
    );
    await expect(darDeAltaElProducto(CLAVE, formulario(COMPLETO))).rejects.toThrow(
      `${REDIRIGIO} /catalogo/productos/${NUEVO}`,
    );
    expect(mundo.altas[0]).toEqual(mundo.altas[1]);
  });
});
