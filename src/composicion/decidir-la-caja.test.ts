import { describe, expect, it } from "vitest";
import type { CajasParaCobrarParaLaPantalla } from "./cobrar-web";
import { decidirLaCaja } from "./decidir-la-caja";

type Caja = CajasParaCobrarParaLaPantalla["cajas"][number];

const caja = (cajaId: string, estado: Caja["estado"], jornadaVencida = false): Caja => ({
  cajaId,
  nombre: cajaId,
  estado,
  sesionId: estado === "SIN_SESION" ? null : `sesion-${cajaId}`,
  fechaDeNegocio: estado === "SIN_SESION" ? null : "2026-11-16",
  jornadaVencida,
});
const estado = (
  cajas: readonly Caja[],
  jornada: CajasParaCobrarParaLaPantalla["jornadaActual"]["estado"] = "ABIERTA",
): CajasParaCobrarParaLaPantalla => ({
  cajas,
  jornadaActual: { fechaDeNegocio: "2026-11-16", estado: jornada },
});

describe("decidirLaCaja (DEC-0502: nace cerrado, nunca se asume una caja)", () => {
  it("una sola caja abierta de la jornada de hoy: se cobra en esa", () => {
    expect(decidirLaCaja(estado([caja("c1", "ABIERTA")]))).toEqual({ tipo: "LISTA", cajaId: "c1" });
  });

  it("la única abierta gana aunque otra caja esté sin sesión o en cierre", () => {
    expect(decidirLaCaja(estado([caja("c1", "SIN_SESION"), caja("c2", "ABIERTA")]))).toEqual({
      tipo: "LISTA",
      cajaId: "c2",
    });
    expect(decidirLaCaja(estado([caja("c1", "EN_CIERRE"), caja("c2", "ABIERTA")]))).toEqual({
      tipo: "LISTA",
      cajaId: "c2",
    });
  });

  it("todas sin sesión: hay que abrir la caja", () => {
    expect(decidirLaCaja(estado([caja("c1", "SIN_SESION")]))).toEqual({ tipo: "ABRIR_LA_CAJA" });
    expect(decidirLaCaja(estado([caja("c1", "SIN_SESION"), caja("c2", "SIN_SESION")]))).toEqual({
      tipo: "ABRIR_LA_CAJA",
    });
  });

  it("más de una abierta: no se elige por la persona", () => {
    expect(decidirLaCaja(estado([caja("c1", "ABIERTA"), caja("c2", "ABIERTA")]))).toEqual({
      tipo: "NO_PERMITIDO",
      jornadaAbierta: true,
    });
  });

  it("la caja en cierre, o en cierre junto a una sin sesión: no se permite", () => {
    expect(decidirLaCaja(estado([caja("c1", "EN_CIERRE")]))).toEqual({ tipo: "NO_PERMITIDO", jornadaAbierta: true });
    expect(decidirLaCaja(estado([caja("c1", "EN_CIERRE"), caja("c2", "SIN_SESION")]))).toEqual({
      tipo: "NO_PERMITIDO",
      jornadaAbierta: true,
    });
  });

  it("una sesión de una jornada vencida no cobra", () => {
    expect(decidirLaCaja(estado([caja("c1", "ABIERTA", true)]))).toEqual({ tipo: "NO_PERMITIDO", jornadaAbierta: true });
  });

  it("sin ninguna caja no se permite", () => {
    expect(decidirLaCaja(estado([]))).toEqual({ tipo: "NO_PERMITIDO", jornadaAbierta: true });
  });

  it("con el día en auditoría o cerrado no se permite, aunque haya una caja abierta o sin sesión", () => {
    for (const jornada of ["EN_AUDITORIA", "CERRADA"] as const) {
      expect(decidirLaCaja(estado([caja("c1", "ABIERTA")], jornada))).toEqual({
        tipo: "NO_PERMITIDO",
        jornadaAbierta: false,
      });
      expect(decidirLaCaja(estado([caja("c1", "SIN_SESION")], jornada))).toEqual({
        tipo: "NO_PERMITIDO",
        jornadaAbierta: false,
      });
    }
  });
});
