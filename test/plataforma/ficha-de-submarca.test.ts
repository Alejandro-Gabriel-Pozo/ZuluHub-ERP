import { describe, expect, it } from "vitest";
import { armarFichaDeSubmarca } from "../../apps/plataforma/logica/ficha-de-submarca";
import { ASPECTO_POR_DEFECTO } from "../../apps/plataforma/logica/submarca";
import type {
  FichaDeMarca,
  VistaDeCatalogosDeMarca,
} from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";

const propio = { tipo: "propio" } as const;
const campo = <T>(valor: T) => ({ valor, origen: propio });

const CATALOGOS = {
  tema: {
    tokens: ["primary", "on-primary", "secondary", "accent"],
    formato: "#rrggbb",
    patron: "^#[0-9a-f]{6}$",
    pares: [
      { par: "on-primary/primary", minimo: 4.5 },
      { par: "accent/fondo", minimo: 3 },
      { par: "accent/superficie", minimo: 3 },
    ],
  },
  aspecto: [],
  superficies: [{ valor: "NEUTRA", fondo: "#fafafa", superficie: "#ffffff" }],
  vocabulario: [],
} as unknown as VistaDeCatalogosDeMarca;

function definicion(nombre: string | null, primary: string | null) {
  return {
    nombreVisible: campo(nombre),
    tema: {
      primary: campo(primary),
      "on-primary": campo("#ffffff"),
      secondary: campo(null),
      accent: campo("#aa00bb"),
    },
    aspecto: {
      estilo: campo("MODERNO"),
      superficie: campo("CALIDA"),
      esquinas: campo("RECTA"),
      titulos: campo("SERIF"),
      ingreso: campo("DIVIDIDO"),
    },
  };
}

function ficha(parcial: Record<string, unknown>): FichaDeMarca {
  return {
    marca: { id: "id-1", codigo: "sur", estado: "ACTIVA" },
    cadena: [],
    versiones: [],
    borrador: null,
    dominios: [],
    clavesDeTextoHuerfanas: [],
    efectiva: null,
    borradorEfectivo: null,
    puedeConfirmarse: { ok: true },
    contraste: null,
    ...parcial,
  } as unknown as FichaDeMarca;
}

describe("armarFichaDeSubmarca", () => {
  it("sin nada: formulario vacío, aspecto por defecto, nombre = código", () => {
    const r = armarFichaDeSubmarca(ficha({}), CATALOGOS);
    expect(r).toMatchObject({
      id: "id-1",
      codigo: "sur",
      nombre: "sur",
      estado: "ACTIVA",
      versionVigente: null,
      borrador: null,
      hayProgramada: false,
      formularioDeLaVigente: null,
      contrasteDelBorrador: null,
      puedeConfirmarse: { ok: true },
    });
    expect(r.formulario).toEqual({
      nombreVisible: "",
      colores: { primary: "", onPrimary: "", secondary: "", accent: "" },
      aspecto: ASPECTO_POR_DEFECTO,
    });
  });

  it("sin borrador pero con vigente: el formulario sale de la efectiva, los colores null son vacíos", () => {
    const r = armarFichaDeSubmarca(
      ficha({
        efectiva: definicion("Pedernal Sur", "#112233"),
        versiones: [{ numero: 2, estado: "VIGENTE" }],
      }),
      CATALOGOS,
    );
    expect(r.nombre).toBe("Pedernal Sur");
    expect(r.versionVigente).toBe(2);
    expect(r.formulario).toEqual({
      nombreVisible: "Pedernal Sur",
      colores: { primary: "#112233", onPrimary: "#ffffff", secondary: "", accent: "#aa00bb" },
      aspecto: {
        estilo: "MODERNO",
        superficie: "CALIDA",
        esquinas: "RECTA",
        titulos: "SERIF",
        ingreso: "DIVIDIDO",
      },
    });
    expect(r.formularioDeLaVigente).toEqual(r.formulario);
    expect(r.borrador).toBeNull();
  });

  it("con borrador: el formulario sale del borrador efectivo y trae su versión", () => {
    const r = armarFichaDeSubmarca(
      ficha({
        efectiva: definicion("Viejo", "#000000"),
        borradorEfectivo: definicion("Nuevo", "#abcdef"),
        borrador: { id: "b", version: 4, definicion: {} },
      }),
      CATALOGOS,
    );
    expect(r.borrador).toEqual({ version: 4 });
    expect(r.formulario.nombreVisible).toBe("Nuevo");
    expect(r.formulario.colores.primary).toBe("#abcdef");
    expect(r.formularioDeLaVigente?.nombreVisible).toBe("Viejo");
  });

  it("hayProgramada sale de las versiones PROGRAMADA", () => {
    const con = armarFichaDeSubmarca(
      ficha({
        versiones: [
          { numero: 1, estado: "VIGENTE" },
          { numero: 2, estado: "PROGRAMADA" },
        ],
      }),
      CATALOGOS,
    );
    const sin = armarFichaDeSubmarca(
      ficha({
        versiones: [
          { numero: 1, estado: "ANTERIOR" },
          { numero: 2, estado: "VIGENTE" },
          { numero: 3, estado: "SIN_EFECTO" },
        ],
      }),
      CATALOGOS,
    );
    expect(con.hayProgramada).toBe(true);
    expect(sin.hayProgramada).toBe(false);
    expect(sin.versionVigente).toBe(2);
  });

  it("puedeConfirmarse con error: lo traduce y nunca deja el código técnico", () => {
    const conocido = armarFichaDeSubmarca(
      ficha({ puedeConfirmarse: { ok: false, error: "VERSION_DESACTUALIZADA" } }),
      CATALOGOS,
    );
    expect(conocido.puedeConfirmarse).toEqual({
      ok: false,
      error: {
        tipo: "PANTALLA_VIEJA",
        texto: "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
      },
    });
    const raro = armarFichaDeSubmarca(
      ficha({ puedeConfirmarse: { ok: false, error: { codigo: "CODIGO_QUE_NADIE_CONOCE" } } }),
      CATALOGOS,
    );
    expect(raro.puedeConfirmarse).toEqual({ ok: false, error: { tipo: "INESPERADO" } });
  });

  it("el contraste del borrador va sin redondear y con texto null; el catálogo sale de los catálogos", () => {
    const r = armarFichaDeSubmarca(
      ficha({
        contraste: [
          { par: "on-primary/primary", razon: 4.499, minimo: 4.5, cumple: false },
          { par: "accent/fondo", razon: null, minimo: 3, cumple: null },
        ],
      }),
      CATALOGOS,
    );
    expect(r.contrasteDelBorrador).toEqual([
      { par: "on-primary/primary", razon: 4.499, minimo: 4.5, cumple: false, texto: null },
      { par: "accent/fondo", razon: null, minimo: 3, cumple: null, texto: null },
    ]);
    expect(r.catalogo).toEqual({
      superficies: [{ valor: "NEUTRA", fondo: "#fafafa", superficie: "#ffffff" }],
      pares: [
        { par: "on-primary/primary", minimo: 4.5 },
        { par: "accent/fondo", minimo: 3 },
        { par: "accent/superficie", minimo: 3 },
      ],
    });
  });
});
