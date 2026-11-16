import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/secciones.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del formulario solo se toman los campos que la acción declara; la clave de creación, la
 * sección, su versión y las secciones que la persona vio vienen ligadas por la página. La composición es la real (`src/composicion/secciones-web.ts`); las consultas y los casos de uso son
 * falsos (con la base real se prueban en `test/integracion/secciones-web.test.ts`). Previene: tocar las secciones de otra empresa o crear con un orden, un estado o un id que mandó el navegador,
 * que un doble toque cree dos secciones y que una acción que se queda en la pantalla deje la página con versiones viejas.
 */
vi.mock("server-only", () => ({}));
const REDIRIGIO = "NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`${REDIRIGIO} ${destino}`);
  },
}));
const mundo = vi.hoisted(
  (): {
    contextos: unknown[];
    llamadas: { que: string; entrada: unknown }[];
    revalidadas: string[];
    resultados: Record<string, unknown>;
  } => ({ contextos: [], llamadas: [], revalidadas: [], resultados: {} }),
);
vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => {
    mundo.revalidadas.push(ruta);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const CLAVE = "7d2e1f00-1111-4222-8333-944455556666";
const hacer = (que: string) => (contexto: unknown, entrada: unknown) => {
  mundo.contextos.push(contexto);
  mundo.llamadas.push({ que, entrada });
  return Promise.resolve(mundo.resultados[que]);
};
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      crearSeccionDeCarta: hacer("crear"),
      editarSeccionDeCarta: hacer("editar"),
      desactivarSeccionDeCarta: hacer("desactivar"),
      reactivarSeccionDeCarta: hacer("reactivar"),
      reordenarSeccionesDeCarta: hacer("reordenar"),
    }),
    consultasDeCatalogo: () => ({
      listarSeccionesParaGestionar: hacer("lista"),
      listarProductos: hacer("productos"),
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (trabajo: (contexto: unknown) => unknown) => trabajo(CONTEXTO),
}));

import {
  cambiarElEstadoDeLaSeccionDeCarta,
  cargarLaSeccion,
  cargarLasSecciones,
  cargarUnaSeccion,
  darDeAltaLaSeccion,
  guardarElNombreDeLaSeccion,
  moverLaSeccion,
  nuevaClaveDeSeccion,
} from "../../apps/web/servidor/secciones";

const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};
const SECCIONES = [
  { id: A, nombre: "Cafés", orden: 0, activa: true, version: 3, productos: 2 },
  { id: B, nombre: "Bebidas", orden: 7, activa: true, version: 5, productos: 0 },
];
const VISTAS = [
  { seccionId: A, versionEsperada: 3 },
  { seccionId: B, versionEsperada: 5 },
];
const GENERICO = {
  codigo: "CATALOGO_ACCION_NO_PERMITIDA",
  clave: "catalogo.error.accion_no_permitida",
  presentacion: "AVISO",
};
const escrituras = () => mundo.llamadas.filter((l) => !["lista", "productos"].includes(l.que));

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    llamadas: [],
    revalidadas: [],
    resultados: {
      lista: ok(SECCIONES),
      productos: ok({ productos: [], siguiente: null }),
      crear: ok({ seccionId: CLAVE, yaExistia: false }),
      editar: ok({ version: 4 }),
      desactivar: ok({ yaEstaba: false }),
      reactivar: ok({ yaEstaba: false }),
      reordenar: ok({ movidas: 2 }),
    },
  });
});

