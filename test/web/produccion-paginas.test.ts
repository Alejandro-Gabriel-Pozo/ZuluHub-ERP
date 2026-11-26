import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de producción (lista de órdenes y ficha de una orden): leen lo único que viene de la dirección (el filtro y el id), piden al servidor con el contexto de la empresa y pintan
 * cada situación con su texto del catálogo: la lista con sus filtros y sus filas (con el filtro pedido), la ficha con «Cancelar la orden» o «Anular la orden» solo si el servidor deja, y los
 * errores (el del guard con su motivo; el genérico para una orden que no está; el inesperado con la referencia y sin el código crudo). Un solo `h1`. Sin entrada en la barra de la página.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    pedidos: { quien: string; contexto: unknown; dato: unknown }[];
    lista: unknown;
    orden: unknown;
    oferta: unknown;
    paraCerrar: unknown;
  } => ({
    permisos: null,
    pedidos: [],
    lista: null,
    orden: null,
    oferta: null,
    paraCerrar: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/produccion", () => ({
  cargarLasOrdenes: (contexto: unknown, entrada: unknown) => {
    mundo.pedidos.push({ quien: "lista", contexto, dato: entrada });
    return Promise.resolve(mundo.lista);
  },
  cargarLaOrden: (contexto: unknown, id: string) => {
    mundo.pedidos.push({ quien: "orden", contexto, dato: id });
    return Promise.resolve(mundo.orden);
  },
  cargarLaNuevaOrdenDeLaSucursal: (contexto: unknown) => {
    mundo.pedidos.push({ quien: "nueva", contexto, dato: null });
    return Promise.resolve(mundo.oferta);
  },
  cargarLaOrdenParaElCierre: (contexto: unknown, id: string) => {
    mundo.pedidos.push({ quien: "cierre", contexto, dato: id });
    return Promise.resolve(mundo.paraCerrar);
  },
  cerrarLaOrdenDelFormulario: () => Promise.resolve({ error: null }),
  abrirLaOrdenDelFormulario: () => Promise.resolve({ error: null }),
  cancelarLaOrdenDeLaFicha: () => Promise.resolve({ error: null }),
  anularLaOrdenDeLaFicha: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {},
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: { id: "contexto" },
        },
      },
    }),
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const RUTA_DE_LA_LISTA = "../../apps/web/app/s/app/(operacion)/catalogo/produccion/page";
const RUTA_DE_LA_FICHA = "../../apps/web/app/s/app/(operacion)/catalogo/produccion/[id]/page";
const RUTA_DEL_CIERRE = "../../apps/web/app/s/app/(operacion)/catalogo/produccion/[id]/cerrar/page";
const RUTA_DE_LA_NUEVA = "../../apps/web/app/s/app/(operacion)/catalogo/produccion/nueva/page";

