import { describe, expect, it } from "vitest";
import { fecha } from "../../../../test/utilidades/facturacion";
import {
  LARGO_MAXIMO_DEL_TEXTO,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  claveDePagina,
  criteriosDeListado,
  leerClaveDePagina,
  type ErrorDeCriterios,
  type PedidoDeListado,
} from "./criterios-de-listado";
import type { ClaveDeListado, FiltroDeListado } from "../persistencia/lecturas-de-comprobantes";

const ID = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const CREADO_EN = "2026-10-12T15:30:45.123456Z";
const clave = (creadoEn = CREADO_EN, id = ID) => `${creadoEn}|${id}`;

const VACIO: FiltroDeListado = {
  estado: null,
  tipo: null,
  ambiente: null,
  desde: null,
  hasta: null,
  texto: null,
  despuesDe: null,
  limite: LIMITE_POR_DEFECTO,
};

function criterios(pedido: PedidoDeListado) {
  const r = criteriosDeListado(pedido);
  if (!r.ok) throw new Error(`tenía que ser válido: ${r.error}`);
  return r.valor;
}
const error = (pedido: PedidoDeListado): ErrorDeCriterios | null => {
  const r = criteriosDeListado(pedido);
  return r.ok ? null : r.error;
};

describe("criteriosDeListado: valores por defecto y filtros", () => {
  it("sin pedido: 20 por página, sin filtros, y los descartados quedan afuera (estado null)", () => {
    expect(LIMITE_POR_DEFECTO).toBe(20);
    expect(LIMITE_MAXIMO).toBe(50);
    expect(criterios({})).toEqual(VACIO);
  });

  it("estado, tipo y ambiente pasan tal cual", () => {
    expect(
      criterios({ estado: "DESCARTADO", tipo: "NOTA_CREDITO_B", ambiente: "PRODUCCION" }),
    ).toEqual({ ...VACIO, estado: "DESCARTADO", tipo: "NOTA_CREDITO_B", ambiente: "PRODUCCION" });
    expect(criterios({ estado: "AUTORIZADO" }).estado).toBe("AUTORIZADO");
    expect(criterios({ tipo: "FACTURA_A" }).tipo).toBe("FACTURA_A");
    expect(criterios({ ambiente: "HOMOLOGACION" }).ambiente).toBe("HOMOLOGACION");
  });

  it("el rango de fechas: cada punta sola, ambas, y el mismo día de punta a punta", () => {
    const d = fecha("2026-10-01");
    const h = fecha("2026-10-31");
    expect(criterios({ desde: d })).toEqual({ ...VACIO, desde: d });
    expect(criterios({ hasta: h })).toEqual({ ...VACIO, hasta: h });
    expect(criterios({ desde: d, hasta: h })).toEqual({ ...VACIO, desde: d, hasta: h });
    expect(criterios({ desde: d, hasta: d })).toEqual({ ...VACIO, desde: d, hasta: d });
  });

  it("un rango dado vuelta es un error, aunque sea por un solo día", () => {
    expect(error({ desde: fecha("2026-10-31"), hasta: fecha("2026-10-01") })).toBe(
      "FECHAS_INVERTIDAS",
    );
    expect(error({ desde: fecha("2026-10-02"), hasta: fecha("2026-10-01") })).toBe(
      "FECHAS_INVERTIDAS",
    );
  });
});

describe("criteriosDeListado: el límite", () => {
  it("entre 1 y 50 pasa; el que se pide es el que se lee", () => {
    for (const limite of [1, 2, 20, 49, 50]) {
      expect(criterios({ limite }).limite).toBe(limite);
    }
  });

  it("0, 51, negativos, decimales y NaN o infinito son un error", () => {
    for (const limite of [0, -1, 51, 100, 1.5, 0.5, Number.NaN, Infinity, -Infinity]) {
      expect(error({ limite }), String(limite)).toBe("LIMITE_INVALIDO");
    }
  });
});

describe("criteriosDeListado: el texto de búsqueda", () => {
  it("sin texto, vacío o solo blancos: no se busca", () => {
    expect(criterios({}).texto).toBeNull();
    expect(criterios({ texto: "" }).texto).toBeNull();
    expect(criterios({ texto: "   \t " }).texto).toBeNull();
  });

  it("un nombre se busca como nombre, sin los blancos de los extremos", () => {
    expect(criterios({ texto: "Ana" }).texto).toEqual({ nombre: "Ana", documento: null });
    expect(criterios({ texto: "  Ana Pérez " }).texto).toEqual({
      nombre: "Ana Pérez",
      documento: null,
    });
  });

  it("lo que puede ser un documento se busca también como documento, sin separadores", () => {
    expect(criterios({ texto: "30-70853393-5" }).texto).toEqual({
      nombre: "30-70853393-5",
      documento: "30708533935",
    });
    expect(criterios({ texto: "12.345.678" }).texto).toEqual({
      nombre: "12.345.678",
      documento: "12345678",
    });
    expect(criterios({ texto: "12 345" }).texto).toEqual({ nombre: "12 345", documento: "12345" });
    expect(criterios({ texto: "7" }).texto).toEqual({ nombre: "7", documento: "7" });
    expect(criterios({ texto: "0123" }).texto).toEqual({ nombre: "0123", documento: "0123" });
  });

  it("un texto con letras, o sin ningún dígito, no es un documento", () => {
    for (const texto of ["Local 1", "1a", "a1", "30-7085x", "-", "...", " - . "]) {
      expect(criterios({ texto }).texto?.documento, texto).toBeNull();
    }
  });

  it("hasta 80 caracteres (ya sin los blancos) entra; uno más, no", () => {
    expect(LARGO_MAXIMO_DEL_TEXTO).toBe(80);
    const justo = "a".repeat(80);
    expect(criterios({ texto: justo }).texto?.nombre).toBe(justo);
    expect(criterios({ texto: `  ${justo}  ` }).texto?.nombre).toBe(justo);
    expect(error({ texto: "a".repeat(81) })).toBe("TEXTO_DEMASIADO_LARGO");
    expect(error({ texto: ` ${"a".repeat(81)}` })).toBe("TEXTO_DEMASIADO_LARGO");
  });
});

