import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { validarVocabulario } from "../../src/capacidades/vocabulario/vocabulario";
import { COLOR_DEL_TEMA } from "../../src/modulos/marcas/publico";
import {
  crearConsultasDeMarcasYPlanes,
  type ConsultasDeMarcasYPlanes,
} from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import type { TxDeConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import {
  crearConsultasDePlataforma,
  type ConsultasDePlataforma,
} from "../../src/plataforma/consultas/consultas";
import type { TxDeConsultasDePlataforma } from "../../src/plataforma/consultas/contrato";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";
import { comoAdministrador, conRol, lecturaFalsa, transaccionesDe } from "./apoyo-de-soporte";

/**
 * Los dos catálogos de solo lectura de la consola (`catalogosDeMarca` y `catalogoDePerillas`): sin base de
 * datos, porque salen del código. El contenido se fija a mano a propósito: si el código cambia una lista cerrada,
 * un texto o una perilla, estas pruebas obligan a mirar qué le llega a la web.
 */

/** Una transacción en la que solo responde el guard: pasado el guard, tocar cualquier otra cosa lanza. */
function soloElGuard(rol: "ADMIN" | "SOPORTE" | null) {
  const accesos: string[] = [];
  const tx = new Proxy({} as TxDeConsultasDeMarcasYPlanes, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacionDePlataforma") return conRol(rol);
      throw new Error(`un catálogo no lee ${String(propiedad)}`);
    },
  });
  return { tx, accesos };
}

function marcaYPlanes(rol: "ADMIN" | "SOPORTE" | null = "SOPORTE"): ConsultasDeMarcasYPlanes {
  return crearConsultasDeMarcasYPlanes({
    transacciones: transaccionesDe(soloElGuard(rol).tx),
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
  });
}

function plataforma(
  catalogoDePerillas: Parameters<typeof crearConsultasDePlataforma>[0]["catalogoDePerillas"],
  rol: "ADMIN" | "SOPORTE" | null = "SOPORTE",
): ConsultasDePlataforma {
  const tx: TxDeConsultasDePlataforma = {
    soporte: lecturaFalsa(),
    autorizacionDePlataforma: conRol(rol),
  };
  return crearConsultasDePlataforma({
    transacciones: transaccionesDe(tx),
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeEmpresa: CATALOGO_DE_MODULOS,
    catalogoDePerillas,
  });
}

