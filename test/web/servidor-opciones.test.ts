import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/opciones.ts`: la empresa y la persona las fija el SERVIDOR (`conLaEmpresa`) y del formulario solo se toman los campos que la acción declara; el producto, la
 * versión de las opciones, el grupo, la clave del cambio y los ids de las opciones vistas vienen ligados por la página. La composición es la real (`src/composicion/opciones-web.ts`);
 * las consultas y los casos de uso son falsos (con la base real se prueban en `test/integracion/opciones-web.test.ts`). Previene: tocar las opciones de un producto de otra empresa
 * porque lo dijo el navegador, mandar el id de una opción ajena, un doble clic que escribe dos veces y una pantalla que sigue mostrando lo viejo después de un rechazo.
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
const OPCION = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const GRUPO = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const ORIGEN = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const mundo = vi.hoisted(
  (): {
    contextos: unknown[];
    ediciones: unknown[];
    copias: unknown[];
    resultado: unknown;
    producto: unknown;
    grupos: unknown[];
    vistasPrevias: unknown[];
  } => ({
    contextos: [],
    ediciones: [],
    copias: [],
    resultado: null,
    producto: null,
    grupos: [],
    vistasPrevias: [],
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      editarOpciones: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.ediciones.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
      copiarOpciones: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.copias.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      verProducto: () =>
        Promise.resolve(
          ok(
            mundo.producto === null
              ? null
              : {
                  producto: mundo.producto,
                  grupos: mundo.grupos,
                  preciosVigentes: [],
                  historial: [],
                },
          ),
        ),
      productosParaCopiar: () => Promise.resolve(ok([{ id: ORIGEN, nombre: "Hamburguesa" }])),
      vistaPreviaDeCopiaDeOpciones: (_contexto: unknown, entrada: unknown) => {
        mundo.vistasPrevias.push(entrada);
        return Promise.resolve(
          ok([
            {
              nombre: "Salsas",
              clase: "ADICIONAL",
              opciones: [{ nombre: "Ketchup", recargo: null }],
            },
          ]),
        );
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
  cargarLaCopia,
  cargarLaVariante,
  cargarLasOpciones,
  cargarUnGrupo,
  copiarLasOpciones,
  guardarElGrupo,
} from "../../apps/web/servidor/opciones";

const PRODUCTO = { id: ID, nombre: "Milanesa", claseDeUso: "VENDIBLE", versionDeOpciones: 4 };
const GRUPO_GUARDADO = {
  id: GRUPO,
  clase: "ADICIONAL",
  esTamano: false,
  nombre: "Salsas",
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  orden: 1,
  activo: true,
  opciones: [
    {
      id: OPCION,
      versionDeOpcionId: "v",
      nombre: "Mayonesa",
      recargo: "10.000000",
      factorDeTamano: "1.000000",
      orden: 1,
      activa: true,
      consumo: [],
    },
  ],
};

const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};
const LIGADO = {
  productoId: ID,
  versionDeOpciones: 4,
  grupoId: null,
  claveDelCambio: CLAVE,
  idsDeOpciones: [],
};

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    ediciones: [],
    copias: [],
    vistasPrevias: [],
    resultado: ok({ versionDeOpciones: 5, yaEstaba: false }),
    producto: PRODUCTO,
    grupos: [GRUPO_GUARDADO],
  });
  revalidadas.length = 0;
});

describe("las lecturas", () => {
  it("las opciones traen una clave de cambio nueva cada vez y la versión que se ve", async () => {
    const a = await cargarLasOpciones(CONTEXTO as never, ID);
    const b = await cargarLasOpciones(CONTEXTO as never, ID);
    expect(a.ok && a.dato.versionDeOpciones).toBe(4);
    expect(a.ok && b.ok && a.dato.claveDelCambio).not.toBe(b.ok && b.dato.claveDelCambio);
    expect(a.ok && a.dato.claveDelCambio).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("la variante para editar, o la hoja de una nueva", async () => {
    const v = await cargarLaVariante(CONTEXTO as never, ID);
    expect(v.ok && v.dato.grupo).toBeNull();
    mundo.grupos = [{ ...GRUPO_GUARDADO, clase: "VARIANTE", esTamano: true }];
    const w = await cargarLaVariante(CONTEXTO as never, ID);
    expect(w.ok && w.dato.grupo?.esTamano).toBe(true);
  });

  it("un grupo para editar, la hoja de uno nuevo y de dónde copiar", async () => {
    const g = await cargarUnGrupo(CONTEXTO as never, ID, GRUPO);
    expect(g.ok && g.dato.grupo?.nombre).toBe("Salsas");
    const nuevo = await cargarUnGrupo(CONTEXTO as never, ID, null);
    expect(nuevo.ok && nuevo.dato.grupo).toBeNull();
    const c = await cargarLaCopia(CONTEXTO as never, ID, null);
    expect(c.ok && c.dato.candidatos).toEqual([{ id: ORIGEN, nombre: "Hamburguesa" }]);
    expect(c.ok && c.dato.origen).toBe(ORIGEN);
    expect(c.ok && c.dato.vistaPrevia).toEqual([
      { nombre: "Salsas", clase: "ADICIONAL", opciones: [{ nombre: "Ketchup", recargo: null }] },
    ]);
    expect(mundo.vistasPrevias).toEqual([{ productoOrigenId: ORIGEN, productoDestinoId: ID }]);
  });
});

describe("guardarElGrupo", () => {
  it("si sale bien, vuelve a las opciones del producto tras escribir una vez con el contexto del servidor", async () => {
    mundo.grupos = [];
    await expect(
      guardarElGrupo(
        LIGADO,
        formulario({
          nombre: "Agregados",
          clase: "ADICIONAL",
          admiteVarias: "on",
          opcion_n0_nombre: "Queso",
          opcion_n0_recargo: "500.00",
        }),
      ),
    ).rejects.toThrow(`${REDIRIGIO} /catalogo/productos/${ID}/opciones`);
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.ediciones).toHaveLength(1);
    expect(mundo.ediciones[0]).toMatchObject({
      productoId: ID,
      versionDeOpcionesEsperada: 4,
      grupos: [
        {
          id: CLAVE,
          clase: "ADICIONAL",
          nombre: "Agregados",
          esObligatorio: false,
          admiteVarias: true,
          seMuestraEnCarta: true,
          opciones: [{ nombre: "Queso", recargo: "500.00", activa: true }],
        },
      ],
    });
    // También al salir bien se pide la pantalla de destino de nuevo: la memoria del navegador no puede mostrar lo viejo.
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/opciones`]);
  });

  it("las casillas: marcada manda «on»; «No figura en la carta» marcada es seMuestraEnCarta falso; lo que no viene es falso", async () => {
    mundo.grupos = [];
    await expect(
      guardarElGrupo(
        LIGADO,
        formulario({
          nombre: "Salsas",
          clase: "INCLUIDA",
          esObligatorio: "on",
          fueraDeLaCarta: "on",
          opcion_n0_nombre: "Queso",
          opcion_n0_recargo: "0.00",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({
      grupos: [
        { clase: "INCLUIDA", esObligatorio: true, admiteVarias: false, seMuestraEnCarta: false },
      ],
    });
    await expect(
      guardarElGrupo(
        LIGADO,
        formulario({
          nombre: "Otro",
          clase: "INCLUIDA",
          opcion_n0_nombre: "A",
          opcion_n0_recargo: "0.00",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[1]).toMatchObject({
      grupos: [{ clase: "INCLUIDA", seMuestraEnCarta: true }],
    });
  });

  it("editar un grupo: las opciones existentes se ligan a los ids de la página, no a lo que diga el formulario", async () => {
    await expect(
      guardarElGrupo(
        { ...LIGADO, grupoId: GRUPO, idsDeOpciones: [OPCION] },
        formulario({
          nombre: "Salsas",
          clase: "ADICIONAL",
          admiteVarias: "on",
          opcion_e0_nombre: "Mayonesa",
          opcion_e0_recargo: "12.00",
          opcion_e1_nombre: "Ajena",
          opcion_e1_recargo: "1.00",
          opcionId: "9",
          opcion_e0_id: "9",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({
      grupos: [{ id: GRUPO, opciones: [{ id: OPCION, nombre: "Mayonesa", recargo: "12.00" }] }],
    });
  });

  it("del formulario no pasan la empresa, la persona, el producto ni la versión que mande el navegador", async () => {
    mundo.grupos = [];
    await expect(
      guardarElGrupo(
        LIGADO,
        formulario({
          nombre: "Agregados",
          clase: "INCLUIDA",
          empresaId: "otra",
          personaId: "x",
          productoId: "otro",
          versionDeOpciones: "99",
          claveDelCambio: "z",
          opcion_n0_nombre: "Queso",
          opcion_n0_recargo: "1.00",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({ productoId: ID, versionDeOpcionesEsperada: 4 });
    expect(JSON.stringify(mundo.ediciones[0])).not.toContain("otra");
  });

  it.each([["falta"], ["VARIANTE"], ["adicional"], ["on"]])(
    "una clase que no es de la lista (%s) no se acepta: sale el genérico, sin escribir",
    async (clase) => {
      mundo.grupos = [];
      const datos = formulario({
        nombre: "Agregados",
        opcion_n0_nombre: "Queso",
        opcion_n0_recargo: "1.00",
        ...(clase === "falta" ? {} : { clase }),
      });
      const r = await guardarElGrupo(LIGADO, datos);
      expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
      expect(mundo.ediciones).toEqual([]);
    },
  );

  it("una fila de opción con el nombre vacío no se guarda (como la maqueta) y una opción guardada con el nombre vaciado no se manda: el caso de uso la desactiva", async () => {
    await expect(
      guardarElGrupo(
        { ...LIGADO, grupoId: GRUPO, idsDeOpciones: [OPCION] },
        formulario({
          nombre: "Salsas",
          clase: "ADICIONAL",
          opcion_e0_nombre: "   ",
          opcion_e0_recargo: "10.00",
          opcion_n0_nombre: "",
          opcion_n0_recargo: "0.00",
          opcion_n1_nombre: "Ketchup",
          opcion_n1_recargo: "5.00",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    // La opción con el nombre vaciado y la fila vacía no figuran en lo que se manda: el caso de uso desactiva lo que falta (nada se borra; se prueba en `opciones-web.test.ts`).
    const [grupo] = (
      mundo.ediciones[0] as { grupos: { opciones: { nombre: string; activa: boolean }[] }[] }
    ).grupos;
    expect(grupo?.opciones.map((o) => o.nombre)).toEqual(["Ketchup"]);
    expect(JSON.stringify(mundo.ediciones[0])).not.toContain("Mayonesa");
    expect(JSON.stringify(mundo.ediciones[0])).not.toContain('"nombre":""');
  });

  it("un nombre que no es texto (un archivo) o que falta es vacío: «Falta el nombre», sin salir del formulario ni escribir", async () => {
    for (const datos of [
      formulario({ clase: "INCLUIDA" }),
      formulario({ clase: "INCLUIDA", nombre: new File(["x"], "n.txt") }),
    ]) {
      const r = await guardarElGrupo(LIGADO, datos);
      expect(r.error).toMatchObject({ codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" });
    }
    expect(mundo.ediciones).toEqual([]);
  });

  it("si el servidor rechaza (otra persona cambió antes), devuelve el error, no redirige y pide la página de nuevo", async () => {
    mundo.grupos = [];
    mundo.resultado = err("OPCIONES_DESACTUALIZADAS");
    const r = await guardarElGrupo(
      LIGADO,
      formulario({
        nombre: "Agregados",
        clase: "INCLUIDA",
        opcion_n0_nombre: "Queso",
        opcion_n0_recargo: "1.00",
      }),
    );
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/opciones`]);
  });

  it("sin permiso (el guard del caso de uso) sale su motivo, sin redirigir", async () => {
    mundo.grupos = [];
    mundo.resultado = err("SIN_PERMISO");
    const r = await guardarElGrupo(
      LIGADO,
      formulario({
        nombre: "Agregados",
        clase: "INCLUIDA",
        opcion_n0_nombre: "Queso",
        opcion_n0_recargo: "1.00",
      }),
    );
    expect(r.error?.codigo).toBe("SIN_PERMISO");
  });

  it("repetir el mismo guardado (doble toque) manda dos pedidos idénticos, con la misma clave: el caso de uso decide y ambos terminan igual", async () => {
    mundo.grupos = [];
    const datos = () =>
      formulario({
        nombre: "Agregados",
        clase: "INCLUIDA",
        opcion_n0_nombre: "Queso",
        opcion_n0_recargo: "1.00",
      });
    await expect(guardarElGrupo(LIGADO, datos())).rejects.toThrow(REDIRIGIO);
    await expect(guardarElGrupo(LIGADO, datos())).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones).toHaveLength(2);
    expect(mundo.ediciones[0]).toEqual(mundo.ediciones[1]);
  });
});

describe("guardarElGrupo: la variante", () => {
  it("la acción la marca como variante; la medida viene de la casilla y el formulario no puede cambiar la clase", async () => {
    mundo.grupos = [];
    await expect(
      guardarElGrupo(
        { ...LIGADO, esVariante: true },
        formulario({
          nombre: "Tamaño",
          esTamano: "on",
          esAdicional: "on",
          esVariante: "no",
          opcion_n0_nombre: "Chico",
          opcion_n0_recargo: "99.00",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({
      grupos: [
        {
          id: CLAVE,
          clase: "VARIANTE",
          esTamano: true,
          esObligatorio: true,
          admiteVarias: false,
          opciones: [{ nombre: "Chico", recargo: "0.00" }],
        },
      ],
    });
  });

  it("sin la casilla no es la medida; sin la marca de la acción es un grupo y esTamano se ignora", async () => {
    mundo.grupos = [];
    await expect(
      guardarElGrupo(
        { ...LIGADO, esVariante: true },
        formulario({ nombre: "Porción", opcion_n0_nombre: "Media" }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[0]).toMatchObject({ grupos: [{ clase: "VARIANTE", esTamano: false }] });
    await expect(
      guardarElGrupo(
        LIGADO,
        formulario({
          nombre: "G",
          clase: "INCLUIDA",
          esTamano: "on",
          opcion_n0_nombre: "A",
          opcion_n0_recargo: "0.00",
        }),
      ),
    ).rejects.toThrow(REDIRIGIO);
    expect(mundo.ediciones[1]).toMatchObject({ grupos: [{ clase: "INCLUIDA", esTamano: false }] });
  });
});

describe("copiarLasOpciones", () => {
  it("si sale bien, vuelve a las opciones tras copiar una vez con el contexto del servidor; el origen es lo único que se toma del formulario", async () => {
    mundo.resultado = ok({ copiaId: CLAVE, yaExistia: false });
    await expect(
      copiarLasOpciones(
        ID,
        4,
        CLAVE,
        formulario({ productoOrigenId: ORIGEN, productoDestinoId: "otro" }),
      ),
    ).rejects.toThrow(`${REDIRIGIO} /catalogo/productos/${ID}/opciones`);
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.copias).toEqual([
      {
        copiaId: CLAVE,
        productoOrigenId: ORIGEN,
        productoDestinoId: ID,
        versionDeOpcionesEsperada: 4,
      },
    ]);
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/opciones`]);
  });

  it("sin origen elegido (falta o no es texto) no copia: el genérico y la pantalla se pide de nuevo", async () => {
    for (const datos of [
      formulario({}),
      formulario({ productoOrigenId: new File(["x"], "n.txt") }),
    ]) {
      const r = await copiarLasOpciones(ID, 4, CLAVE, datos);
      expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    }
    expect(mundo.copias).toEqual([]);
    expect(revalidadas).toEqual([
      `/catalogo/productos/${ID}/opciones`,
      `/catalogo/productos/${ID}/opciones`,
    ]);
  });

  it("si el servidor rechaza, devuelve el error y pide la página de nuevo", async () => {
    mundo.resultado = err("OPCIONES_DESACTUALIZADAS");
    const r = await copiarLasOpciones(ID, 4, CLAVE, formulario({ productoOrigenId: ORIGEN }));
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}/opciones`]);
  });
});
