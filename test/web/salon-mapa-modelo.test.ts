import { describe, expect, it } from "vitest";
import {
  FILTROS_DEL_MAPA,
  armarElMapa,
  filtroDeLaDireccion,
  type MesaDelMapaDeLaPantalla,
} from "../../apps/web/ui/plantillas/salon/modelo-del-mapa";

/**
 * El modelo de vista del mapa del salón (SAL-A): el filtro sale de una lista cerrada, cada estado lleva ícono (el tono) y texto, el dinero sale como texto decimal con «$» y solo en ARS, una mesa unida dice a qué
 * mesa y una dividida lista sus cuentas, y ninguna mesa lleva enlace todavía (su ficha es SAL-B). Previene: un filtro armado a mano desde la dirección, un estado dicho solo con color, un importe que pasa por
 * `number` o una moneda mostrada como pesos.
 */
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const mesa = (
  extra: Partial<MesaDelMapaDeLaPantalla> & { numero: number },
): MesaDelMapaDeLaPantalla => ({
  mesaId: `00000000-0000-4000-8000-0000000000${String(extra.numero).padStart(2, "0")}`,
  estado: "LIBRE",
  ...extra,
});

describe("filtroDeLaDireccion", () => {
  it("acepta solo los tres de la lista cerrada", () => {
    expect(filtroDeLaDireccion("LIBRES")).toBe("LIBRES");
    expect(filtroDeLaDireccion("EN_PEDIDO")).toBe("EN_PEDIDO");
    expect(filtroDeLaDireccion("OCUPADAS")).toBe("OCUPADAS");
  });
  it("todo lo demás es «sin filtro»: otro valor, minúsculas, vacío, repetido, ausente, TODAS y un intento de inyección", () => {
    for (const crudo of [
      "libres",
      "",
      "TODAS",
      "LIBRES ",
      "OCUPADA",
      "../x",
      "LIBRES&filtro=OCUPADAS",
      ["LIBRES", "OCUPADAS"],
      undefined,
    ]) {
      expect(filtroDeLaDireccion(crudo)).toBeNull();
    }
  });
});

describe("armarElMapa", () => {
  it("ofrece los tres filtros con su texto; sin filtro ninguno está activo y cada uno apunta a su dirección", () => {
    const m = armarElMapa({}, [], null);
    expect(m.etiqueta).toBe("Mesas");
    expect(m.filtros.map((f) => [f.texto, f.activo, f.href])).toEqual([
      ["Libres", false, "/salon?filtro=LIBRES"],
      ["En pedido", false, "/salon?filtro=EN_PEDIDO"],
      ["Ocupadas", false, "/salon?filtro=OCUPADAS"],
    ]);
    expect(m.filtros.map((f) => f.valor)).toEqual(FILTROS_DEL_MAPA.map((f) => f.valor));
  });
  it("el filtro activo se marca y tocarlo de nuevo vuelve a todas las mesas", () => {
    const m = armarElMapa({}, [], "OCUPADAS");
    expect(m.filtros.map((f) => [f.valor, f.activo, f.href])).toEqual([
      ["LIBRES", false, "/salon?filtro=LIBRES"],
      ["EN_PEDIDO", false, "/salon?filtro=EN_PEDIDO"],
      ["OCUPADAS", true, "/salon"],
    ]);
  });
  it("lista vacía: ninguna fila y ningún texto nuevo", () => {
    expect(armarElMapa({}, [], "LIBRES").filas).toEqual([]);
  });
  it("cada estado sale con su texto y un tono (ícono): nunca solo color", () => {
    const filas = armarElMapa(
      {},
      [
        mesa({ numero: 1, estado: "LIBRE" }),
        mesa({ numero: 2, estado: "EN_PEDIDO", total: ARS("1500.00") }),
        mesa({ numero: 3, estado: "OCUPADA", total: ARS("32000.50") }),
        mesa({ numero: 4, estado: "UNIDA", unidaAMesa: 3 }),
      ],
      null,
    ).filas;
    expect(filas.map((f) => [f.titulo, f.estado?.texto, f.estado?.tono, f.total])).toEqual([
      ["Mesa 1", "Libre", "exito", null],
      ["Mesa 2", "En pedido", "aviso", "$ 1.500,00"],
      ["Mesa 3", "Ocupada", "info", "$ 32.000,50"],
      ["Mesa 4", "Unida a la mesa 3", "info", null],
    ]);
  });
  it("una mesa dividida lista sus cuentas con su importe", () => {
    const [fila] = armarElMapa(
      {},
      [
        mesa({
          numero: 5,
          estado: "OCUPADA",
          cuentasHijas: [
            { cuentaId: "a", numero: 1, total: ARS("100.00") },
            { cuentaId: "b", numero: 2, total: ARS("2500.5") },
          ],
        }),
      ],
      null,
    ).filas;
    expect(fila?.cuentas).toEqual(["Cuenta 1 · $ 100,00", "Cuenta 2 · $ 2.500,50"]);
  });
  it("una marca que redacta «Cuenta N» sin la N no rompe el número", () => {
    const [fila] = armarElMapa(
      { "salon.texto.dividir_cuenta_n": "Parte" },
      [mesa({ numero: 5, cuentasHijas: [{ cuentaId: "a", numero: 2, total: ARS("1.00") }] })],
      null,
    ).filas;
    expect(fila?.cuentas).toEqual(["Parte 2 · $ 1,00"]);
  });
  it("una moneda que no es ARS no se muestra como pesos", () => {
    const [fila] = armarElMapa(
      {},
      [
        mesa({
          numero: 6,
          estado: "OCUPADA",
          total: { moneda: "USD", monto: "10.00" },
          cuentasHijas: [{ cuentaId: "a", numero: 1, total: { moneda: "USD", monto: "5.00" } }],
        }),
      ],
      null,
    ).filas;
    expect(fila?.total).toBeNull();
    expect(fila?.cuentas).toEqual([]);
  });
  it("un estado desconocido no se inventa: sin rótulo", () => {
    const [fila] = armarElMapa({}, [mesa({ numero: 7, estado: "CERRADA_RARA" })], null).filas;
    expect(fila?.estado).toBeNull();
  });
  it("«unida» sin el número de destino no inventa uno", () => {
    const [fila] = armarElMapa({}, [mesa({ numero: 8, estado: "UNIDA" })], null).filas;
    expect(fila?.estado?.texto).toBe("Unida a la mesa");
  });
  it("conserva el orden del servidor y la fila no trae enlace (la ficha de la mesa es SAL-B)", () => {
    const filas = armarElMapa({}, [mesa({ numero: 9 }), mesa({ numero: 2 })], null).filas;
    expect(filas.map((f) => f.titulo)).toEqual(["Mesa 9", "Mesa 2"]);
    expect(Object.keys(filas[0] ?? {})).not.toContain("href");
  });
});
