import { describe, expect, it } from "vitest";
import { armarFichaDeSubmarca } from "../../apps/plataforma/logica/ficha-de-submarca";
import { ASPECTO_POR_DEFECTO, SIN_PROPIOS } from "../../apps/plataforma/logica/submarca";
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
    ultimaConfirmada: null,
    borradorEfectivo: null,
    puedeConfirmarse: { ok: true },
    contraste: null,
    ...parcial,
  } as unknown as FichaDeMarca;
}

const ultima = (numero: number, efectiva: unknown) => ({
  numero,
  vigenteDesde: new Date("2026-01-01T03:00:00.000Z"),
  definicion: {
    nombreVisible: "x",
    tema: { primary: "#112233", "on-primary": "#ffffff", secondary: "#445566", accent: "#aa00bb" },
    aspecto: {
      estilo: "MODERNO",
      superficie: "CALIDA",
      esquinas: "RECTA",
      titulos: "SERIF",
      ingreso: "DIVIDIDO",
    },
  },
  efectiva,
});

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
      propio: SIN_PROPIOS,
    });
  });

  it("sin borrador pero con vigente: el formulario sale de la efectiva, los colores null son vacíos", () => {
    const r = armarFichaDeSubmarca(
      ficha({
        efectiva: definicion("Pedernal Sur", "#112233"),
        ultimaConfirmada: ultima(2, definicion("Pedernal Sur", "#112233")),
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
      propio: {
        colores: { primary: true, onPrimary: true, secondary: true, accent: true },
        aspecto: { estilo: true, superficie: true, esquinas: true, titulos: true, ingreso: true },
      },
    });
    expect(r.formularioDeLaVigente).toEqual(r.formulario);
    expect(r.borrador).toBeNull();
  });

  it("el origen de cada dato se lleva como `propio`: heredado y defecto no lo son", () => {
    const heredado = { tipo: "heredado", marcaId: "m-padre", marcaCodigo: "padre" } as const;
    const base = definicion("Sur", "#112233");
    const r = armarFichaDeSubmarca(
      ficha({
        borradorEfectivo: {
          ...base,
          tema: {
            ...base.tema,
            primary: { valor: "#112233", origen: heredado },
            accent: { valor: "#aa00bb", origen: { tipo: "defecto" } },
          },
          aspecto: {
            ...base.aspecto,
            esquinas: { valor: "SUAVE", origen: { tipo: "defecto" } },
            titulos: { valor: "SERIF", origen: heredado },
          },
        },
      }),
      CATALOGOS,
    );
    expect(r.formulario.propio).toEqual({
      colores: { primary: false, onPrimary: true, secondary: true, accent: false },
      aspecto: { estilo: true, superficie: true, esquinas: false, titulos: false, ingreso: true },
    });
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

  it("el número de la versión nueva es la mayor confirmada más uno, NO la version del borrador", () => {
    const sinNada = armarFichaDeSubmarca(ficha({}), CATALOGOS);
    expect(sinNada.numeroDeLaVersionNueva).toBe(1);
    const conHistoria = armarFichaDeSubmarca(
      ficha({
        versiones: [
          { numero: 1, estado: "REEMPLAZADA" },
          { numero: 3, estado: "PROGRAMADA" },
          { numero: 2, estado: "VIGENTE" },
        ],
        borrador: { id: "b", version: 17, definicion: {} },
      }),
      CATALOGOS,
    );
    expect(conHistoria.numeroDeLaVersionNueva).toBe(4);
    expect(conHistoria.borrador).toEqual({ version: 17 });
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
        texto: "Alguien más cambió el borrador. Recargá para ver la última versión.",
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
