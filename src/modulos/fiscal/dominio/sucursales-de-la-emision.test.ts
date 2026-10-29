import { describe, expect, it } from "vitest";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { exigirSucursalAbierta, sucursalesDeLaEmision } from "./sucursales-de-la-emision";

const CENTRO = sucursalId("centro");
const NORTE = sucursalId("norte");
const SUR = sucursalId("sur");

const FUERA = { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" };
const OK = { ok: true, valor: null };
// La sucursal de la FACTURA que no es de la persona: lo mismo que si la factura no existiera (D-39).
const SIN_FACTURA = { ok: false, error: "COMPROBANTE_ASOCIADO_NO_ENCONTRADO" };

describe("sucursalesDeLaEmision (D-41 y D-51)", () => {
  describe("una factura (no corrige nada)", () => {
    it("gerente y administrador («todas») emiten desde cualquier sucursal", () => {
      expect(sucursalesDeLaEmision("TODAS", CENTRO, null)).toEqual(OK);
      expect(sucursalesDeLaEmision("TODAS", NORTE, null)).toEqual(OK);
    });

    it("el operador emite desde una sucursal asignada, y de ninguna otra", () => {
      const alcance: AlcanceDeSucursales = [CENTRO];
      expect(sucursalesDeLaEmision(alcance, CENTRO, null)).toEqual(OK);
      expect(sucursalesDeLaEmision(alcance, NORTE, null)).toEqual(FUERA);
      expect(sucursalesDeLaEmision([CENTRO, SUR], SUR, null)).toEqual(OK);
    });

    it("un operador sin asignaciones no emite desde ninguna", () => {
      expect(sucursalesDeLaEmision([], CENTRO, null)).toEqual(FUERA);
    });
  });

  describe("una nota: necesita las DOS sucursales (D-51)", () => {
    it("el operador de Centro no puede emitir una nota sobre una factura de Norte, aunque el punto de venta sea de Centro: «no encontrado»", () => {
      expect(sucursalesDeLaEmision([CENTRO], CENTRO, { sucursalId: NORTE })).toEqual(SIN_FACTURA);
    });

    it("tampoco si la factura es de Centro y el punto de venta de Norte: la sucursal del punto de venta ajeno sigue dando «fuera de alcance»", () => {
      expect(sucursalesDeLaEmision([CENTRO], NORTE, { sucursalId: CENTRO })).toEqual(FUERA);
    });

    it("con las dos asignadas emite, sean la misma sucursal o distintas", () => {
      expect(sucursalesDeLaEmision([CENTRO], CENTRO, { sucursalId: CENTRO })).toEqual(OK);
      expect(sucursalesDeLaEmision([CENTRO, NORTE], CENTRO, { sucursalId: NORTE })).toEqual(OK);
    });

    it("gerente y administrador emiten una nota sobre cualquier factura, por cualquier punto de venta", () => {
      expect(sucursalesDeLaEmision("TODAS", CENTRO, { sucursalId: NORTE })).toEqual(OK);
    });

    it("una factura sin sucursal guardada no corresponde a nadie: ni siquiera a «todas»", () => {
      expect(sucursalesDeLaEmision("TODAS", CENTRO, { sucursalId: null })).toEqual(SIN_FACTURA);
      expect(sucursalesDeLaEmision([CENTRO], CENTRO, { sucursalId: null })).toEqual(SIN_FACTURA);
      expect(sucursalesDeLaEmision([CENTRO], NORTE, { sucursalId: null })).toEqual(SIN_FACTURA);
    });

    it("con la factura en el alcance y sin la sucursal del punto de venta, manda «fuera de alcance»", () => {
      expect(sucursalesDeLaEmision([NORTE], CENTRO, { sucursalId: NORTE })).toEqual(FUERA);
      expect(sucursalesDeLaEmision([NORTE, SUR], CENTRO, { sucursalId: SUR })).toEqual(FUERA);
    });

    it("D-56: sin la sucursal de la factura manda «no encontrado» (se mira primero), esté o no la del punto de venta: la misma respuesta en los dos casos", () => {
      // El ejemplo del dueño: el operador de Centro, un punto de venta de Norte y una factura de Norte.
      expect(sucursalesDeLaEmision([CENTRO], NORTE, { sucursalId: NORTE })).toEqual(SIN_FACTURA);
      expect(sucursalesDeLaEmision([SUR], CENTRO, { sucursalId: NORTE })).toEqual(SIN_FACTURA);
      expect(sucursalesDeLaEmision([CENTRO], CENTRO, { sucursalId: NORTE })).toEqual(SIN_FACTURA);
      expect(sucursalesDeLaEmision([], NORTE, { sucursalId: NORTE })).toEqual(SIN_FACTURA);
    });
  });
});

describe("exigirSucursalAbierta (D-50)", () => {
  it("una sucursal abierta emite", () => {
    expect(exigirSucursalAbierta({ activa: true })).toEqual(OK);
  });

  it("una sucursal cerrada no emite", () => {
    expect(exigirSucursalAbierta({ activa: false })).toEqual({
      ok: false,
      error: "SUCURSAL_CERRADA",
    });
  });
});