type Params = Record<string, string | string[] | undefined>;
const cargarLista = (): Promise<{
  default: (p: { searchParams: Promise<Params> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA_DE_LA_LISTA);
const cargarFicha = (): Promise<{
  default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA_DE_LA_FICHA);

const htmlDelCierre = async (id = ID) => {
  const { default: Pagina } = (await import(/* @vite-ignore */ RUTA_DEL_CIERRE)) as {
    default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
  };
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
};
const cargarNueva = (): Promise<{ default: () => Promise<unknown> }> =>
  import(/* @vite-ignore */ RUTA_DE_LA_NUEVA);
const htmlDeLaNueva = async () => {
  const { default: Pagina } = await cargarNueva();
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};

const htmlDeLaLista = async (params: Params = {}) => {
  const { default: Pagina } = await cargarLista();
  return renderToStaticMarkup(
    (await Pagina({ searchParams: Promise.resolve(params) })) as ReactNode,
  );
};
const htmlDeLaFicha = async (id = ID) => {
  const { default: Pagina } = await cargarFicha();
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
};
const aTexto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const ORDENES = {
  ordenes: [
    {
      id: ID,
      numero: 14,
      estado: "ABIERTA",
      nombre: "Masa de medialuna",
      cantidad: "10.0000",
      unidadId: "KILOGRAMO",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      numero: 13,
      estado: "CERRADA",
      nombre: "Medialuna",
      cantidad: "100.0000",
      unidadId: "UNIDAD",
    },
  ],
};
const FICHA = {
  id: ID,
  numero: 14,
  estado: "ABIERTA",
  nombre: "Masa de medialuna",
  unidadId: "KILOGRAMO",
  cantidadEsperada: "10.0000",
  cantidadObtenida: null,
  mermaDeLote: null,
  recetaCambiada: false,
  vence: null,
  lote: null,
  renglones: [{ nombre: "Harina 000", esperado: "6.0000", real: null, unidadId: "KILOGRAMO" }],
};
const respondeLista = (r: Respuesta<unknown>) => {
  mundo.lista = r;
};
const respondeOrden = (r: Respuesta<unknown>) => {
  mundo.orden = r;
};
const puede = (acciones: string[]) => {
  mundo.permisos = {
    ok: true,
    valor: { acciones, modulos: { activos: ["produccion"], enSoloLectura: [] } },
  };
};

beforeEach(() => {
  mundo.pedidos = [];
  respondeLista({ ok: true, dato: ORDENES });
  respondeOrden({ ok: true, dato: FICHA });
  mundo.paraCerrar = {
    ok: true,
    dato: {
      id: ID,
      numero: 14,
      nombre: "Masa de medialuna",
      unidadId: "KILOGRAMO",
      cantidadEsperada: "16.0000",
      renglones: [
        { nombre: "Harina 000", esperado: "12.0000", unidadId: "KILOGRAMO" },
        { nombre: "Manteca", esperado: "4.0000", unidadId: "KILOGRAMO" },
      ],
    },
  };
  mundo.oferta = {
    ok: true,
    dato: {
      productos: [
        { id: ID, nombre: "Masa de medialuna", unidadId: "KILOGRAMO" },
        { id: "22222222-2222-4222-8222-222222222222", nombre: "Pan", unidadId: "UNIDAD" },
      ],
      depositoId: "33333333-3333-4333-8333-333333333333",
    },
  };
  puede(["transformaciones.ver", "transformaciones.cancelar", "transformaciones.anular"]);
});

describe("la página de la lista de órdenes de producción", () => {
  it("un solo h1, «Producción», con los filtros y una fila por orden que lleva a su ficha", async () => {
    const html = await htmlDeLaLista();
    expect([...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Producción"]);
    const t = aTexto(html);
    expect(t).toContain("Todas");
    expect(t).toContain("Orden 14 · Masa de medialuna");
    expect(t).toContain("10 Kilogramo");
    expect(t).toContain("Orden 13 · Medialuna");
    expect(t).toContain("100 Unidad");
    expect(html).toContain(`href="/catalogo/produccion/${ID}"`);
    expect(html).toContain('href="/catalogo/produccion?estado=ABIERTA"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });

  it("pide la lista con el contexto del servidor y el filtro de la dirección, y nada más", async () => {
    await htmlDeLaLista({ estado: "ABIERTA" });
    expect(mundo.pedidos).toEqual([
      { quien: "lista", contexto: { id: "contexto" }, dato: { estado: "ABIERTA" } },
    ]);
  });

  it("un filtro que no es una opción conocida vuelve a «Todas»: pide sin filtro", async () => {
    await htmlDeLaLista({ estado: "CERRADA" });
    expect(mundo.pedidos).toEqual([
      { quien: "lista", contexto: { id: "contexto" }, dato: { estado: "" } },
    ]);
  });

  it("el filtro pedido queda marcado como el actual", async () => {
    const html = await htmlDeLaLista({ estado: "ABIERTA" });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Abiertas</);
  });

  it("sin órdenes, «Sin resultados»", async () => {
    respondeLista({ ok: true, dato: { ordenes: [] } });
    expect(aTexto(await htmlDeLaLista())).toContain("Sin resultados");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin lista ni filtros", async () => {
    respondeLista({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const html = await htmlDeLaLista();
    expect(html).not.toContain("MODULO_EN_DESARROLLO");
    expect(aTexto(html)).toContain("Esta función todavía está en desarrollo.");
    expect(html).not.toContain("estado=ABIERTA");
  });

  it("sin sucursal elegida (el genérico) sale como «Esta acción no está permitida»", async () => {
    respondeLista({ ok: false, error: errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA") });
    expect(aTexto(await htmlDeLaLista())).toContain("Esta acción no está permitida");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    respondeLista({
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = aTexto(await htmlDeLaLista());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("«Nueva orden» en la lista", () => {
  it("con transformaciones.abrir hay un enlace «Nueva orden» a la pantalla de alta; sin el permiso, no", async () => {
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    const con = await htmlDeLaLista();
    expect(con).toContain('href="/catalogo/produccion/nueva"');
    expect(aTexto(con)).toContain("Nueva orden");
    puede(["transformaciones.ver", "transformaciones.cancelar"]);
    const sin = await htmlDeLaLista();
    expect(sin).not.toContain("/catalogo/produccion/nueva");
    expect(aTexto(sin)).not.toContain("Nueva orden");
  });

  it("con la lista en error no hay enlace aunque pueda abrir", async () => {
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    respondeLista({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    expect(await htmlDeLaLista()).not.toContain("/catalogo/produccion/nueva");
  });
});

describe("la página de «Nueva orden» de producción", () => {
  it("un solo h1, «Nueva orden», con el producto (con su unidad), la cantidad y «Abrir orden»; Cancelar vuelve a la lista", async () => {
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    const html = await htmlDeLaNueva();
    expect([...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Nueva orden"]);
    const t = aTexto(html);
    expect(t).toContain("Producto");
    expect(t).toContain("Masa de medialuna (Kilogramo)");
    expect(t).toContain("Pan (Unidad)");
    expect(t).toContain("Cantidad a producir");
    expect(html).toContain('name="productoId"');
    expect(html).toContain('name="cantidad"');
    expect(html).toMatch(/<a[^>]*href="\/catalogo\/produccion"[^>]*>Cancelar</);
    // No hay campo de depósito, unidad, sucursal ni empresa: los decide el servidor.
    for (const nombre of ["depositoId", "unidadId", "sucursalId", "empresaId", "clave"]) {
      expect(html).not.toContain(`name="${nombre}"`);
    }
  });

  it("pide lo que se ofrece con el contexto del servidor, y nada más", async () => {
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    await htmlDeLaNueva();
    expect(mundo.pedidos).toEqual([{ quien: "nueva", contexto: { id: "contexto" }, dato: null }]);
  });

  it("«Abrir orden» sale apagado sin transformaciones.abrir (solo una ayuda: el servidor decide)", async () => {
    puede(["transformaciones.ver"]);
    const html = await htmlDeLaNueva();
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Abrir orden</);
  });

  it("sin nada que producir, el genérico y sin formulario", async () => {
    mundo.oferta = { ok: true, dato: { productos: [], depositoId: "d" } };
    const html = await htmlDeLaNueva();
    expect(aTexto(html)).toContain("Esta acción no está permitida");
    expect(html).not.toContain("<form");
  });

  it("el motivo del guard sale con su texto y sin formulario; un fallo inesperado, con su referencia", async () => {
    mundo.oferta = { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") };
    const html = await htmlDeLaNueva();
    expect(aTexto(html)).toContain("Esta función todavía está en desarrollo.");
    expect(html).not.toContain("<form");
    mundo.oferta = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const t = aTexto(await htmlDeLaNueva());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("«Cerrar con lo real» en la ficha", () => {
  it("una orden abierta con transformaciones.cerrar ofrece el enlace a su pantalla de cierre; sin el permiso, no", async () => {
    puede(["transformaciones.ver", "transformaciones.cerrar"]);
    const con = await htmlDeLaFicha();
    expect(con).toContain(`href="/catalogo/produccion/${ID}/cerrar"`);
    expect(aTexto(con)).toContain("Cerrar con lo real");
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    const sin = await htmlDeLaFicha();
    expect(sin).not.toContain("/cerrar");
    expect(aTexto(sin)).not.toContain("Cerrar con lo real");
  });

  it("una orden cerrada no lo ofrece aunque pueda cerrar", async () => {
    puede(["transformaciones.ver", "transformaciones.cerrar", "transformaciones.anular"]);
    respondeOrden({ ok: true, dato: { ...FICHA, estado: "CERRADA", cantidadObtenida: "9.5000" } });
    expect(await htmlDeLaFicha()).not.toContain("/cerrar");
  });
});

describe("la página de «Cerrar con lo real»", () => {
  it("un solo h1, «Cerrar con lo real», con un campo por ingrediente (con lo esperado), la cantidad obtenida, el vencimiento y «Cerrar la orden»; Cancelar vuelve a la ficha", async () => {
    puede(["transformaciones.ver", "transformaciones.cerrar"]);
    const html = await htmlDelCierre();
    expect([...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Cerrar con lo real",
    ]);
    const t = aTexto(html);
    expect(t).toContain("Masa de medialuna");
    expect(t).toContain("Consumió");
    expect(t).toContain("Harina 000 (Kilogramo)");
    expect(t).toContain("Manteca (Kilogramo)");
    expect(t).toContain("Cantidad obtenida (Kilogramo)");
    expect(t).toContain("Vence");
    expect(t).toContain("Cerrar la orden");
    expect(html.match(/name="consumos"/g)).toHaveLength(2);
    expect(html).toContain('name="obtenido"');
    expect(html).toContain('name="vence"');
    expect(html).toMatch(new RegExp(`<a[^>]*href="/catalogo/produccion/${ID}"[^>]*>Cancelar<`));
    // Lo que decide el servidor no es un campo.
    for (const nombre of ["productoId", "unidadId", "ordenId", "clave", "empresaId"]) {
      expect(html).not.toContain(`name="${nombre}"`);
    }
  });

  it("pide la orden con el contexto del servidor y el id de la dirección, y nada más", async () => {
    puede(["transformaciones.ver", "transformaciones.cerrar"]);
    await htmlDelCierre();
    expect(mundo.pedidos).toEqual([{ quien: "cierre", contexto: { id: "contexto" }, dato: ID }]);
  });

  it("«Cerrar la orden» sale apagado sin transformaciones.cerrar (solo una ayuda: el servidor decide)", async () => {
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    expect(await htmlDelCierre()).toMatch(/<button[^>]*disabled[^>]*>Cerrar la orden</);
  });

  it("una orden que no está o ya no está abierta (el genérico), el motivo del guard y un fallo inesperado salen sin formulario", async () => {
    mundo.paraCerrar = { ok: false, error: errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA") };
    const generico = await htmlDelCierre();
    expect(aTexto(generico)).toContain("Esta acción no está permitida");
    expect(generico).not.toContain("<form");
    mundo.paraCerrar = { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") };
    expect(aTexto(await htmlDelCierre())).toContain("Esta función todavía está en desarrollo.");
    mundo.paraCerrar = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const t = aTexto(await htmlDelCierre());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la página de la ficha de una orden de producción", () => {
  it("un solo h1, «Orden N», con el producto, el estado y «Consume»", async () => {
    const html = await htmlDeLaFicha();
    expect([...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Orden 14"]);
    const t = aTexto(html);
    expect(t).toContain("Masa de medialuna");
    expect(t).toContain("10 Kilogramo");
    expect(t).toContain("Abierta");
    expect(t).toContain("Consume");
    expect(t).toContain("Harina 000");
    expect(t).toContain("6 Kilogramo");
  });

  it("pide la orden con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await htmlDeLaFicha();
    expect(mundo.pedidos).toEqual([{ quien: "orden", contexto: { id: "contexto" }, dato: ID }]);
  });

  it("una orden abierta ofrece «Cancelar la orden» y no «Anular la orden»", async () => {
    const t = aTexto(await htmlDeLaFicha());
    expect(t).toContain("Cancelar la orden");
    expect(t).not.toContain("Anular la orden");
  });

  it("una orden cerrada ofrece «Anular la orden» y no «Cancelar la orden»", async () => {
    respondeOrden({
      ok: true,
      dato: { ...FICHA, estado: "CERRADA", cantidadObtenida: "9.5000", lote: "OP-14" },
    });
    const t = aTexto(await htmlDeLaFicha());
    expect(t).toContain("Anular la orden");
    expect(t).not.toContain("Cancelar la orden");
    expect(t).toContain("Lote");
    expect(t).toContain("OP-14");
  });

  it("sin transformaciones.cancelar ni anular (un operador) no hay botones: abre y mira", async () => {
    puede(["transformaciones.ver", "transformaciones.abrir"]);
    expect(aTexto(await htmlDeLaFicha())).not.toMatch(/Cancelar la orden|Anular la orden/);
    respondeOrden({ ok: true, dato: { ...FICHA, estado: "CERRADA", cantidadObtenida: "9.5000" } });
    expect(aTexto(await htmlDeLaFicha())).not.toMatch(/Cancelar la orden|Anular la orden/);
  });

  it("si no se pudieron leer los permisos, no hay botones (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(aTexto(await htmlDeLaFicha())).not.toMatch(/Cancelar la orden|Anular la orden/);
  });

  it("una orden cancelada o anulada no ofrece ningún botón", async () => {
    for (const estado of ["CANCELADA", "ANULADA"]) {
      respondeOrden({ ok: true, dato: { ...FICHA, estado } });
      expect(aTexto(await htmlDeLaFicha())).not.toMatch(/Cancelar la orden|Anular la orden/);
    }
  });

  it("el aviso de receta cambiada sale en una abierta", async () => {
    respondeOrden({ ok: true, dato: { ...FICHA, recetaCambiada: true } });
    expect(aTexto(await htmlDeLaFicha())).toContain("La receta cambió desde que abriste la orden");
  });

  it("el motivo del guard sale con su texto y sin la ficha", async () => {
    respondeOrden({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const html = await htmlDeLaFicha();
    expect(aTexto(html)).toContain("Esta función todavía está en desarrollo.");
    expect(html).not.toContain("Consume");
  });

  it("una orden que no está (ajena, inexistente) sale como el genérico, sin botones", async () => {
    respondeOrden({ ok: false, error: errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA") });
    const t = aTexto(await htmlDeLaFicha("no-existe"));
    expect(t).toContain("Esta acción no está permitida");
    expect(t).not.toMatch(/Cancelar la orden|Anular la orden/);
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    respondeOrden({
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = aTexto(await htmlDeLaFicha());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});
