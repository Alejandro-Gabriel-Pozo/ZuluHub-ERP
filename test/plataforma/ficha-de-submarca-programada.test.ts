import { describe, expect, it } from "vitest";
import { armarFichaDeSubmarca } from "../../apps/plataforma/logica/ficha-de-submarca";
import { cambiosDelBorrador, SIN_PROPIOS } from "../../apps/plataforma/logica/submarca";
import type {
  FichaDeMarca,
  VistaDeCatalogosDeMarca,
} from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";

/**
 * La pantalla de submarca sin borrador parte de la ÚLTIMA confirmada (la que copia el primer borrador al guardar),
 * aunque sea un cambio programado; lo que rige hoy queda aparte.
 */
const propio = { tipo: "propio" } as const;
const heredado = { tipo: "heredado", marcaId: "m-padre", marcaCodigo: "padre" } as const;
const defecto = { tipo: "defecto" } as const;
const campo = (valor: unknown, origen: unknown = propio) => ({ valor, origen });

const CATALOGOS = {
  superficies: [],
  tema: { pares: [] },
} as unknown as VistaDeCatalogosDeMarca;

function efectiva(nombre: string, primary: string, estilo: string) {
  return {
    nombreVisible: campo(nombre),
    tema: {
      primary: campo(primary),
      "on-primary": campo("#ffffff"),
      secondary: campo(null),
      accent: campo("#aa00bb"),
    },
    aspecto: {
      estilo: campo(estilo),
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

const HOY = efectiva("Hoy", "#000000", "MODERNO");
// La programada define solo el nombre, el principal y el estilo; lo demás lo trae la herencia o el defecto.
const PROGRAMADA = {
  numero: 2,
  vigenteDesde: new Date("2026-11-15T03:00:00.000Z"),
  definicion: {
    nombreVisible: "Mañana",
    tema: { primary: "#abcdef" },
    aspecto: { estilo: "LUDICO" },
  },
  efectiva: {
    nombreVisible: campo("Mañana"),
    tema: {
      primary: campo("#abcdef"),
      "on-primary": campo("#ffffff", heredado),
      secondary: campo(null, defecto),
      accent: campo("#aa00bb", heredado),
    },
    aspecto: {
      estilo: campo("LUDICO"),
      superficie: campo("NEUTRA", defecto),
      esquinas: campo("SUAVE", defecto),
      titulos: campo("SANS", heredado),
      ingreso: campo("CENTRADO", defecto),
    },
  },
};
const VERSIONES = [
  { numero: 1, estado: "VIGENTE" },
  { numero: 2, estado: "PROGRAMADA" },
];
const conProgramada = (extra: Record<string, unknown> = {}) =>
  ficha({ efectiva: HOY, ultimaConfirmada: PROGRAMADA, versiones: VERSIONES, ...extra });

describe("armarFichaDeSubmarca: parte de la última confirmada", () => {
  it("el formulario y los propio salen de la última (programada), no de la vigente", () => {
    const r = armarFichaDeSubmarca(conProgramada(), CATALOGOS);
    expect(r.formulario.nombreVisible).toBe("Mañana");
    expect(r.formulario.colores.primary).toBe("#abcdef");
    expect(r.formulario.aspecto).toMatchObject({ estilo: "LUDICO", superficie: "NEUTRA" });
    expect(r.formulario.propio).toEqual({
      colores: { primary: true, onPrimary: false, secondary: false, accent: false },
      aspecto: { estilo: true, superficie: false, esquinas: false, titulos: false, ingreso: false },
    });
    expect(r.formularioDeLaVigente?.nombreVisible).toBe("Hoy");
    expect(r.formularioDeLaVigente?.colores.primary).toBe("#000000");
    expect(r.partidaProgramadaDesde).toBe("15/11/2026");
  });

  it("la fecha del aviso es el día argentino, no el del instante en UTC", () => {
    const r = armarFichaDeSubmarca(
      conProgramada({
        ultimaConfirmada: { ...PROGRAMADA, vigenteDesde: new Date("2026-12-01T03:00:00.000Z") },
      }),
      CATALOGOS,
    );
    expect(r.partidaProgramadaDesde).toBe("01/12/2026");
  });

  it("con borrador: el formulario sale del borrador y no hay aviso de partida", () => {
    const r = armarFichaDeSubmarca(
      conProgramada({
        borradorEfectivo: efectiva("Borrador", "#123456", "CLASICO"),
        borrador: { id: "b", version: 1, definicion: {} },
      }),
      CATALOGOS,
    );
    expect(r.formulario.nombreVisible).toBe("Borrador");
    expect(r.formulario.colores.primary).toBe("#123456");
    expect(r.partidaProgramadaDesde).toBeNull();
  });

  it("si la última es la vigente no hay aviso; sin ninguna confirmada el formulario queda vacío", () => {
    const vigente = armarFichaDeSubmarca(
      ficha({
        efectiva: HOY,
        ultimaConfirmada: { ...PROGRAMADA, numero: 1, efectiva: HOY },
        versiones: [{ numero: 1, estado: "VIGENTE" }],
      }),
      CATALOGOS,
    );
    expect(vigente.partidaProgramadaDesde).toBeNull();
    const ninguna = armarFichaDeSubmarca(ficha({}), CATALOGOS);
    expect(ninguna.partidaProgramadaDesde).toBeNull();
    expect(ninguna.formulario.nombreVisible).toBe("");
    expect(ninguna.formulario.propio).toEqual(SIN_PROPIOS);
  });
});

describe("cambiosDelBorrador partiendo de una programada", () => {
  const r = armarFichaDeSubmarca(conProgramada(), CATALOGOS);

  it("editar un color manda lo propio de la programada más lo editado, y no congela lo heredado", () => {
    const editado = { ...r.formulario, colores: { ...r.formulario.colores, secondary: "#334155" } };
    expect(cambiosDelBorrador(r.formulario, editado)).toEqual({
      tema: { primary: "#abcdef", secondary: "#334155" },
    });
  });

  it("editar el aspecto manda el estilo propio de la programada más lo editado", () => {
    const editado = {
      ...r.formulario,
      aspecto: { ...r.formulario.aspecto, esquinas: "REDONDEADA" as const },
    };
    expect(cambiosDelBorrador(r.formulario, editado)).toEqual({
      aspecto: { estilo: "LUDICO", esquinas: "REDONDEADA" },
    });
  });
});
