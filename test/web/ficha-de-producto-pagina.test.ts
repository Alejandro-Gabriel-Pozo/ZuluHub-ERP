import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de la ficha de datos de un producto (A1, T2a): lee el id de la dirección, pide la ficha al servidor con el contexto de la empresa y pinta cada situación con su texto
 * del catálogo: los campos según la clase, «Guardar» activo o apagado según el permiso, y los errores (el del guard con su motivo; el genérico para un producto que no está ahí; el
 * inesperado con la referencia y sin el código crudo). Un solo `h1`: el nombre del producto. Sin entrada en la barra: se llega por la dirección.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: { contexto: unknown; id: string }[];
    respuesta: unknown;
    clasificacion: unknown;
    clasificaciones: { contexto: unknown; id: string }[];
    visibilidad: unknown;
    control: unknown;
    pedidosDeControl: string[];
  } => ({
    permisos: null,
    llamadas: [],
    respuesta: null,
    clasificacion: null,
    clasificaciones: [],
    visibilidad: null,
    control: null,
    pedidosDeControl: [],
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/ficha-de-producto", () => ({
  cargarLaFicha: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
  guardarLaFicha: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/servidor/clasificacion", () => ({
  cargarLaClasificacionDelProducto: (contexto: unknown, id: string) => {
    mundo.clasificaciones.push({ contexto, id });
    return Promise.resolve(mundo.clasificacion);
  },
  clasificarElProducto: () => Promise.resolve({ ok: true, dato: {} }),
  crearElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  renombrarElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  moverElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  desactivarElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  reactivarElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
}));
vi.mock("../../apps/web/servidor/control-de-stock", () => ({
  cargarElControlDeStock: (_contexto: unknown, id: string) => {
    mundo.pedidosDeControl.push(id);
    return Promise.resolve(mundo.control);
  },
}));
vi.mock("../../apps/web/servidor/ocultar", () => ({
  cargarLaVisibilidad: () => Promise.resolve(mundo.visibilidad),
  ocultarOMostrar: () => Promise.resolve({ error: null }),
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
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const RUTA = "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/page";
const cargar = (): Promise<{
  default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA);

const html = async (id = ID) => {
  const { default: Pagina } = await cargar();
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
};
const texto = async (id?: string) => (await html(id)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const FICHA = {
  id: ID,
  version: 4,
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  seVende: true,
  admiteControlDeStock: false,
  nombreDeCocina: "MILA",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "10.5",
  seccion: { id: SECCION, nombre: "Minutas", activa: true },
  alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
  secciones: [{ id: SECCION, nombre: "Minutas" }],
};
const CLASIFICACION = {
  productoId: ID,
  vigente: {
    desde: "2026-11-02",
    camino: [
      { id: "d1", nombre: "Restaurante", activo: true },
      { id: "c1", nombre: "Comidas", activo: true },
    ],
  },
  nodos: [
    { id: "d1", padreId: null, nombre: "Restaurante" },
    { id: "c1", padreId: "d1", nombre: "Comidas" },
  ],
};
const responde = (r: Respuesta<unknown>) => {
  mundo.respuesta = r;
};
const puede = (acciones: string[]) => {
  mundo.permisos = {
    ok: true,
    valor: { acciones, modulos: { activos: ["catalogo"], enSoloLectura: [] } },
  };
};

describe("la página de la ficha de datos de un producto", () => {
  beforeEach(() => {
    mundo.llamadas = [];
    mundo.clasificaciones = [];
    mundo.clasificacion = { ok: true, dato: CLASIFICACION };
    mundo.pedidosDeControl = [];
    mundo.control = { ok: true, dato: { controlado: false } };
    responde({ ok: true, dato: FICHA });
    puede(["productos.ver", "productos.editar"]);
    // Por defecto la tarjeta de «Ocultar» no se pudo leer (módulo sin activar): la ficha sigue sin ella.
    mundo.visibilidad = { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") };
  });

  describe("tarjeta de «Ocultar» (A15)", () => {
    const conVidriera = (acciones: string[]) => {
      mundo.permisos = {
        ok: true,
        valor: { acciones, modulos: { activos: ["catalogo", "vidriera"], enSoloLectura: [] } },
      };
    };
    /** El texto de un marcado sin sus etiquetas: se recorre carácter por carácter (nada se «limpia» con una expresión regular). */
    const sinEtiquetas = (marcado: string): string => {
      let dentro = false;
      let texto = "";
      for (const c of marcado) {
        if (c === "<") dentro = true;
        else if (c === ">") dentro = false;
        else if (!dentro) texto += c;
      }
      return texto;
    };
    const botones = (marcado: string) =>
      [...marcado.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map((m) => ({
        texto: sinEtiquetas(m[2] ?? "").trim(),
        apagado: /disabled/.test(m[1] ?? ""),
      }));

    it("sin poder leer dónde está oculto (módulo sin activar, sin permiso) no hay tarjeta: la ficha sigue igual", async () => {
      const t = await texto();
      expect(t).not.toContain("Ocultar");
      expect(t).not.toContain("Volver a mostrar");
    });

    it("gerente o administrador con el producto visible: «Ocultar» y «Ocultar en toda la empresa», activos", async () => {
      conVidriera([
        "productos.ver",
        "vidrieras.ver",
        "vidrieras.marcar_disponibilidad",
        "vidrieras.ocultar_en_empresa",
      ]);
      mundo.visibilidad = { ok: true, dato: { local: false, empresa: false } };
      const b = botones(await html()).filter((x) => /Ocultar/.test(x.texto));
      expect(b).toEqual([
        { texto: "Ocultar", apagado: false },
        { texto: "Ocultar en toda la empresa", apagado: false },
      ]);
    });

    it("operador con el producto oculto en toda la empresa: lo ve y «Volver a mostrar» de la empresa sale apagado; el del local, activo", async () => {
      conVidriera(["productos.ver", "vidrieras.ver", "vidrieras.marcar_disponibilidad"]);
      mundo.visibilidad = { ok: true, dato: { local: false, empresa: true } };
      const marcado = await html();
      expect(marcado).toContain("Oculto en toda la empresa");
      expect(botones(marcado).filter((x) => /Ocultar|Volver/.test(x.texto))).toEqual([
        { texto: "Ocultar", apagado: false },
        { texto: "Volver a mostrar", apagado: true },
      ]);
    });

    it("sin local con el que trabajar solo se ofrece «Ocultar en toda la empresa»", async () => {
      conVidriera([
        "productos.ver",
        "vidrieras.ver",
        "vidrieras.marcar_disponibilidad",
        "vidrieras.ocultar_en_empresa",
      ]);
      mundo.visibilidad = { ok: true, dato: { local: null, empresa: false } };
      expect(botones(await html()).filter((x) => /Ocultar/.test(x.texto))).toEqual([
        { texto: "Ocultar en toda la empresa", apagado: false },
      ]);
    });

    it("si no se pudieron leer los permisos, los botones salen apagados (cierra, no abre)", async () => {
      mundo.permisos = { ok: false, error: "x" };
      mundo.visibilidad = { ok: true, dato: { local: false, empresa: false } };
      expect(botones(await html()).filter((x) => /Ocultar/.test(x.texto))).toEqual([
        { texto: "Ocultar", apagado: true },
        { texto: "Ocultar en toda la empresa", apagado: true },
      ]);
    });
  });

  it("un solo h1, el nombre del producto, y los campos en el orden de la maqueta", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    const rotulos = [
      ...marcado.matchAll(/<(?:label|dt|button)\b[^>]*>(.*?)<\/(?:label|dt|button)>/g),
    ].map((m) =>
      (m[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(rotulos.filter((r) => r !== "" && !/^(Inicio|Cuenta)/.test(r)).slice(-13)).toEqual([
      "¿Qué es?",
      "Nombre",
      "Nombre de cocina",
      "Código interno",
      "Código de barras",
      "Unidad",
      "Alícuota de IVA",
      "Sección de la carta",
      "Guardar",
      // La clasificación comercial (A14) va debajo de los datos: una fila por nivel, «Vigente desde» y «Cambiar».
      "Departamento",
      "Categoría",
      "Vigente desde",
      "Cambiar",
    ]);
  });

  it("la clasificación vigente se ve con su camino y «Vigente desde» en DD/MM/AAAA, y se pide con el contexto del servidor y el id de la dirección", async () => {
    const t = await texto();
    expect(t).toContain("Departamento Restaurante");
    expect(t).toContain("Categoría Comidas");
    expect(t).toContain("Vigente desde 02/11/2026");
    expect(mundo.clasificaciones).toEqual([{ contexto: { id: "contexto" }, id: ID }]);
  });

  it("sin clasificar se ve «Departamento: Sin elegir», sin «Vigente desde»", async () => {
    mundo.clasificacion = { ok: true, dato: { ...CLASIFICACION, vigente: null } };
    const t = await texto();
    expect(t).toContain("Departamento Sin elegir");
    expect(t).not.toContain("Vigente desde");
  });

  it("un nodo desactivado que el producto conserva se ve con «Desactivado»", async () => {
    mundo.clasificacion = {
      ok: true,
      dato: {
        ...CLASIFICACION,
        vigente: {
          desde: "2026-11-02",
          camino: [{ id: "d1", nombre: "Restaurante", activo: false }],
        },
      },
    };
    expect(await texto()).toContain("Desactivado");
  });

  const cambiar = (marcado: string) =>
    /<button\b([^>]*)>(?:<[^>]+>)*Cambiar</.exec(marcado)?.[1] ?? "";

  it("«Cambiar» sale activo con productos.editar y apagado sin él, sin texto nuevo", async () => {
    expect(cambiar(await html())).not.toContain("disabled");
    puede(["productos.ver"]);
    const sinPermiso = await html();
    expect(cambiar(sinPermiso)).toContain("disabled");
    expect(sinPermiso).not.toContain("no está permitida");
  });

  it("sin departamentos cargados «Cambiar» sale apagado y el producto queda «Sin elegir»", async () => {
    mundo.clasificacion = { ok: true, dato: { ...CLASIFICACION, vigente: null, nodos: [] } };
    const marcado = await html();
    expect(cambiar(marcado)).toContain("disabled");
    expect(await texto()).toContain("Sin elegir");
  });

  it("si la clasificación no se pudo leer, sale su error (con su motivo) y la ficha sigue a la vista", async () => {
    mundo.clasificacion = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };
    const t = await texto();
    expect(t).toContain("Esta acción no está permitida");
    expect(t).toContain("Milanesa");
  });

  it("pide la ficha con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await html();
    expect(mundo.llamadas).toEqual([{ contexto: { id: "contexto" }, id: ID }]);
  });

  it("los datos guardados quedan puestos: texto, códigos, alícuota y sección elegidas", async () => {
    const marcado = await html();
    expect(marcado).toContain('value="Milanesa"');
    expect(marcado).toContain('value="MILA"');
    expect(marcado).toContain('value="MIL-1"');
    expect(marcado).toContain('value="12345678"');
    expect(marcado).toMatch(/<option value="10.5" selected[^>]*>10,5 %<\/option>/);
    expect(marcado).toContain(`<option value="${SECCION}" selected`);
    expect(await texto()).toContain("Producto vendible");
  });

  it("«Secciones» es un enlace a la lista de secciones, después del campo de la sección", async () => {
    const marcado = await html();
    expect(marcado).toMatch(/<a [^>]*href="\/catalogo\/secciones"[^>]*>Secciones<\/a>/);
    expect(marcado.indexOf('name="seccionDeCartaId"')).toBeLessThan(
      marcado.indexOf('href="/catalogo/secciones"'),
    );
  });

  it("una clase que no se vende no lleva el enlace «Secciones»", async () => {
    // Con `catalogo` disponible (DEC-0463) la barra también trae un enlace a «Secciones»: se compara con la ficha de algo que se vende y
    // el del formulario es el que tiene que faltar.
    const enlaces = (marcado: string) => marcado.split('href="/catalogo/secciones"').length - 1;
    const deAlgoQueSeVende = enlaces(await html());
    responde({
      ok: true,
      dato: { ...FICHA, claseDeUso: "INSUMO", seVende: false, alicuota: null, seccion: null },
    });
    expect(deAlgoQueSeVende - enlaces(await html())).toBe(1);
  });

  it("la clase y la unidad solo se ven: no son campos del formulario", async () => {
    const marcado = await html();
    expect(marcado).not.toMatch(/name="clase/);
    expect(marcado).not.toMatch(/name="unidad/);
    expect(marcado).not.toMatch(/name="descripcion/);
    expect(marcado.match(/<input[^>]*type="text"/g)).toHaveLength(4);
    expect(marcado.match(/<select/g)).toHaveLength(2);
  });

  it("el nombre del campo de cada dato es el que declara el camino (alicuota, seccionDeCartaId…)", async () => {
    const marcado = await html();
    for (const nombre of [
      "nombre",
      "nombreDeCocina",
      "codigo",
      "codigoDeBarras",
      "alicuota",
      "seccionDeCartaId",
    ]) {
      expect(marcado).toContain(`name="${nombre}"`);
    }
  });

  it("«Guardar» sale activo con productos.editar", async () => {
    expect(await html()).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
    expect(await html()).not.toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("sin productos.editar (un operador) «Guardar» sale apagado, sin texto nuevo", async () => {
    puede(["productos.ver"]);
    const marcado = await html();
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    expect(await texto()).not.toContain("Esta acción no está permitida");
  });

  it("si no se pudieron leer los permisos, «Guardar» sale apagado (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("una clase que no se vende no ofrece nombre de cocina, alícuota ni sección", async () => {
    responde({
      ok: true,
      dato: {
        ...FICHA,
        claseDeUso: "MATERIA_PRIMA",
        seVende: false,
        nombreDeCocina: null,
        alicuota: null,
        seccion: null,
      },
    });
    const marcado = await html();
    const t = await texto();
    expect(t).toContain("Materia prima");
    expect(t).not.toContain("Nombre de cocina");
    expect(t).not.toContain("Alícuota de IVA");
    expect(t).not.toContain("Sección de la carta");
    expect(marcado).not.toMatch(/<select/);
    expect(t).toContain("Código de barras");
  });

  it("un producto que se vende ofrece la solapa «Opciones» (un enlace a sus opciones); una clase que no se vende, no", async () => {
    const marcado = await html();
    expect(marcado).toMatch(
      new RegExp(`<a [^>]*href="/catalogo/productos/${ID}/opciones"[^>]*>Opciones</a>`),
    );
    responde({
      ok: true,
      dato: {
        ...FICHA,
        claseDeUso: "INSUMO",
        seVende: false,
        nombreDeCocina: null,
        alicuota: null,
        seccion: null,
      },
    });
    expect(await html()).not.toContain("/opciones");
  });

  it("una alícuota guardada que el producto no ofrece se ve y su desplegable sale apagado", async () => {
    responde({ ok: true, dato: { ...FICHA, alicuota: "EXENTO" } });
    const marcado = await html();
    expect(marcado).toMatch(
      /<select[^>]*disabled[^>]*name="alicuota"|<select[^>]*name="alicuota"[^>]*disabled/,
    );
    expect(marcado).toContain("EXENTO");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html();
    expect(marcado).not.toContain("<form");
    expect(marcado).not.toContain("MODULO_EN_DESARROLLO");
    expect(await texto()).toContain("Esta función todavía está en desarrollo.");
  });

  it("un producto que no está (ajeno, inexistente) sale como el genérico, sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await html("no-existe")).not.toContain("<form");
    expect(await texto("no-existe")).toContain("Esta acción no está permitida");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const t = await texto();
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("el tilde «Se controla el stock» en la página de la ficha (PR-3)", () => {
  const INSUMO = { ...FICHA, claseDeUso: "INSUMO", seVende: false, admiteControlDeStock: true };
  const conStock = (acciones: string[], activos = ["catalogo", "stock"]) => {
    mundo.permisos = { ok: true, valor: { acciones, modulos: { activos, enSoloLectura: [] } } };
  };
  const casilla = (marcado: string) =>
    /<input[^>]*name="seControlaElStock"[^>]*>/.exec(marcado)?.[0];

  beforeEach(() => {
    mundo.visibilidad = { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") };
    mundo.control = { ok: true, dato: { controlado: false } };
    mundo.pedidosDeControl = [];
    responde({ ok: true, dato: INSUMO });
  });

  it("gerente: insumo sin tildar → casilla «Se controla el stock» desmarcada y activa", async () => {
    conStock(["productos.ver", "productos.editar", "stock.ver", "articulos.controlar"]);
    const marcado = await html();
    expect(await texto()).toContain("Se controla el stock");
    const c = casilla(marcado);
    expect(c).toBeDefined();
    expect(c).not.toMatch(/checked/);
    expect(c).not.toMatch(/disabled/);
    expect(mundo.pedidosDeControl).toContain(ID);
  });

  it("insumo tildado → casilla marcada", async () => {
    conStock(["productos.ver", "productos.editar", "stock.ver", "articulos.controlar"]);
    mundo.control = { ok: true, dato: { controlado: true } };
    expect(casilla(await html())).toMatch(/checked/);
  });

  it("operador: se ve apagada, con su estado real", async () => {
    conStock(["productos.ver", "stock.ver"]);
    mundo.control = { ok: true, dato: { controlado: true } };
    const c = casilla(await html());
    expect(c).toMatch(/checked/);
    expect(c).toMatch(/disabled/);
  });

  it("si la lectura falla (módulo sin activar, sin permiso) no se dibuja nada: ni casilla ni aviso", async () => {
    conStock(["productos.ver", "productos.editar"]);
    mundo.control = { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") };
    const marcado = await html();
    expect(casilla(marcado)).toBeUndefined();
    expect(await texto()).not.toContain("Se controla el stock");
    expect(marcado).not.toContain("MODULO_EN_DESARROLLO");
  });

  it("una clase que no se controla o un producto desactivado (admiteControlDeStock en falso): no se dibuja y ni se consulta el control", async () => {
    conStock(["productos.ver", "productos.editar", "stock.ver", "articulos.controlar"]);
    responde({ ok: true, dato: { ...INSUMO, admiteControlDeStock: false } });
    expect(casilla(await html())).toBeUndefined();
    expect(mundo.pedidosDeControl).toEqual([]);
  });
});
