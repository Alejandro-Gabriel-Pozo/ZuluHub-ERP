import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/presentaciones.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del formulario solo se toman los campos que la acción declara; el producto, la presentación y su
 * versión vienen ligados por la página. La composición es la real (`src/composicion/presentaciones-web.ts`); las consultas y los casos de uso son falsos (con la base real se prueban en
 * `test/integracion/presentaciones-web.test.ts`). Previene: tocar la presentación de un producto de otra empresa porque lo dijo el navegador, una casilla de peso variable que se lee al revés, un doble
 * clic que escribe dos veces y una acción que no vuelve a la lista cuando sale bien.
 */
vi.mock("server-only", () => ({}));
const REDIRIGIO = "NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`${REDIRIGIO} ${destino}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const P = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const A = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const mundo = vi.hoisted(
  (): {
    contextos: unknown[];
    altas: unknown[];
    ediciones: unknown[];
    resultadoDelAlta: unknown;
    resultadoDeEditar: unknown;
    vista: unknown;
  } => ({
    contextos: [],
    altas: [],
    ediciones: [],
    resultadoDelAlta: null,
    resultadoDeEditar: null,
    vista: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      crearPresentacion: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.altas.push(entrada);
        return Promise.resolve(mundo.resultadoDelAlta);
      },
      editarPresentacion: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.ediciones.push(entrada);
        return Promise.resolve(mundo.resultadoDeEditar);
      },
    }),
    consultasDeCatalogo: () => ({
      verPresentacionesDelProducto: () => Promise.resolve(ok(mundo.vista)),
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
  agregarLaPresentacion,
  cambiarElEstadoDeLaPresentacionDelProducto,
  cargarLaPresentacion,
  cargarLasPresentaciones,
  guardarElNombreDeLaPresentacion,
} from "../../apps/web/servidor/presentaciones";

const GUARDADA = {
  id: A,
  productoId: P,
  nombre: "Caja",
  nombreClave: "caja",
  cantidad: "5.0000",
  dePesoVariable: false,
  activa: true,
  version: 4,
};
const VISTA = {
  productoId: P,
  nombre: "Queso",
  claseDeUso: "MATERIA_PRIMA",
  activo: true,
  unidadBase: { id: "KILOGRAMO", simbolo: "kg" },
  presentaciones: [GUARDADA],
};
const formulario = (campos: Record<string, string>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};
const redirigido = async (accion: Promise<unknown>) => {
  try {
    await accion;
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    altas: [],
    ediciones: [],
    resultadoDelAlta: ok({ presentacion: GUARDADA, yaExistia: false }),
    resultadoDeEditar: ok({ ...GUARDADA, version: 5 }),
    vista: VISTA,
  });
});

describe("las lecturas", () => {
  it("la lista y una presentación salen de la consulta con el contexto del servidor", async () => {
    const lista = await cargarLasPresentaciones(CONTEXTO as never, P);
    expect(lista.ok && lista.dato.presentaciones.map((x) => x.id)).toEqual([A]);
    const una = await cargarLaPresentacion(CONTEXTO as never, P, A);
    expect(una.ok && una.dato.presentacion.nombre).toBe("Caja");
    expect(una.ok && una.dato.producto.unidadBase).toBe("kg");
  });
});

