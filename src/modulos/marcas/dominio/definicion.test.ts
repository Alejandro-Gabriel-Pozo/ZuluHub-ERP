import { describe, expect, it } from "vitest";
import { planId } from "../../../primitivas/identificadores/marca";
import { ASPECTO_POR_DEFECTO, type AspectoCompleto } from "./aspecto";
import {
  DEFINICION_VACIA,
  completarDefinicion,
  resolverDefinicion,
  validarLogo,
  validarModulosIniciales,
  validarNombreVisible,
  type DefinicionDeMarca,
} from "./definicion";

const PLAN_A = planId("plan-a");
const PLAN_B = planId("plan-b");

const definicion = (cambios: Partial<DefinicionDeMarca> = {}): DefinicionDeMarca => ({
  ...DEFINICION_VACIA,
  ...cambios,
});

const PRINCIPAL: DefinicionDeMarca = {
  nombreVisible: "ZuluHub",
  tema: {
    primary: "#1a73e8",
    "on-primary": "#ffffff",
    secondary: "#5f6368",
    accent: "#d93025",
  },
  aspecto: { estilo: "CLASICO", esquinas: "RECTA" },
  logo: "/marcas/zuluhub/logo.png",
  vocabulario: { "rol.gerente.nombre": "Gerente general" },
  modulosIniciales: ["reservas"],
  planPorDefectoId: PLAN_A,
};

/** El aspecto de la principal con los defectos aplicados donde no define. */
const PRINCIPAL_COMPLETA: AspectoCompleto = {
  ...ASPECTO_POR_DEFECTO,
  estilo: "CLASICO",
  esquinas: "RECTA",
};

describe("DEFINICION_VACIA", () => {
  it("no define nada", () => {
    expect(DEFINICION_VACIA).toEqual({
      nombreVisible: null,
      tema: {},
      aspecto: {},
      logo: null,
      vocabulario: {},
      modulosIniciales: null,
      planPorDefectoId: null,
    });
  });
});