describe("nuevaClaveDeSeccion", () => {
  it("es un uuid, y cada apertura de la página trae otra", () => {
    const a = nuevaClaveDeSeccion();
    const b = nuevaClaveDeSeccion();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("las lecturas", () => {
  it("la lista pide las secciones con el contexto que ya resolvió la página", async () => {
    const r = await cargarLasSecciones(CONTEXTO as never);
    expect(r.ok && r.dato.secciones.map((s) => s.nombre)).toEqual(["Cafés", "Bebidas"]);
    expect(mundo.contextos).toEqual([CONTEXTO]);
  });

  it("una sección se pide sola, sin sus productos", async () => {
    const r = await cargarLaSeccion(CONTEXTO as never, B);
    expect(r.ok && r.dato.nombre).toBe("Bebidas");
    expect(mundo.llamadas.map((l) => l.que)).toEqual(["lista"]);
  });

  it("una sección con sus productos pide los de esa sección y la página de la dirección", async () => {
    mundo.resultados["productos"] = ok({
      productos: [{ id: "p1", nombre: "Cortado" }],
      siguiente: { id: A, nombreClave: "cortado" },
    });
    const r = await cargarUnaSeccion(CONTEXTO as never, A, "");
    expect(r.ok && r.dato.productos).toEqual([{ id: "p1", nombre: "Cortado" }]);
    expect(r.ok && r.dato.siguiente).toBe(`${A}:cortado`);
    expect(mundo.llamadas[1]).toEqual({
      que: "productos",
      entrada: { seccionId: A, activo: true },
    });
  });
});

describe("darDeAltaLaSeccion", () => {
  it("si sale bien, vuelve a la lista tras escribir una vez con el contexto del servidor, la clave como id y el orden siguiente", async () => {
    await expect(darDeAltaLaSeccion(CLAVE, formulario({ nombre: "Entradas" }))).rejects.toThrow(
      `${REDIRIGIO} /catalogo/secciones`,
    );
    expect(escrituras()).toEqual([
      { que: "crear", entrada: { id: CLAVE, nombre: "Entradas", orden: 8 } },
    ]);
    expect(mundo.contextos).toEqual([CONTEXTO, CONTEXTO]);
  });

  it("del formulario solo se toma el nombre: el id, el orden, el estado y la empresa que mande el navegador no pasan", async () => {
    await expect(
      darDeAltaLaSeccion(
        CLAVE,
        formulario({
          nombre: "Entradas",
          id: "otro",
          orden: "0",
          activa: "false",
          empresaId: "otra",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(escrituras()).toEqual([
      { que: "crear", entrada: { id: CLAVE, nombre: "Entradas", orden: 8 } },
    ]);
  });

  it("un nombre que no llegó o no es texto (un archivo) cuenta como vacío: «Falta el nombre», sin escribir", async () => {
    for (const datos of [formulario({}), formulario({ nombre: new File(["x"], "nombre.txt") })]) {
      const r = await darDeAltaLaSeccion(CLAVE, datos);
      expect(r.error?.codigo).toBe("CATALOGO_FALTA_EL_NOMBRE");
      expect(r.error?.campo).toBe("nombre");
    }
    expect(escrituras()).toEqual([]);
  });

  it("una clave que no es un uuid (no la fijó la página) es el genérico y no se escribe", async () => {
    const r = await darDeAltaLaSeccion("no-es-una-clave", formulario({ nombre: "Entradas" }));
    expect(r).toEqual({ error: GENERICO });
    expect(escrituras()).toEqual([]);
  });

  it("el error del servidor vuelve a la pantalla ya traducido, sin redirigir (un nombre repetido sale genérico)", async () => {
    mundo.resultados["crear"] = err("SECCION_DUPLICADA");
    expect(await darDeAltaLaSeccion(CLAVE, formulario({ nombre: "Cafés" }))).toEqual({
      error: GENERICO,
    });
  });

  it("repetir el mismo envío (doble toque, reintento) manda dos pedidos idénticos con la MISMA clave; ambos vuelven a la lista", async () => {
    mundo.resultados["crear"] = ok({ seccionId: CLAVE, yaExistia: true });
    for (let i = 0; i < 2; i++) {
      await expect(darDeAltaLaSeccion(CLAVE, formulario({ nombre: "Entradas" }))).rejects.toThrow(
        `${REDIRIGIO} /catalogo/secciones`,
      );
    }
    const [primero, segundo] = escrituras();
    expect(primero).toEqual(segundo);
    expect(primero?.entrada).toMatchObject({ id: CLAVE });
  });
});

describe("guardarElNombreDeLaSeccion", () => {
  it("si sale bien, vuelve a la lista tras escribir una vez con la sección y la versión que ligó la página", async () => {
    await expect(
      guardarElNombreDeLaSeccion(A, 3, formulario({ nombre: "Cafetería" })),
    ).rejects.toThrow(`${REDIRIGIO} /catalogo/secciones`);
    expect(escrituras()).toEqual([
      {
        que: "editar",
        entrada: { seccionId: A, versionEsperada: 3, nombre: "Cafetería", orden: 0 },
      },
    ]);
  });

  it("del formulario solo se toma el nombre: la versión, el orden y la sección que mande el navegador no pasan", async () => {
    await expect(
      guardarElNombreDeLaSeccion(
        A,
        3,
        formulario({ nombre: "Cafetería", versionEsperada: "99", orden: "50", seccionId: B }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(escrituras()[0]?.entrada).toEqual({
      seccionId: A,
      versionEsperada: 3,
      nombre: "Cafetería",
      orden: 0,
    });
  });

  it("sin nombre: «Falta el nombre», sin escribir y sin volver", async () => {
    const r = await guardarElNombreDeLaSeccion(A, 3, formulario({ nombre: "  " }));
    expect(r.error?.codigo).toBe("CATALOGO_FALTA_EL_NOMBRE");
    expect(escrituras()).toEqual([]);
  });

  it("con una versión vieja el servidor rechaza y la pantalla recibe el genérico, sin redirigir", async () => {
    mundo.resultados["editar"] = err("VERSION_DESACTUALIZADA");
    expect(await guardarElNombreDeLaSeccion(A, 1, formulario({ nombre: "Cafetería" }))).toEqual({
      error: GENERICO,
    });
  });
});

describe("moverLaSeccion", () => {
  it("subir: la sección tocada sube un lugar sobre las que la persona vio, con el contexto del servidor, y la página se vuelve a pedir", async () => {
    expect(await moverLaSeccion(VISTAS, formulario({ subir: B }))).toEqual({ error: null });
    expect(escrituras()).toEqual([
      {
        que: "reordenar",
        entrada: {
          secciones: [
            { seccionId: B, versionEsperada: 5 },
            { seccionId: A, versionEsperada: 3 },
          ],
        },
      },
    ]);
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.revalidadas).toEqual(["/catalogo/secciones"]);
  });

  it("bajar: la sección tocada baja un lugar", async () => {
    expect(await moverLaSeccion(VISTAS, formulario({ bajar: A }))).toEqual({ error: null });
    expect(escrituras()[0]?.entrada).toEqual({
      secciones: [
        { seccionId: B, versionEsperada: 5 },
        { seccionId: A, versionEsperada: 3 },
      ],
    });
  });

  it("un formulario sin ninguna flecha no mueve nada: el genérico, y la página igual se vuelve a pedir", async () => {
    expect(await moverLaSeccion(VISTAS, formulario({}))).toEqual({ error: GENERICO });
    expect(escrituras()).toEqual([]);
    expect(mundo.revalidadas).toEqual(["/catalogo/secciones"]);
  });

  it("una sección que la persona no vio no mueve nada", async () => {
    expect(await moverLaSeccion(VISTAS, formulario({ subir: CLAVE }))).toEqual({ error: GENERICO });
    expect(escrituras()).toEqual([]);
  });

  it("un conflicto (otra persona cambió algo antes) vuelve a la pantalla como el genérico y la página se vuelve a pedir", async () => {
    mundo.resultados["reordenar"] = err("VERSION_DESACTUALIZADA");
    expect(await moverLaSeccion(VISTAS, formulario({ subir: B }))).toEqual({ error: GENERICO });
    expect(mundo.revalidadas).toEqual(["/catalogo/secciones"]);
  });

  it("repetir el mismo toque con la misma lista (doble toque) manda dos pedidos idénticos", async () => {
    mundo.resultados["reordenar"] = ok({ movidas: 0 });
    await moverLaSeccion(VISTAS, formulario({ subir: B }));
    await moverLaSeccion(VISTAS, formulario({ subir: B }));
    const [primero, segundo] = escrituras();
    expect(primero).toEqual(segundo);
  });

  it("si se tocan las dos flechas a la vez (no pasa en la pantalla) manda a «subir»", async () => {
    await moverLaSeccion(VISTAS, formulario({ subir: B, bajar: A }));
    expect(escrituras()[0]?.entrada).toEqual({
      secciones: [
        { seccionId: B, versionEsperada: 5 },
        { seccionId: A, versionEsperada: 3 },
      ],
    });
  });
});

describe("cambiarElEstadoDeLaSeccionDeCarta", () => {
  it("desactivar: escribe una vez con el contexto del servidor, y la página de la sección se vuelve a pedir", async () => {
    expect(await cambiarElEstadoDeLaSeccionDeCarta(A, false)).toEqual({ error: null });
    expect(escrituras()).toEqual([{ que: "desactivar", entrada: { seccionId: A } }]);
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.revalidadas).toEqual([`/catalogo/secciones/${A}`]);
  });

  it("reactivar: escribe una vez", async () => {
    expect(await cambiarElEstadoDeLaSeccionDeCarta(A, true)).toEqual({ error: null });
    expect(escrituras()).toEqual([{ que: "reactivar", entrada: { seccionId: A } }]);
  });

  it("una sección que no es de la empresa sale como el genérico y la página igual se vuelve a pedir", async () => {
    mundo.resultados["desactivar"] = err("SECCION_NO_ENCONTRADA");
    expect(await cambiarElEstadoDeLaSeccionDeCarta(B, false)).toEqual({ error: GENERICO });
    expect(mundo.revalidadas).toEqual([`/catalogo/secciones/${B}`]);
  });
});