describe("agregarLaPresentacion", () => {
  it("escribe una vez con el contexto del servidor y el producto ligado, y vuelve a la lista", async () => {
    const r = await redirigido(
      agregarLaPresentacion(
        P,
        formulario({ nombre: "Caja", cantidad: "5", pesoVariable: "on", empresaId: "otra" }),
      ),
    );
    expect(r).toBe(`${REDIRIGIO} /catalogo/productos/${P}/compra`);
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.altas).toEqual([
      { productoId: P, nombre: "Caja", cantidad: "5", dePesoVariable: true },
    ]);
  });

  it("la casilla desmarcada no viaja: es peso fijo; lo que no es «on» tampoco la marca", async () => {
    for (const campos of [
      { nombre: "Caja", cantidad: "5" },
      { nombre: "Caja", cantidad: "5", pesoVariable: "true" },
    ]) {
      mundo.altas.length = 0;
      await redirigido(agregarLaPresentacion(P, formulario(campos)));
      expect(mundo.altas).toEqual([
        { productoId: P, nombre: "Caja", cantidad: "5", dePesoVariable: false },
      ]);
    }
  });

  it("si el servidor rechaza, devuelve el error ya traducido y no redirige; una cantidad inválida lleva su campo", async () => {
    mundo.resultadoDelAlta = { ok: false, error: "CANTIDAD_INVALIDA" };
    const r = await agregarLaPresentacion(P, formulario({ nombre: "Caja", cantidad: "0" }));
    expect(r).toMatchObject({ error: { codigo: "CATALOGO_CANTIDAD_INVALIDA", campo: "cantidad" } });
    mundo.resultadoDelAlta = { ok: false, error: "PRESENTACION_REPETIDA" };
    expect(
      await agregarLaPresentacion(P, formulario({ nombre: "Caja", cantidad: "6" })),
    ).toMatchObject({
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
  });

  it("el mismo alta repetida llega dos veces al caso de uso con lo mismo (la repetición la resuelve él) y vuelve a la lista las dos", async () => {
    mundo.resultadoDelAlta = ok({ presentacion: GUARDADA, yaExistia: true });
    const campos = formulario({ nombre: "Caja", cantidad: "5" });
    const r = await Promise.all([
      redirigido(agregarLaPresentacion(P, campos)),
      redirigido(agregarLaPresentacion(P, campos)),
    ]);
    expect(r).toEqual([
      `${REDIRIGIO} /catalogo/productos/${P}/compra`,
      `${REDIRIGIO} /catalogo/productos/${P}/compra`,
    ]);
    expect(mundo.altas[0]).toEqual(mundo.altas[1]);
  });
});

describe("guardarElNombreDeLaPresentacion", () => {
  it("renombra con la versión que se vio, conserva el estado vigente y vuelve a la lista", async () => {
    const r = await redirigido(
      guardarElNombreDeLaPresentacion(P, A, 4, formulario({ nombre: "Caja grande" })),
    );
    expect(r).toBe(`${REDIRIGIO} /catalogo/productos/${P}/compra`);
    expect(mundo.ediciones).toEqual([
      { presentacionId: A, nombre: "Caja grande", activa: true, versionEsperada: 4 },
    ]);
  });

  it("una versión vieja es el genérico y no redirige", async () => {
    mundo.resultadoDeEditar = { ok: false, error: "VERSION_DESACTUALIZADA" };
    expect(
      await guardarElNombreDeLaPresentacion(P, A, 1, formulario({ nombre: "X" })),
    ).toMatchObject({
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
  });

  it("una presentación que no es del producto no llega al caso de uso", async () => {
    const r = await guardarElNombreDeLaPresentacion(
      P,
      "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
      4,
      formulario({ nombre: "X" }),
    );
    expect(r).toMatchObject({ error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" } });
    expect(mundo.ediciones).toEqual([]);
  });
});

describe("cambiarElEstadoDeLaPresentacionDelProducto", () => {
  it("desactiva con el nombre vigente y la versión que se vio; reactiva con `activa: true`", async () => {
    expect(await redirigido(cambiarElEstadoDeLaPresentacionDelProducto(P, A, 4, false))).toBe(
      `${REDIRIGIO} /catalogo/productos/${P}/compra`,
    );
    await redirigido(cambiarElEstadoDeLaPresentacionDelProducto(P, A, 5, true));
    expect(mundo.ediciones).toEqual([
      { presentacionId: A, nombre: "Caja", activa: false, versionEsperada: 4 },
      { presentacionId: A, nombre: "Caja", activa: true, versionEsperada: 5 },
    ]);
  });

  it("si el servidor rechaza (sin permiso, versión vieja) devuelve el error y no redirige", async () => {
    mundo.resultadoDeEditar = { ok: false, error: "SIN_PERMISO" };
    const r = await cambiarElEstadoDeLaPresentacionDelProducto(P, A, 4, false);
    expect(r).toMatchObject({ error: { codigo: "SIN_PERMISO" } });
  });
});