describe("resolverDefinicion (herencia)", () => {
  it("sin eslabones, o con eslabones sin versión vigente, no define nada", () => {
    const nada = {
      nombreVisible: null,
      tema: {},
      aspecto: {},
      logo: null,
      vocabulario: {},
      modulosIniciales: null,
      planPorDefectoId: null,
    };
    expect(resolverDefinicion([])).toEqual(nada);
    expect(resolverDefinicion([null])).toEqual(nada);
    expect(resolverDefinicion([null, null, null])).toEqual(nada);
    expect(resolverDefinicion([DEFINICION_VACIA, DEFINICION_VACIA])).toEqual(nada);
  });

  it("una marca sola se resuelve a sí misma", () => {
    expect(resolverDefinicion([PRINCIPAL])).toEqual(PRINCIPAL);
  });

  it("lo que el producto no define lo trae la principal, campo por campo", () => {
    const producto = definicion({ nombreVisible: "Mi Calendario", logo: "/marcas/mc/logo.webp" });
    expect(resolverDefinicion([producto, PRINCIPAL])).toEqual({
      ...PRINCIPAL,
      nombreVisible: "Mi Calendario",
      logo: "/marcas/mc/logo.webp",
    });
  });

  it("el tema se hereda token por token", () => {
    const producto = definicion({ tema: { primary: "#336699", accent: "#00aa00" } });
    expect(resolverDefinicion([producto, PRINCIPAL]).tema).toEqual({
      primary: "#336699",
      "on-primary": "#ffffff",
      secondary: "#5f6368",
      accent: "#00aa00",
    });
  });

  it("el aspecto se hereda token por token: el padre define el estilo y la hija solo las esquinas", () => {
    const padre = definicion({ aspecto: { estilo: "MODERNO", titulos: "SERIF" } });
    const hija = definicion({ aspecto: { esquinas: "REDONDEADA" } });
    expect(resolverDefinicion([hija, padre]).aspecto).toEqual({
      estilo: "MODERNO",
      esquinas: "REDONDEADA",
      titulos: "SERIF",
    });
    // Y el valor de la hija gana al del padre cuando ambos definen el mismo token.
    const pisa = definicion({ aspecto: { estilo: "LUDICO" } });
    expect(resolverDefinicion([pisa, padre]).aspecto.estilo).toBe("LUDICO");
  });

  it("el aspecto sobre tres eslabones: marca, padre y abuelo, token por token, sin completar los defectos", () => {
    const abuelo = definicion({
      aspecto: { estilo: "CLASICO", superficie: "FRIA", ingreso: "DIVIDIDO" },
    });
    const padre = definicion({ aspecto: { superficie: "CALIDA", titulos: "SERIF" } });
    const hijo = definicion({ aspecto: { estilo: "MODERNO" } });
    expect(resolverDefinicion([hijo, padre, abuelo]).aspecto).toEqual({
      estilo: "MODERNO",
      superficie: "CALIDA",
      titulos: "SERIF",
      ingreso: "DIVIDIDO",
    });
    // Un token que nadie define no aparece (el defecto se aplica al completar, no al resolver).
    expect(Object.keys(resolverDefinicion([hijo, padre, abuelo]).aspecto)).not.toContain(
      "esquinas",
    );
  });

  it("el aspecto no se mezcla con el tema ni con otros campos al resolver", () => {
    const hija = definicion({ tema: { primary: "#336699" }, aspecto: { estilo: "LUDICO" } });
    const r = resolverDefinicion([hija, PRINCIPAL]);
    expect(r.tema.primary).toBe("#336699");
    expect(Object.keys(r.tema).sort()).toEqual(["accent", "on-primary", "primary", "secondary"]);
    expect(r.aspecto).toEqual({ estilo: "LUDICO", esquinas: "RECTA" });
  });

  it("la cadena de tres eslabones: gana la marca, luego el padre, luego el abuelo", () => {
    const abuelo = PRINCIPAL;
    const padre = definicion({
      nombreVisible: "Padre",
      tema: { primary: "#111111", secondary: "#222222" },
      planPorDefectoId: PLAN_B,
    });
    const hijo = definicion({ tema: { primary: "#333333" } });
    const resuelta = resolverDefinicion([hijo, padre, abuelo]);
    expect(resuelta.nombreVisible).toBe("Padre");
    expect(resuelta.tema).toEqual({
      primary: "#333333",
      "on-primary": "#ffffff",
      secondary: "#222222",
      accent: "#d93025",
    });
    expect(resuelta.logo).toBe("/marcas/zuluhub/logo.png");
    expect(resuelta.modulosIniciales).toEqual(["reservas"]);
    expect(resuelta.planPorDefectoId).toBe(PLAN_B);
  });

  it("un eslabón null no corta la cadena: se saltea", () => {
    const hijo = definicion({ nombreVisible: "Hijo" });
    expect(resolverDefinicion([hijo, null, PRINCIPAL])).toEqual({
      ...PRINCIPAL,
      nombreVisible: "Hijo",
    });
  });

  it("módulos iniciales: [] es una definición (solo administración) y no hereda; null sí hereda", () => {
    expect(
      resolverDefinicion([definicion({ modulosIniciales: [] }), PRINCIPAL]).modulosIniciales,
    ).toEqual([]);
    expect(
      resolverDefinicion([definicion({ modulosIniciales: null }), PRINCIPAL]).modulosIniciales,
    ).toEqual(["reservas"]);
    expect(
      resolverDefinicion([definicion({ modulosIniciales: ["stock"] }), PRINCIPAL]).modulosIniciales,
    ).toEqual(["stock"]);
  });

  it("el vocabulario se hereda clave por clave y llega ya resuelto (solo válido, con el texto canónico)", () => {
    const producto = definicion({
      vocabulario: {
        "rol.operador.nombre": "  Mozo ",
        "vieja.clave.huerfana": "x",
        "rol.gerente.nombre": "<b>",
      },
    });
    expect(resolverDefinicion([producto, PRINCIPAL]).vocabulario).toEqual({
      "rol.operador.nombre": "Mozo",
      "rol.gerente.nombre": "Gerente general",
    });
  });

  it("no modifica sus entradas ni devuelve objetos compartidos mutables", () => {
    const hijo = definicion({ tema: { primary: "#333333" } });
    const copia = structuredClone([hijo, PRINCIPAL]);
    resolverDefinicion([hijo, PRINCIPAL]);
    expect([hijo, PRINCIPAL]).toEqual(copia);
  });
});

