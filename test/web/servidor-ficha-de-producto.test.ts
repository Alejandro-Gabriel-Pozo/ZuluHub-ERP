import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/ficha-de-producto.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del formulario solo se toman los campos que la acción declara; el id y
 * la versión vienen ligados por la página. La composición es la real (`src/composicion/ficha-de-producto-web.ts`); las consultas y el caso de uso son falsos (con la base real se
 * prueban en `test/integracion/ficha-de-producto-web.test.ts`). Previene: guardar la ficha de un producto de otra empresa o cambiar la clase porque lo dijo el navegador, y que un
 * campo que el formulario no mandó (apagado) se guarde vacío.
 */
vi.mock("server-only", () => ({}));
const REDIRIGIO = "NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`${REDIRIGIO} ${destino}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const PRODUCTO = {
  id: ID,
  nombre: "Milanesa",
  nombreDeCocina: "MILA",
  descripcionEnCarta: "Con papas",
  codigo: "MIL-1",
  codigoDeBarras: null,
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  alicuota: "21",
  seccionDeCartaId: SECCION,
  version: 4,
};
const mundo = vi.hoisted(
  (): { contextos: unknown[]; ediciones: unknown[]; resultado: unknown; producto: unknown } => ({
    contextos: [],
    ediciones: [],
    resultado: null,
    producto: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      editarProducto: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.ediciones.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      verProducto: () =>
        Promise.resolve(
          ok(
            mundo.producto === null
              ? null
              : { producto: mundo.producto, seccion: null, grupos: [] },
          ),
        ),
      listarSeccionesDeCarta: () => Promise.resolve(ok([])),
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

import { cargarLaFicha, guardarLaFicha } from "../../apps/web/servidor/ficha-de-producto";

const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};
const COMPLETO = {
  nombre: "Milanesa napolitana",
  nombreDeCocina: "MILA NAPO",
  codigo: "MIL-2",
  codigoDeBarras: "12345678",
  alicuota: "10.5",
  seccionDeCartaId: SECCION,
};

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    ediciones: [],
    resultado: ok({ version: 5 }),
    producto: PRODUCTO,
  });
});

describe("la lectura de la ficha", () => {
  it("pide la ficha con el contexto que ya resolvió la página", async () => {
    const r = await cargarLaFicha(CONTEXTO as never, ID);
    expect(r.ok && r.dato.nombre).toBe("Milanesa");
  });
});

describe("guardarLaFicha", () => {
  it("si sale bien, vuelve a la ficha del producto (con la versión nueva) tras escribir una vez con el contexto del servidor", async () => {
    await expect(guardarLaFicha(ID, 4, formulario(COMPLETO))).rejects.toThrow(
      `${REDIRIGIO} /catalogo/productos/${ID}`,
    );
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.ediciones).toEqual([
      {
        productoId: ID,
        versionEsperada: 4,
        nombre: "Milanesa napolitana",
        nombreDeCocina: "MILA NAPO",
        descripcionEnCarta: "Con papas",
        codigo: "MIL-2",
        codigoDeBarras: "12345678",
        alicuota: "10.5",
        seccionDeCartaId: SECCION,
      },
    ]);
  });

  it("del formulario solo se toman los campos declarados: la clase, la unidad, la empresa y la descripción que mande el navegador no pasan", async () => {
    await expect(
      guardarLaFicha(
        ID,
        4,
        formulario({
          ...COMPLETO,
          claseDeUso: "INSUMO",
          unidadBaseId: "KILOGRAMO",
          empresaId: "otra",
          descripcionEnCarta: "otra descripción",
          versionEsperada: "1",
          productoId: "otro",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones).toHaveLength(1);
    const edicion = mundo.ediciones[0] as Record<string, unknown>;
    expect(edicion["descripcionEnCarta"]).toBe("Con papas");
    expect(edicion["productoId"]).toBe(ID);
    expect(edicion["versionEsperada"]).toBe(4);
    expect(Object.keys(edicion).sort()).toEqual([
      "alicuota",
      "codigo",
      "codigoDeBarras",
      "descripcionEnCarta",
      "nombre",
      "nombreDeCocina",
      "productoId",
      "seccionDeCartaId",
      "versionEsperada",
    ]);
  });

  it("un campo que el formulario no mandó (el desplegable apagado) conserva lo guardado; uno que llegó vacío lo borra", async () => {
    await expect(
      guardarLaFicha(ID, 4, formulario({ nombre: "Milanesa", nombreDeCocina: "", codigo: "" })),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({
      nombreDeCocina: "",
      codigo: "",
      codigoDeBarras: null,
      alicuota: "21",
      seccionDeCartaId: SECCION,
    });
  });

  it("un campo que no es texto (un archivo) cuenta como no mandado", async () => {
    await expect(
      guardarLaFicha(
        ID,
        4,
        formulario({ nombre: "Milanesa", alicuota: new File(["x"], "alicuota.txt") }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({ alicuota: "21" });
  });

  it("sin nombre en el formulario: «Falta el nombre», sin escribir y sin volver", async () => {
    const r = await guardarLaFicha(ID, 4, formulario({}));
    expect(r.error?.codigo).toBe("CATALOGO_FALTA_EL_NOMBRE");
    expect(r.error?.campo).toBe("nombre");
    expect(mundo.ediciones).toEqual([]);
  });

  it("el error del servidor vuelve a la pantalla ya traducido, sin redirigir", async () => {
    mundo.resultado = err("PRODUCTO_DUPLICADO");
    const r = await guardarLaFicha(ID, 4, formulario(COMPLETO));
    expect(r).toEqual({
      error: {
        codigo: "CATALOGO_NOMBRE_REPETIDO",
        clave: "catalogo.error.nombre_repetido",
        presentacion: "AVISO",
        campo: "nombre",
      },
    });
  });

  it("dos pestañas: la que llega con la versión vieja recibe el genérico y no vuelve a la ficha", async () => {
    mundo.resultado = err("VERSION_DESACTUALIZADA");
    const r = await guardarLaFicha(ID, 3, formulario(COMPLETO));
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(mundo.ediciones[0]).toMatchObject({ versionEsperada: 3 });
  });

  it("un producto que no es de la empresa (no existe para ella) es el genérico y no se escribe", async () => {
    mundo.producto = null;
    const r = await guardarLaFicha(ID, 4, formulario(COMPLETO));
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(mundo.ediciones).toEqual([]);
  });

  it("repetir el mismo guardado (doble toque) manda dos pedidos idénticos y el servidor decide: ambos terminan igual", async () => {
    await expect(guardarLaFicha(ID, 4, formulario(COMPLETO))).rejects.toThrow(REDIRIGIO);
    await expect(guardarLaFicha(ID, 4, formulario(COMPLETO))).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toEqual(mundo.ediciones[1]);
  });
});