describe("catalogosDeMarca", () => {
  it("lo ven ADMIN y SOPORTE; sin administrador vigente, SIN_PERMISO", async () => {
    for (const rol of ["ADMIN", "SOPORTE"] as const) {
      expect((await marcaYPlanes(rol).catalogosDeMarca(comoAdministrador)).ok, rol).toBe(true);
    }
    expect(await marcaYPlanes(null).catalogosDeMarca(comoAdministrador)).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("no lee nada de la transacción más que al administrador", async () => {
    const { tx, accesos } = soloElGuard("ADMIN");
    const consultas = crearConsultasDeMarcasYPlanes({
      transacciones: transaccionesDe(tx),
      reglas: REGLAS_DE_PLATAFORMA,
      catalogoDeModulos: MODULOS_DE_PRUEBA,
      catalogoDePerillas: PERILLAS_DE_PRUEBA,
    });
    expect((await consultas.catalogosDeMarca(comoAdministrador)).ok).toBe(true);
    expect(accesos).toEqual(["autorizacionDePlataforma"]);
  });

  it("el tema: los cuatro tokens, el formato #rrggbb y los pares con su mínimo", async () => {
    const r = await marcaYPlanes().catalogosDeMarca(comoAdministrador);
    expect(r.ok && r.valor.tema).toEqual({
      tokens: ["primary", "on-primary", "secondary", "accent"],
      formato: "#rrggbb",
      patron: "^#[0-9a-f]{6}$",
      pares: [
        { par: "on-primary/primary", minimo: 4.5 },
        { par: "accent/fondo", minimo: 3 },
        { par: "accent/superficie", minimo: 3 },
      ],
    });
    const patron = new RegExp(r.ok ? r.valor.tema.patron : "");
    expect(patron.source).toBe(COLOR_DEL_TEMA.source);
    expect(patron.test("#0f766e")).toBe(true);
    for (const malo of ["#0F766E", "#fff", "0f766e", "rgb(0,0,0)", "#0f766e ", "#0f766g"]) {
      expect(patron.test(malo), malo).toBe(false);
    }
  });

  it("el aspecto: cada lista cerrada con sus valores y su defecto", async () => {
    const r = await marcaYPlanes().catalogosDeMarca(comoAdministrador);
    expect(r.ok && r.valor.aspecto).toEqual([
      {
        token: "estilo",
        valores: ["CLARO_CON_BORDES", "MODERNO", "CLASICO", "LUDICO"],
        porDefecto: "CLARO_CON_BORDES",
      },
      { token: "superficie", valores: ["NEUTRA", "CALIDA", "FRIA"], porDefecto: "NEUTRA" },
      { token: "esquinas", valores: ["RECTA", "SUAVE", "REDONDEADA"], porDefecto: "SUAVE" },
      { token: "titulos", valores: ["SANS", "SERIF"], porDefecto: "SANS" },
      { token: "ingreso", valores: ["DIVIDIDO", "CENTRADO", "CON_IMAGEN"], porDefecto: "CENTRADO" },
    ]);
  });

  it("las superficies con sus colores de fondo y de tarjetas", async () => {
    const r = await marcaYPlanes().catalogosDeMarca(comoAdministrador);
    expect(r.ok && r.valor.superficies).toEqual([
      { valor: "NEUTRA", fondo: "#ffffff", superficie: "#f3f5f7" },
      { valor: "CALIDA", fondo: "#fbf7f1", superficie: "#f3eadc" },
      { valor: "FRIA", fondo: "#f5f8fc", superficie: "#e6edf6" },
    ]);
  });

  it("el vocabulario: todas las claves del catálogo, ordenadas, con texto por defecto, largo máximo y marcadores", async () => {
    const r = await marcaYPlanes().catalogosDeMarca(comoAdministrador);
    const vocabulario = r.ok ? r.valor.vocabulario : [];
    const claves = vocabulario.map((t) => t.texto);
    expect(claves).toEqual(Object.keys(CATALOGO_DE_TEXTOS).sort());
    const texto = (clave: string) => vocabulario.find((t) => t.texto === clave);
    // Sin largo ni marcadores declarados: 80 y ninguno.
    expect(texto("rol.gerente.nombre")).toEqual({
      texto: "rol.gerente.nombre",
      porDefecto: "Gerente",
      largoMaximo: 80,
      marcadores: [],
    });
    // Con largo propio y con un marcador.
    expect(texto("error.limite_del_plan")).toEqual({
      texto: "error.limite_del_plan",
      porDefecto: "El plan de la empresa llegó a su límite: {limite}.",
      largoMaximo: 160,
      marcadores: ["limite"],
    });
    // Cada entrada repite lo que dice el catálogo, sin inventar ni perder nada.
    for (const t of vocabulario) {
      const definicion: {
        porDefecto: string;
        largoMaximo?: number;
        marcadores?: readonly string[];
      } = CATALOGO_DE_TEXTOS[t.texto];
      expect(t.porDefecto).toBe(definicion.porDefecto);
      expect(t.largoMaximo).toBe(definicion.largoMaximo ?? 80);
      expect([...t.marcadores]).toEqual([...(definicion.marcadores ?? [])]);
    }
  });

  it("lo que el catálogo informa es lo que el guardado del borrador acepta: cada texto por defecto es un reemplazo válido de sí mismo", async () => {
    const r = await marcaYPlanes().catalogosDeMarca(comoAdministrador);
    for (const t of r.ok ? r.valor.vocabulario : []) {
      expect(t.porDefecto.length, t.texto).toBeLessThanOrEqual(t.largoMaximo);
      expect(validarVocabulario({ [t.texto]: t.porDefecto }).ok, t.texto).toBe(true);
    }
  });
});

describe("catalogoDePerillas", () => {
  it("lo ven ADMIN y SOPORTE; sin administrador vigente, SIN_PERMISO", async () => {
    for (const rol of ["ADMIN", "SOPORTE"] as const) {
      expect(
        (await plataforma(CATALOGO_DE_PERILLAS, rol).catalogoDePerillas(comoAdministrador)).ok,
      ).toBe(true);
    }
    expect(
      await plataforma(CATALOGO_DE_PERILLAS, null).catalogoDePerillas(comoAdministrador),
    ).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("el catálogo real, por clave: tipo, ámbito, valor base, requiere y módulo dueño", async () => {
    const r = await plataforma(CATALOGO_DE_PERILLAS).catalogoDePerillas(comoAdministrador);
    expect(r.ok && r.valor.perillas).toEqual([
      {
        perilla: "combos",
        tipo: "INTERRUPTOR",
        ambito: "EMPRESA",
        valorBase: { tipo: "INTERRUPTOR", encendida: false },
        requiere: null,
        modulo: "catalogo",
      },
      {
        perilla: "elecciones_reutilizables",
        tipo: "INTERRUPTOR",
        ambito: "EMPRESA",
        valorBase: { tipo: "INTERRUPTOR", encendida: false },
        requiere: null,
        modulo: "catalogo",
      },
      {
        perilla: "empresas_por_tenant",
        tipo: "LIMITE",
        ambito: "TENANT",
        valorBase: { tipo: "LIMITE", limite: 1 },
        requiere: null,
        modulo: "administracion",
      },
      {
        perilla: "recetas_con_merma",
        tipo: "INTERRUPTOR",
        ambito: "EMPRESA",
        valorBase: { tipo: "INTERRUPTOR", encendida: false },
        requiere: null,
        modulo: "stock",
      },
      {
        perilla: "recetas_por_tamano",
        tipo: "INTERRUPTOR",
        ambito: "EMPRESA",
        valorBase: { tipo: "INTERRUPTOR", encendida: false },
        requiere: null,
        modulo: "stock",
      },
      {
        perilla: "sub_recetas",
        tipo: "INTERRUPTOR",
        ambito: "EMPRESA",
        valorBase: { tipo: "INTERRUPTOR", encendida: false },
        requiere: null,
        modulo: "stock",
      },
      {
        perilla: "variantes_y_grupos_de_precio",
        tipo: "INTERRUPTOR",
        ambito: "EMPRESA",
        valorBase: { tipo: "INTERRUPTOR", encendida: false },
        requiere: null,
        modulo: "catalogo",
      },
    ]);
  });

  it("el catálogo inyectado manda: ordena por clave y trae `requiere` y los tres ámbitos", async () => {
    const r = await plataforma(PERILLAS_DE_PRUEBA).catalogoDePerillas(comoAdministrador);
    const perillas = r.ok ? r.valor.perillas : [];
    const claves = perillas.map((p) => p.perilla);
    expect(claves).toEqual(Object.keys(PERILLAS_DE_PRUEBA).sort());
    const de = (clave: string) => perillas.find((p) => p.perilla === clave);
    expect(de("confirmacion_por_sena")).toMatchObject({
      tipo: "INTERRUPTOR",
      requiere: "reserva_provisoria",
      valorBase: { tipo: "INTERRUPTOR", encendida: false },
    });
    expect(de("con_sello")?.valorBase).toEqual({ tipo: "INTERRUPTOR", encendida: true });
    expect(de("cajas_por_sucursal")).toMatchObject({ ambito: "SUCURSAL", requiere: null });
    expect(new Set(perillas.map((p) => p.ambito))).toEqual(
      new Set(["TENANT", "EMPRESA", "SUCURSAL"]),
    );
    expect(new Set(perillas.map((p) => p.tipo))).toEqual(new Set(["INTERRUPTOR", "LIMITE"]));
  });

  it("un catálogo vacío es una lista vacía", async () => {
    const r = await plataforma({}).catalogoDePerillas(comoAdministrador);
    expect(r).toEqual({ ok: true, valor: { perillas: [] } });
  });
});