describe("completarDefinicion", () => {
  it("una definición completa devuelve todo, con el nombre de la propia marca", () => {
    const resuelta = resolverDefinicion([PRINCIPAL]);
    expect(completarDefinicion(PRINCIPAL, resuelta)).toEqual({
      ok: true,
      valor: { ...PRINCIPAL, aspecto: PRINCIPAL_COMPLETA },
    });
  });

  it("un producto que define solo el nombre se completa con la herencia", () => {
    const producto = definicion({ nombreVisible: "Mi Calendario" });
    const resuelta = resolverDefinicion([producto, PRINCIPAL]);
    expect(completarDefinicion(producto, resuelta)).toEqual({
      ok: true,
      valor: { ...PRINCIPAL, nombreVisible: "Mi Calendario", aspecto: PRINCIPAL_COMPLETA },
    });
  });

  it("módulos iniciales [] cuenta como definido", () => {
    const propia = { ...PRINCIPAL, modulosIniciales: [] };
    expect(completarDefinicion(propia, resolverDefinicion([propia]))).toEqual({
      ok: true,
      valor: { ...propia, aspecto: PRINCIPAL_COMPLETA },
    });
  });

  it("el aspecto nunca es un hueco: sin ningún eslabón que lo defina toma los defectos y la definición se completa igual", () => {
    const propia = { ...PRINCIPAL, aspecto: {} };
    const r = completarDefinicion(propia, resolverDefinicion([propia]));
    expect(r.ok && r.valor.aspecto).toEqual(ASPECTO_POR_DEFECTO);
    expect(r.ok && r.valor.aspecto).not.toBe(ASPECTO_POR_DEFECTO);
  });

  it("la principal sin nada define nada: faltan todos los campos, en orden", () => {
    expect(completarDefinicion(DEFINICION_VACIA, resolverDefinicion([DEFINICION_VACIA]))).toEqual({
      ok: false,
      error: [
        "nombre_visible",
        "tema.primary",
        "tema.on-primary",
        "tema.secondary",
        "tema.accent",
        "logo",
        "modulos_iniciales",
        "plan_por_defecto",
      ],
    });
  });

  it("el nombre lo define la propia marca: heredarlo de la principal no alcanza", () => {
    const producto = definicion();
    const resuelta = resolverDefinicion([producto, PRINCIPAL]);
    expect(resuelta.nombreVisible).toBe("ZuluHub");
    expect(completarDefinicion(producto, resuelta)).toEqual({
      ok: false,
      error: ["nombre_visible"],
    });
  });

  it("cada hueco se informa por separado, también cada token del tema", () => {
    const sinTema = { ...PRINCIPAL, tema: { primary: "#1a73e8", accent: "#d93025" } };
    expect(completarDefinicion(sinTema, resolverDefinicion([sinTema]))).toEqual({
      ok: false,
      error: ["tema.on-primary", "tema.secondary"],
    });
    for (const [campo, esperado] of [
      [{ logo: null }, "logo"],
      [{ modulosIniciales: null }, "modulos_iniciales"],
      [{ planPorDefectoId: null }, "plan_por_defecto"],
      [{ nombreVisible: null }, "nombre_visible"],
    ] as const) {
      const propia = { ...PRINCIPAL, ...campo };
      expect(completarDefinicion(propia, resolverDefinicion([propia]))).toEqual({
        ok: false,
        error: [esperado],
      });
    }
  });
});

describe("validarNombreVisible", () => {
  it("acepta un nombre de 1 a 60 caracteres y lo devuelve canónico", () => {
    expect(validarNombreVisible("  Mi Calendario ")).toEqual({ ok: true, valor: "Mi Calendario" });
    expect(validarNombreVisible("a")).toEqual({ ok: true, valor: "a" });
    expect(validarNombreVisible("a".repeat(60))).toEqual({ ok: true, valor: "a".repeat(60) });
  });

  it.each([
    ["vacío", ""],
    ["en blanco", "   "],
    ["61 caracteres", "a".repeat(61)],
    ["con menor", "Mi <b>Calendario"],
    ["con mayor", "Mi > Calendario"],
    ["con salto de línea", "Mi\nCalendario"],
    ["con ancho cero", "Mi​Calendario"],
    ["con marca bidireccional", "Mi‮Calendario"],
  ])("rechaza un nombre %s", (_nombre, texto) => {
    expect(validarNombreVisible(texto)).toEqual({ ok: false, error: "NOMBRE_DE_MARCA_INVALIDO" });
  });
});

