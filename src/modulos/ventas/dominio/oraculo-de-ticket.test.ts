import { describe, expect, it } from "vitest";
import {
  celdasEjecutables,
  celdasPendientes,
  defectosDeForma,
  etiquetaDePendiente,
  huellaDeLasCeldas,
} from "../../../primitivas/oraculo/celdas";
import { ESTADOS_DE_TICKET, TRANSICIONES_DE_TICKET, transicionDeTicketPermitida } from "./estados";
import {
  celdaDeVentas,
  ORACULO_DE_VENTAS,
  transicionesDeTicketDelOraculo,
  transicionesDeTicketProhibidasPorElOraculo,
} from "./oraculo-de-ticket";

/**
 * El oráculo de ventas contra el dominio: forma de la tabla, las 16 celdas que esperan su tramo, y las transiciones de ticket que el oráculo
 * deriva de sus celdas contra `TRANSICIONES_DE_TICKET`. La comparación con la base y con los casos de uso reales está en `test/integracion/`.
 */
describe("oraculo de ventas: la tabla", () => {
  it("tiene las 44 celdas de los bloques A, B y D, sin defectos de forma", () => {
    expect(ORACULO_DE_VENTAS).toHaveLength(44);
    expect(defectosDeForma(ORACULO_DE_VENTAS)).toEqual([]);
    const ids = ORACULO_DE_VENTAS.map((c) => c.id);
    expect(ids.filter((i) => i.startsWith("A-"))).toHaveLength(20);
    expect(ids.filter((i) => i.startsWith("B-"))).toHaveLength(15);
    expect(ids.filter((i) => i.startsWith("D-"))).toHaveLength(9);
  });

  it("las celdas que esperan su tramo son exactamente las que el documento marca ✘ o —", () => {
    expect(celdasPendientes(ORACULO_DE_VENTAS).map((c) => [c.id, etiquetaDePendiente(c)])).toEqual([
      ["A-05", "PENDIENTE (tramo C2)"],
      ["A-06", "PENDIENTE (tramo C1 y C2)"],
      ["A-14", "PENDIENTE (tramo T0)"],
      ["A-17", "PENDIENTE (tramo corrección de ticket)"],
      ["A-18", "PENDIENTE (tramo corrección de ticket)"],
      ["A-19", "PENDIENTE (tramo corrección de ticket)"],
      ["B-02", "PENDIENTE (tramo R-05a y R-05b)"],
      ["B-06", "PENDIENTE (tramo T1 a T4)"],
      ["B-08", "PENDIENTE (tramo T1 y T3)"],
      ["B-09", "PENDIENTE (tramo T2 y T3)"],
      ["B-10", "PENDIENTE (tramo por definir)"],
      ["D-01", "PENDIENTE (tramo C1 y C2)"],
      ["D-04", "PENDIENTE (tramo T1 y T3)"],
      ["D-05", "PENDIENTE (tramo T0)"],
      ["D-09", "PENDIENTE (tramo C2)"],
    ]);
  });

  it("de A y B hay 15 pendientes y las celdas ejecutables son las demás", () => {
    expect(celdasEjecutables(ORACULO_DE_VENTAS)).toHaveLength(44 - 15);
  });

  it("B-04 (cortesía facturable) sigue EN REVISIÓN del dueño y es la única", () => {
    expect(ORACULO_DE_VENTAS.filter((c) => c.enRevision === true).map((c) => c.id)).toEqual([
      "B-04",
    ]);
    expect(celdaDeVentas("B-04").permitido).toBe(false);
  });

  it("las celdas de dinero y de anulación citan su regla", () => {
    expect(celdaDeVentas("A-14").regla).toBe("R-32");
    expect(celdaDeVentas("A-05").regla).toContain("R-07a");
    expect(celdaDeVentas("B-06").regla).toContain("R-01");
  });
});

/** La huella de la tabla: cambiar una celda exige actualizarla acá, en el mismo cambio (DEC-0393). El valor nuevo lo dice el mensaje. */
const HUELLA_DE_LA_TABLA = "1800358b4179e8f6f0a8564cc8ee72db8c40dfbcb3a6c260faa5bf16cb0f9b5c";

describe("oraculo de ventas: la tabla está congelada", () => {
  it("la huella coincide (si cambiaste una celda a propósito, actualizá HUELLA_DE_LA_TABLA)", () => {
    expect(huellaDeLasCeldas(ORACULO_DE_VENTAS)).toBe(HUELLA_DE_LA_TABLA);
  });
});

describe("oraculo de ventas: las transiciones de ticket", () => {
  it("las que el oráculo deriva de sus celdas son EXACTAMENTE TRANSICIONES_DE_TICKET", () => {
    expect(transicionesDeTicketDelOraculo()).toEqual(
      Object.fromEntries(ESTADOS_DE_TICKET.map((e) => [e, [...TRANSICIONES_DE_TICKET[e]].sort()])),
    );
  });

  it("lo que el oráculo prohíbe expresamente el dominio no lo permite", () => {
    const prohibidas = transicionesDeTicketProhibidasPorElOraculo();
    expect(prohibidas).toEqual([
      "ANULADO>ANULADO",
      "ANULADO>COBRADO",
      "COBRADO>COBRADO",
      "CORTESIA>COBRADO",
    ]);
    for (const par of prohibidas) {
      const [de, a] = par.split(">") as [
        (typeof ESTADOS_DE_TICKET)[number],
        (typeof ESTADOS_DE_TICKET)[number],
      ];
      expect(transicionDeTicketPermitida(de, a), par).toBe(false);
    }
  });
});