describe("la clave de la página", () => {
  it("se arma con el instante (microsegundos incluidos) y el id, y se lee igual", () => {
    const k: ClaveDeListado = { creadoEn: CREADO_EN, id: ID as ClaveDeListado["id"] };
    expect(claveDePagina(k)).toBe(`${CREADO_EN}|${ID}`);
    expect(leerClaveDePagina(claveDePagina(k))).toEqual(k);
  });

  it("`despuesDe` la lleva al filtro, y sin él no hay clave", () => {
    expect(criterios({ despuesDe: clave() }).despuesDe).toEqual({ creadoEn: CREADO_EN, id: ID });
    expect(criterios({}).despuesDe).toBeNull();
  });

  it("acepta los bordes del calendario y del reloj", () => {
    for (const creadoEn of [
      "2024-02-29T00:00:00.000000Z",
      "2026-12-31T23:59:59.999999Z",
      "0001-01-01T00:00:00.000001Z",
      "2026-10-12T19:00:00.000000Z",
    ]) {
      expect(leerClaveDePagina(clave(creadoEn)), creadoEn).toEqual({ creadoEn, id: ID });
    }
  });

  it("rechaza todo lo que no armó `claveDePagina`, antes de que llegue a la base", () => {
    const malas = [
      "",
      "|",
      "basura",
      CREADO_EN,
      ID,
      `${CREADO_EN}${ID}`,
      `${CREADO_EN}|`,
      `|${ID}`,
      `${CREADO_EN}|${ID}|`,
      `${CREADO_EN}|${ID}x`,
      `x${CREADO_EN}|${ID}`,
      `2026-10-12 ${CREADO_EN}|${ID}`,
      `${ID}|${CREADO_EN}`,
      // el instante
      clave("2026-10-12T15:30:45.12345Z"),
      clave("2026-10-12T15:30:45.1234567Z"),
      clave("2026-10-12T15:30:45Z"),
      clave("2026-10-12T15:30:45.123456"),
      clave("2026-10-12T15:30:45.123456+00:00"),
      clave("2026-10-12 15:30:45.123456Z"),
      clave("2026-10-12T24:00:00.000000Z"),
      clave("2026-10-12T15:60:00.000000Z"),
      clave("2026-10-12T15:30:60.000000Z"),
      clave("2026-10-12T25:30:45.123456Z"),
      clave("2026-13-12T15:30:45.123456Z"),
      clave("2026-00-12T15:30:45.123456Z"),
      clave("2026-10-32T15:30:45.123456Z"),
      clave("2026-10-00T15:30:45.123456Z"),
      clave("2026-02-30T15:30:45.123456Z"),
      clave("2025-02-29T15:30:45.123456Z"),
      clave("0000-10-12T15:30:45.123456Z"),
      clave("26-10-12T15:30:45.123456Z"),
      clave("2026-10-12T15:30:45.12345aZ"),
      clave("2026-10-12T1:30:45.123456Z"),
      clave(" 2026-10-12T15:30:45.123456Z"),
      // el id
      clave(CREADO_EN, ID.toUpperCase()),
      clave(CREADO_EN, ID.slice(1)),
      clave(CREADO_EN, `${ID}0`),
      clave(CREADO_EN, ID.replaceAll("-", "")),
      clave(CREADO_EN, ID.replace("a4", "g4")),
      clave(CREADO_EN, ` ${ID}`),
      clave(CREADO_EN, "no-es-un-uuid"),
    ];
    for (const mala of malas) {
      expect(leerClaveDePagina(mala), mala).toBeNull();
      expect(error({ despuesDe: mala }), mala).toBe("CLAVE_DE_PAGINA_INVALIDA");
    }
  });
});

describe("criteriosDeListado: el primer error gana", () => {
  it("con varios errores, el del límite, después las fechas, el texto y la clave", () => {
    const texto = "a".repeat(81);
    const invertido = { desde: fecha("2026-10-02"), hasta: fecha("2026-10-01") };
    expect(error({ limite: 0, ...invertido, texto, despuesDe: "mala" })).toBe("LIMITE_INVALIDO");
    expect(error({ limite: 1, ...invertido, texto, despuesDe: "mala" })).toBe("FECHAS_INVERTIDAS");
    expect(error({ limite: 1, texto, despuesDe: "mala" })).toBe("TEXTO_DEMASIADO_LARGO");
    expect(error({ limite: 1, despuesDe: "mala" })).toBe("CLAVE_DE_PAGINA_INVALIDA");
  });
});