describe("validarLogo", () => {
  it.each([
    "/marcas/zuluhub/logo.png",
    "/marcas/mi-calendario/logo-2.webp",
    "/marcas/a/b.png",
    "/marcas/0/9.webp",
    "/marcas/a-b-c/d-e-f.png",
  ])("acepta %s", (ruta) => {
    expect(validarLogo(ruta)).toEqual({ ok: true, valor: ruta });
  });

  it.each([
    ["SVG, que puede llevar scripts", "/marcas/zuluhub/logo.svg"],
    ["JPEG", "/marcas/zuluhub/logo.jpg"],
    ["GIF", "/marcas/zuluhub/logo.gif"],
    ["sin extensión", "/marcas/zuluhub/logo"],
    ["extensión en mayúsculas", "/marcas/zuluhub/logo.PNG"],
    ["doble extensión", "/marcas/zuluhub/logo.png.svg"],
    ["URL externa", "https://otro.test/marcas/zuluhub/logo.png"],
    ["URL sin protocolo", "//otro.test/marcas/zuluhub/logo.png"],
    ["data URI", "data:image/png;base64,AAAA"],
    ["subida de carpeta", "/marcas/../secreto/logo.png"],
    ["subida en el archivo", "/marcas/zuluhub/../logo.png"],
    ["una carpeta de más", "/marcas/zuluhub/otra/logo.png"],
    ["una carpeta de menos", "/marcas/logo.png"],
    ["otra raíz", "/imagenes/zuluhub/logo.png"],
    ["sin barra inicial", "marcas/zuluhub/logo.png"],
    ["mayúsculas en la carpeta", "/marcas/ZuluHub/logo.png"],
    ["guion bajo", "/marcas/zulu_hub/logo.png"],
    ["carpeta vacía", "/marcas//logo.png"],
    ["archivo vacío", "/marcas/zuluhub/.png"],
    ["con consulta", "/marcas/zuluhub/logo.png?x=1"],
    ["con fragmento", "/marcas/zuluhub/logo.png#x"],
    ["con espacio", "/marcas/zuluhub/lo go.png"],
    ["con salto de línea al final", "/marcas/zuluhub/logo.png\n"],
    ["con barra invertida", "/marcas\\zuluhub/logo.png"],
    ["vacío", ""],
  ])("rechaza %s", (_nombre, ruta) => {
    expect(validarLogo(ruta)).toEqual({ ok: false, error: "LOGO_INVALIDO" });
  });
});

describe("validarModulosIniciales", () => {
  const CATALOGO = {
    administracion: { estado: "disponible", obligatorio: true },
    reservas: { estado: "disponible", obligatorio: false },
    stock: { estado: "disponible", obligatorio: false },
    comandas: { estado: "en_desarrollo", obligatorio: false },
  } as const;

  it("acepta módulos disponibles y no obligatorios, en el orden dado", () => {
    expect(validarModulosIniciales(CATALOGO, ["stock", "reservas"])).toEqual({
      ok: true,
      valor: ["stock", "reservas"],
    });
  });

  it("la lista vacía es válida: solo administración", () => {
    expect(validarModulosIniciales(CATALOGO, [])).toEqual({ ok: true, valor: [] });
  });

  it("quita los repetidos y deja la primera aparición", () => {
    expect(validarModulosIniciales(CATALOGO, ["stock", "reservas", "stock", "reservas"])).toEqual({
      ok: true,
      valor: ["stock", "reservas"],
    });
  });

  it("rechaza una clave que el catálogo no tiene, con su nombre", () => {
    expect(validarModulosIniciales(CATALOGO, ["reservas", "inexistente"])).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "inexistente" },
    });
  });

  it("rechaza un módulo obligatorio (siempre está) y uno en desarrollo (todavía no se puede)", () => {
    expect(validarModulosIniciales(CATALOGO, ["administracion"])).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "administracion" },
    });
    expect(validarModulosIniciales(CATALOGO, ["comandas"])).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "comandas" },
    });
  });

  it("una clave como las propias de todo objeto no es un módulo", () => {
    for (const modulo of ["constructor", "toString", "__proto__"]) {
      expect(validarModulosIniciales(CATALOGO, [modulo])).toEqual({
        ok: false,
        error: { codigo: "MODULO_DESCONOCIDO", modulo },
      });
    }
  });

  it("informa el primer problema", () => {
    expect(validarModulosIniciales(CATALOGO, ["comandas", "inexistente"])).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "comandas" },
    });
  });

  it("con el catálogo real de hoy (solo administración, obligatoria) no hay ningún módulo inicial posible", () => {
    expect(
      validarModulosIniciales({ administracion: { estado: "disponible", obligatorio: true } }, []),
    ).toEqual({
      ok: true,
      valor: [],
    });
  });
});
