import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/clasificacion.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del navegador solo se toma el pedido, que se lee en la composición (lista de
 * permitidos). La composición es la real (`src/composicion/clasificacion-web.ts`); las consultas y los casos de uso son falsos (con la base real se prueban en
 * `test/integracion/clasificacion-web.test.ts`). Previene: tocar la clasificación de otra empresa porque lo dijo el navegador, y una acción que se salte la composición.
 */
vi.mock("server-only", () => ({}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const mundo = vi.hoisted(
  (): { contextos: unknown[]; llamadas: { que: string; entrada: unknown }[] } => ({
    contextos: [],
    llamadas: [],
  }),
);
const caso = (que: string) => (contexto: unknown, entrada: unknown) => {
  mundo.contextos.push(contexto);
  mundo.llamadas.push({ que, entrada });
  return Promise.resolve({ ok: true, valor: {} });
};
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      crearNodoDeClasificacion: caso("crear"),
      renombrarNodoDeClasificacion: caso("renombrar"),
      moverNodoDeClasificacion: caso("mover"),
      desactivarNodoDeClasificacion: caso("desactivar"),
      reactivarNodoDeClasificacion: caso("reactivar"),
      clasificarProducto: caso("clasificar"),
    }),
    consultasDeCatalogo: () => ({
      listarClasificacion: (contexto: unknown) => {
        mundo.contextos.push(contexto);
        return Promise.resolve(
          ok([{ id: A, padreId: null, nombre: "Restaurante", activo: true, version: 1, nivel: 1 }]),
        );
      },
      verClasificacionDelProducto: (contexto: unknown) => {
        mundo.contextos.push(contexto);
        return Promise.resolve(ok({ vigente: null }));
      },
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
  cargarElArbolDeClasificacion,
  cargarLaClasificacionDelProducto,
  clasificarElProducto,
  crearElNodoDeClasificacion,
  desactivarElNodoDeClasificacion,
  moverElNodoDeClasificacion,
  reactivarElNodoDeClasificacion,
  renombrarElNodoDeClasificacion,
} from "../../apps/web/servidor/clasificacion";

beforeEach(() => {
  mundo.contextos = [];
  mundo.llamadas = [];
});

describe("las lecturas", () => {
  it("el árbol se pide con el contexto que ya resolvió la página", async () => {
    const r = await cargarElArbolDeClasificacion(CONTEXTO as never);
    expect(r).toMatchObject({ ok: true, dato: { nodos: [{ id: A, nombre: "Restaurante" }] } });
    expect(mundo.contextos).toEqual([CONTEXTO]);
  });

  it("la clasificación de un producto se pide con el contexto y el id de la dirección", async () => {
    const r = await cargarLaClasificacionDelProducto(CONTEXTO as never, B);
    expect(r).toMatchObject({ ok: true, dato: { productoId: B, vigente: null } });
    // Dos consultas (la del producto y la del árbol), las dos con el mismo contexto.
    expect(mundo.contextos).toEqual([CONTEXTO, CONTEXTO]);
  });
});

describe("las acciones: la empresa la pone el servidor y el pedido lo lee la composición", () => {
  it.each([
    ["crear", crearElNodoDeClasificacion, { id: A, padreId: null, nombre: "X" }],
    ["renombrar", renombrarElNodoDeClasificacion, { nodoId: A, versionEsperada: 2, nombre: "X" }],
    ["mover", moverElNodoDeClasificacion, { nodoId: A, versionEsperada: 2, nuevoPadreId: B }],
    ["desactivar", desactivarElNodoDeClasificacion, { nodoId: A }],
    ["reactivar", reactivarElNodoDeClasificacion, { nodoId: A }],
    ["clasificar", clasificarElProducto, { id: A, productoId: B, nodoId: null }],
  ] as const)(
    "%s: llega al caso de uso con el contexto del servidor y sin lo que el navegador agregue",
    async (que, accion, pedido) => {
      const r = await accion({ ...pedido, empresaId: "otra-empresa", personaId: "otra" });
      expect(r.ok).toBe(true);
      expect(mundo.contextos).toEqual([CONTEXTO]);
      expect(mundo.llamadas).toEqual([{ que, entrada: pedido }]);
    },
  );

  it.each([
    crearElNodoDeClasificacion,
    renombrarElNodoDeClasificacion,
    moverElNodoDeClasificacion,
    desactivarElNodoDeClasificacion,
    reactivarElNodoDeClasificacion,
    clasificarElProducto,
  ])(
    "un pedido sin la forma pedida sale como el genérico y no llega al caso de uso",
    async (accion) => {
      expect(await accion({ nada: true })).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
      });
      expect(mundo.llamadas).toEqual([]);
      },
  );
});
