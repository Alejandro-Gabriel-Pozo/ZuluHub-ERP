import { describe, expect, it } from "vitest";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  documentoDeTicket,
  TEXTOS_DEL_TICKET,
  type FichaParaElTicket,
  type RenglonParaElTicket,
} from "./documento-del-ticket";

const fecha = (t: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(t);
  if (!r.ok) throw new Error(t);
  return r.valor;
};
const renglon = (cambios: Partial<RenglonParaElTicket> = {}): RenglonParaElTicket => ({
  cantidad: "1",
  unidadDeVenta: "UNIDAD",
  descripcion: "Milanesa",
  varianteNombre: null,
  opciones: [],
  importe: "1500.00",
  ...cambios,
});
const ficha = (cambios: Partial<FichaParaElTicket> = {}): FichaParaElTicket => ({
  numero: 12,
  fechaNegocio: fecha("2026-11-09"),
  lineas: [renglon()],
  total: "1500.00",
  ...cambios,
});
const papel = (f: FichaParaElTicket, ancho: 58 | 80 = 58) => {
  const r = documentoDeTicket(f, { ancho });
  if (!r.ok) throw new Error(r.error);
  return r.valor.lineas.map((l) => `${l.estilo} | ${l.texto}`);
};

describe("el ticket del cliente en el papel", () => {
  const dosRenglones = ficha({
    lineas: [
      renglon({ cantidad: "2", importe: "3000.00" }),
      renglon({
        descripcion: "Gaseosa de litro y medio sabor pomelo light",
        importe: "1500.00",
      }),
    ],
    total: "4500.00",
  });

  it("número, fecha DD/MM/AAAA, descripción a la izquierda e importe a la derecha y total en negrita, en los dos anchos", () => {
    expect(papel(dosRenglones, 58)).toMatchInlineSnapshot(`
      [
        "NEGRITA | Ticket N.º 12",
        "NORMAL | 09/11/2026",
        "SEPARADOR | ",
        "NORMAL | 2 Milanesa              3.000,00",
        "NORMAL | 1 Gaseosa de litro y medio sabor",
        "NORMAL | pomelo light",
        "NORMAL | 1.500,00",
        "SEPARADOR | ",
        "NEGRITA | Total                   4.500,00",
      ]
    `);
    expect(papel(dosRenglones, 80)).toMatchInlineSnapshot(`
      [
        "NEGRITA | Ticket N.º 12",
        "NORMAL | 09/11/2026",
        "SEPARADOR | ",
        "NORMAL | 2 Milanesa                              3.000,00",
        "NORMAL | 1 Gaseosa de litro y medio sabor pomelo light",
        "NORMAL | 1.500,00",
        "SEPARADOR | ",
        "NEGRITA | Total                                   4.500,00",
      ]
    `);
  });

  it("la fecha nunca sale AAAA-MM-DD", () => {
    for (const ancho of [58, 80] as const) {
      expect(papel(ficha(), ancho).join("\n")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("la cantidad sale como en pantalla: «½», «1 ½», «¾» y «350 g»", () => {
    const l = papel(
      ficha({
        lineas: [
          renglon({ cantidad: "0.5", descripcion: "Pizza" }),
          renglon({ cantidad: "1.5", descripcion: "Pizza" }),
          renglon({ cantidad: "0.75", descripcion: "Torta" }),
          renglon({ cantidad: "350", unidadDeVenta: "GRAMO", descripcion: "Queso" }),
        ],
      }),
      80,
    );
    expect(l.filter((x) => /½|¾|350/.test(x)).map((x) => x.slice(0, 20))).toEqual([
      "NORMAL | ½ Pizza    ",
      "NORMAL | 1 ½ Pizza  ",
      "NORMAL | ¾ Torta    ",
      "NORMAL | 350 g Queso",
    ]);
    expect(l.slice(3).join("\n")).not.toMatch(/\d\/\d/);
  });

  it("la medida y las opciones elegidas salen sangradas debajo de la línea, en ese orden, de los datos del ticket", () => {
    const l = papel(
      ficha({
        lineas: [
          renglon({
            descripcion: "Pizza",
            varianteNombre: "Grande",
            opciones: [
              { nombre: "Sin cebolla" },
              { nombre: "Extra queso con aceitunas negras y orégano" },
            ],
          }),
        ],
      }),
      58,
    );
    expect(l.slice(3, -2)).toEqual([
      "NORMAL | 1 Pizza                 1.500,00",
      "NORMAL |   Grande",
      "NORMAL |   Sin cebolla",
      "NORMAL |   Extra queso con aceitunas",
      "NORMAL |   negras y orégano",
    ]);
    // Sin medida ni opciones no hay renglones de detalle; solo opciones, tampoco hay medida.
    expect(papel(ficha(), 58).slice(3, -2)).toHaveLength(1);
    expect(
      papel(ficha({ lineas: [renglon({ opciones: [{ nombre: "Sin sal" }] })] })).slice(3, -2),
    ).toEqual(["NORMAL | 1 Milanesa              1.500,00", "NORMAL |   Sin sal"]);
  });

  it("no lleva medios de pago, vuelto, empresa, sucursal ni hora", () => {
    const todo = papel(ficha(), 80).join("\n");
    expect(todo).not.toMatch(/Efectivo|Tarjeta|Transferencia|QR|Vuelto|Pagó|Medio/i);
    expect(todo).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("los textos son los aprobados del papel", () => {
    expect(TEXTOS_DEL_TICKET).toEqual({ ticket: "Ticket N.º", total: "Total" });
  });

  it("el borde: la descripción llena justo el lugar que deja el importe ya formateado", () => {
    const una = (descripcion: string, importe: string) =>
      papel(ficha({ lineas: [renglon({ descripcion, importe })], total: "1.00" }), 58).slice(3, -2);
    // importe «100,00» de 6 → lugar = 32 − 6 − 1 = 25; «1 » + 23 = 25: justo
    expect(una("a".repeat(23), "100.00")).toEqual(["NORMAL | 1 aaaaaaaaaaaaaaaaaaaaaaa 100,00"]);
    // un carácter más: no entra y se parte en dos renglones
    expect(una("a".repeat(24), "100.00")).toEqual([
      "NORMAL | 1 aaaaaaaaaaaaaaaaaaaaaaaa",
      "NORMAL | 100,00",
    ]);
    // el importe más ancho que existe, «999.999.999,99» (14) → lugar = 17; «1 » + 15 = 17: justo
    expect(una("a".repeat(15), "999999999.99")).toEqual([
      "NORMAL | 1 aaaaaaaaaaaaaaa 999.999.999,99",
    ]);
    expect(una("a".repeat(16), "999999999.99")).toEqual([
      "NORMAL | 1 aaaaaaaaaaaaaaaa",
      "NORMAL | 999.999.999,99",
    ]);
  });

  it("ninguna línea pasa del ancho del papel", () => {
    for (const [ancho, max] of [
      [58, 32],
      [80, 48],
    ] as const) {
      for (const l of documentoDeTicket(dosRenglones, { ancho }).ok
        ? papel(dosRenglones, ancho)
        : []) {
        expect(l.split(" | ").slice(1).join(" | ").length).toBeLessThanOrEqual(max);
      }
    }
  });

  it("falla cerrada: una cantidad, una fecha o un importe que no se pueden mostrar no sacan un papel a medias", () => {
    const codigo = (f: FichaParaElTicket) => {
      const r = documentoDeTicket(f, { ancho: 58 });
      return r.ok ? "ok" : r.error;
    };
    expect(codigo(ficha({ lineas: [renglon({ cantidad: "0.3333" })] }))).toBe(
      "CANTIDAD_NO_MOSTRABLE",
    );
    expect(codigo(ficha({ lineas: [renglon({ cantidad: "0" })] }))).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(codigo(ficha({ lineas: [renglon({ unidadDeVenta: "CAJON" })] }))).toBe(
      "CANTIDAD_NO_MOSTRABLE",
    );
    expect(codigo(ficha({ fechaNegocio: "2026-02-30" as FechaCivil }))).toBe("FECHA_INVALIDA");
    expect(codigo(ficha({ lineas: [renglon({ importe: "1.234" })] }))).toBe("IMPORTE_NO_MOSTRABLE");
    expect(codigo(ficha({ lineas: [renglon({ importe: "-5.00" })] }))).toBe("IMPORTE_NO_MOSTRABLE");
    expect(codigo(ficha({ total: "abc" }))).toBe("IMPORTE_NO_MOSTRABLE");
    expect(codigo(ficha())).toBe("ok");
  });

  it("un defecto que no es una fecha inválida no se traga", () => {
    const explota = {
      toString: () => {
        throw new TypeError("ajeno");
      },
    } as unknown as FechaCivil;
    expect(() => documentoDeTicket(ficha({ fechaNegocio: explota }), { ancho: 58 })).toThrow(
      TypeError,
    );
  });
});
