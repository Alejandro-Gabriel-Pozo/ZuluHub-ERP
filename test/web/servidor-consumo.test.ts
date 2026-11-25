import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/consumo.ts`: la empresa y la persona las fija el SERVIDOR; del formulario solo se toman las líneas por opción; el producto, el grupo, la versión y las opciones vistas las liga la
 * página. La composición es la real; las consultas y el caso de uso son falsos (con la base real: `test/integracion/consumo-web.test.ts`). Previene: nombrar una opción de otro grupo porque lo dijo el
 * navegador, un doble toque que escribe dos veces y una pantalla que sigue mostrando lo viejo después de un rechazo.
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
const GRUPO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const O1 = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const O2 = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const INSUMO = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const mundo = vi.hoisted((): { guardados: unknown[]; resultado: unknown } => ({
  guardados: [],
  resultado: null,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      guardarConsumoDeGrupo: (_c: unknown, entrada: unknown) => {
        mundo.guardados.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      verProducto: () =>
        Promise.resolve(
          ok({
            producto: { id: ID, nombre: "Milanesa", claseDeUso: "VENDIBLE", versionDeOpciones: 4 },
            grupos: [
              {
                id: GRUPO,
                clase: "INCLUIDA",
                esTamano: false,
                nombre: "Carne",
                activo: true,
                opciones: [
                  {
                    id: O1,
                    nombre: "Pollo",
                    orden: 1,
                    activa: true,
                    consumo: [{ insumoId: INSUMO, cantidad: "150.0000", escalaConTamano: false }],
                  },
                  { id: O2, nombre: "Carne", orden: 2, activa: true, consumo: [] },
                ],
              },
            ],
            preciosVigentes: [],
            historial: [],
          }),
        ),
      productosParaConsumo: () =>
        Promise.resolve(ok([{ id: INSUMO, nombre: "Pollo crudo", unidadBaseId: "GRAMO" }])),
      listarUnidades: () => Promise.resolve(ok([{ id: "GRAMO", simbolo: "g" }])),
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

import { cargarElConsumo, guardarElConsumo } from "../../apps/web/servidor/consumo";

const LIGADO = { productoId: ID, versionDeOpciones: 4, grupoId: GRUPO, idsDeOpciones: [O1, O2] };
const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [k, v] of Object.entries(campos)) datos.set(k, v);
  return datos;
};

beforeEach(() => {
  mundo.guardados = [];
  mundo.resultado = ok({ versionDeOpciones: 5, yaEstaba: false });
  revalidadas.length = 0;
});

describe("la lectura", () => {
  it("trae el grupo, las opciones con su consumo y los insumos con el símbolo de su unidad", async () => {
    const r = await cargarElConsumo(CONTEXTO as never, ID, GRUPO);
    expect(r.ok && r.dato).toMatchObject({
      versionDeOpciones: 4,
      tieneMedida: false,
      opciones: [
        { id: O1, lineas: [{ insumoId: INSUMO, cantidad: "150.0000" }] },
        { id: O2, lineas: [] },
      ],
      insumos: [{ id: INSUMO, nombre: "Pollo crudo", unidad: "g" }],
    });
  });
});

describe("guardarElConsumo", () => {
  it("manda el conjunto final de cada opción ligada, con los ids de la página; vuelve a las opciones pidiendo la pantalla de nuevo", async () => {
    await expect(
      guardarElConsumo(
        LIGADO,
        formulario({
          consumo_0_l0_insumo: INSUMO,
          consumo_0_l0_cantidad: "200",
          consumo_0_l0_escala: "on",
          consumo_1_l1_insumo: INSUMO,
          consumo_1_l1_cantidad: "1.5",
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /catalogo/productos/${ID}/opciones`);
    expect(mundo.guardados).toEqual([
      {
        productoId: ID,
        grupoId: GRUPO,
        versionDeOpcionesEsperada: 4,
        opciones: [
          { opcionId: O1, lineas: [{ insumoId: INSUMO, cantidad: "200", escalaConTamano: true }] },
          { opcionId: O2, lineas: [{ insumoId: INSUMO, cantidad: "1.5", escalaConTamano: false }] },
        ],
      },
    ]);
    expect(revalidadas).toEqual([
      `/catalogo/productos/${ID}/opciones/${GRUPO}/consumo`,
      `/catalogo/productos/${ID}/opciones`,
    ]);
  });

  it("una opción sin líneas en el formulario se manda sin consumo (se quita lo que tenía)", async () => {
    await expect(guardarElConsumo(LIGADO, formulario({}))).rejects.toThrow("NEXT_REDIRECT");
    expect(mundo.guardados[0]).toMatchObject({
      opciones: [
        { opcionId: O1, lineas: [] },
        { opcionId: O2, lineas: [] },
      ],
    });
  });

  it("del formulario no pasan la empresa, el producto, el grupo, la versión ni una opción que mande el navegador", async () => {
    await expect(
      guardarElConsumo(
        LIGADO,
        formulario({
          empresaId: "otra",
          productoId: "x",
          grupoId: "y",
          versionDeOpciones: "99",
          opcionId: "z",
          consumo_7_l0_insumo: INSUMO,
          consumo_7_l0_cantidad: "1",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mundo.guardados[0]).toMatchObject({
      productoId: ID,
      grupoId: GRUPO,
      versionDeOpcionesEsperada: 4,
    });
    expect(JSON.stringify(mundo.guardados)).not.toMatch(/otra|"x"|"y"|"z"|99/);
  });

  it("si el servidor rechaza (otra persona cambió antes), devuelve el error, no redirige y pide la pantalla de nuevo", async () => {
    mundo.resultado = err("OPCIONES_DESACTUALIZADAS");
    const r = await guardarElConsumo(
      LIGADO,
      formulario({ consumo_0_l0_insumo: INSUMO, consumo_0_l0_cantidad: "1" }),
    );
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/opciones/${GRUPO}/consumo`]);
  });

  it("los errores con texto propio salen con su campo; sin permiso sale el motivo del guard", async () => {
    mundo.resultado = err("CONSUMO_REPETIDO");
    expect((await guardarElConsumo(LIGADO, formulario({}))).error).toMatchObject({
      codigo: "CATALOGO_CONSUMO_REPETIDO",
      campo: "insumo",
    });
    mundo.resultado = err("CANTIDAD_INVALIDA");
    expect((await guardarElConsumo(LIGADO, formulario({}))).error).toMatchObject({
      codigo: "CATALOGO_CANTIDAD_INVALIDA",
      campo: "cantidad",
    });
    mundo.resultado = err("SIN_PERMISO");
    expect((await guardarElConsumo(LIGADO, formulario({}))).error?.codigo).toBe("SIN_PERMISO");
  });

  it("repetir el mismo guardado (doble toque) manda dos pedidos idénticos: el caso de uso decide y ambos terminan igual", async () => {
    mundo.resultado = ok({ versionDeOpciones: 4, yaEstaba: true });
    for (let i = 0; i < 2; i += 1) {
      await expect(
        guardarElConsumo(
          LIGADO,
          formulario({ consumo_0_l0_insumo: INSUMO, consumo_0_l0_cantidad: "1" }),
        ),
      ).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(mundo.guardados[0]).toEqual(mundo.guardados[1]);
  });
});
