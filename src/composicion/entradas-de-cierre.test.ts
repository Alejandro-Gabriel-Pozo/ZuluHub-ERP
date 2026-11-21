import { describe, expect, it } from "vitest";
import {
  entradaDeCerrarElDia,
  entradaDeCorregirElMedio,
  entradaDeDarElConforme,
  entradaDeDeclararElTotal,
  entradaDeJornadaDelCierre,
} from "./entradas-de-cierre";

const MALA = { ok: false, error: "ENTRADA_INVALIDA" } as const;
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const OTRO_ID = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const CLAVE = "clave-de-prueba-0001";

describe("entradas del cierre del día: de lo que manda el navegador a lo que reciben los casos de uso", () => {
  describe("empezar o cancelar el cierre", () => {
    it("toma solo la jornada; la empresa, la persona y la sucursal que mande el navegador se descartan", () => {
      expect(
        entradaDeJornadaDelCierre({
          fechaDeNegocio: "2026-11-09",
          sucursalId: ID,
          empresaId: OTRO_ID,
          personaId: ID,
        }),
      ).toEqual({ ok: true, valor: { fechaDeNegocio: "2026-11-09" } });
    });

    it.each([
      ["sin pedido", undefined],
      ["null", null],
      ["un texto", "2026-11-09"],
      ["sin fecha", {}],
      ["una fecha que no es un texto", { fechaDeNegocio: 20261109 }],
      ["una fecha con otro formato", { fechaDeNegocio: "09/11/2026" }],
      ["una fecha con basura antes", { fechaDeNegocio: "x2026-11-09" }],
      ["una fecha con basura después", { fechaDeNegocio: "2026-11-09x" }],
      ["una fecha incompleta", { fechaDeNegocio: "2026-11-9" }],
    ])("rechaza %s", (_motivo, crudo) => {
      expect(entradaDeJornadaDelCierre(crudo)).toEqual(MALA);
    });
  });

  describe("cerrar el día", () => {
    const pedido = {
      fechaDeNegocio: "2026-11-09",
      huellaVista: "a".repeat(64),
      reconocimientos: [
        { modulo: "caja", clave: "caja.diferencia_de_arqueo", texto: "Se explicó" },
        { modulo: "ventas", clave: "ventas.cortesias", texto: null },
      ],
    };

    it("lleva la huella y lo reconocido; sin observación el texto queda null", () => {
      expect(entradaDeCerrarElDia(pedido)).toEqual({ ok: true, valor: pedido });
    });

    it("un texto en blanco es «sin observación» (null); uno con contenido queda tal cual, sin recortar: lo canoniza el dominio", () => {
      const r = entradaDeCerrarElDia({
        ...pedido,
        reconocimientos: [
          { modulo: "caja", clave: "a", texto: "" },
          { modulo: "caja", clave: "b", texto: "  \n\t " },
          { modulo: "caja", clave: "c", texto: "  hola  " },
        ],
      });
      expect(r).toEqual({
        ok: true,
        valor: {
          ...pedido,
          reconocimientos: [
            { modulo: "caja", clave: "a", texto: null },
            { modulo: "caja", clave: "b", texto: null },
            { modulo: "caja", clave: "c", texto: "  hola  " },
          ],
        },
      });
    });

    it("sin nada que reconocer es una lista vacía; hasta 100 entran y 101 no", () => {
      const de = (n: number) =>
        entradaDeCerrarElDia({
          ...pedido,
          reconocimientos: Array.from({ length: n }, (_, i) => ({
            modulo: "caja",
            clave: `c${i}`,
            texto: null,
          })),
        });
      expect(entradaDeCerrarElDia({ ...pedido, reconocimientos: [] }).ok).toBe(true);
      expect(de(100).ok).toBe(true);
      expect(de(101)).toEqual(MALA);
    });

    it("descarta lo que no declara (una observación general, la sucursal) y rechaza la huella o la lista con otra forma", () => {
      expect(entradaDeCerrarElDia({ ...pedido, observacion: "x", sucursalId: ID })).toEqual({
        ok: true,
        valor: pedido,
      });
      expect(entradaDeCerrarElDia({ ...pedido, huellaVista: 1 })).toEqual(MALA);
      expect(entradaDeCerrarElDia({ ...pedido, huellaVista: undefined })).toEqual(MALA);
      expect(entradaDeCerrarElDia({ ...pedido, reconocimientos: "todo" })).toEqual(MALA);
      expect(entradaDeCerrarElDia({ ...pedido, reconocimientos: undefined })).toEqual(MALA);
      expect(
        entradaDeCerrarElDia({
          ...pedido,
          reconocimientos: [{ modulo: "caja", clave: 1, texto: null }],
        }),
      ).toEqual(MALA);
      expect(
        entradaDeCerrarElDia({ ...pedido, reconocimientos: [{ modulo: "caja", clave: "x" }] }),
      ).toEqual(MALA);
      expect(entradaDeCerrarElDia({ ...pedido, fechaDeNegocio: "ayer" })).toEqual(MALA);
    });

    it("un texto enorme no pasa: lo acotado lo decide la frontera, la lista de permitidos el dominio", () => {
      expect(
        entradaDeCerrarElDia({
          ...pedido,
          reconocimientos: [{ modulo: "caja", clave: "x", texto: "a".repeat(1001) }],
        }),
      ).toEqual(MALA);
    });
  });

  describe("corregir el medio de un cobro", () => {
    const pedido = {
      claveDeIdempotencia: CLAVE,
      cobroId: ID,
      medioDestinoId: OTRO_ID,
      cuentaDestinoId: ID,
      motivo: "Se cobró con crédito y era débito",
    };

    it("toma el cobro, el destino y el motivo con la clave del intento", () => {
      expect(entradaDeCorregirElMedio(pedido)).toEqual({ ok: true, valor: pedido });
    });

    it("la cuenta puede ser null («Sin cuenta»); el motivo en blanco lo rechaza el caso de uso, no la frontera", () => {
      expect(entradaDeCorregirElMedio({ ...pedido, cuentaDestinoId: null })).toEqual({
        ok: true,
        valor: { ...pedido, cuentaDestinoId: null },
      });
      expect(entradaDeCorregirElMedio({ ...pedido, motivo: "" }).ok).toBe(true);
    });

    it("descarta la sucursal y rechaza identificadores que no lo son, la cuenta ausente o un motivo que no es texto", () => {
      expect(entradaDeCorregirElMedio({ ...pedido, sucursalId: ID })).toEqual({
        ok: true,
        valor: pedido,
      });
      expect(entradaDeCorregirElMedio({ ...pedido, cobroId: "uno" })).toEqual(MALA);
      expect(entradaDeCorregirElMedio({ ...pedido, medioDestinoId: ID.toUpperCase() })).toEqual(
        MALA,
      );
      expect(entradaDeCorregirElMedio({ ...pedido, cuentaDestinoId: "" })).toEqual(MALA);
      expect(entradaDeCorregirElMedio({ ...pedido, cuentaDestinoId: undefined })).toEqual(MALA);
      expect(entradaDeCorregirElMedio({ ...pedido, motivo: 5 })).toEqual(MALA);
      expect(entradaDeCorregirElMedio({ ...pedido, claveDeIdempotencia: 5 })).toEqual(MALA);
      expect(entradaDeCorregirElMedio({ ...pedido, claveDeIdempotencia: undefined })).toEqual(MALA);
    });
  });

  describe("declarar el total de un medio", () => {
    const pedido = {
      claveDeIdempotencia: CLAVE,
      fechaDeNegocio: "2026-11-09",
      medioDePagoId: ID,
      cuentaDeCobroId: OTRO_ID,
      importe: "7070.50",
    };

    it("el importe viaja como TEXTO decimal y sale con su moneda (pesos), sin pasar por número", () => {
      expect(entradaDeDeclararElTotal(pedido)).toEqual({
        ok: true,
        valor: { ...pedido, importe: { moneda: "ARS", monto: "7070.50" } },
      });
      expect(entradaDeDeclararElTotal({ ...pedido, importe: "0.00" })).toEqual({
        ok: true,
        valor: { ...pedido, importe: { moneda: "ARS", monto: "0.00" } },
      });
    });

    it("la cuenta puede ser null; un importe que no es texto, o enorme, se rechaza; qué es un importe válido lo decide el caso de uso", () => {
      expect(entradaDeDeclararElTotal({ ...pedido, cuentaDeCobroId: null }).ok).toBe(true);
      expect(entradaDeDeclararElTotal({ ...pedido, importe: 7070.5 })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, importe: "1".repeat(41) })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, importe: undefined })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, importe: "mil" }).ok).toBe(true);
    });

    it("rechaza la jornada o el medio con otra forma y descarta la sucursal", () => {
      expect(entradaDeDeclararElTotal({ ...pedido, fechaDeNegocio: "hoy" })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, medioDePagoId: "efectivo" })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, cuentaDeCobroId: "x" })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, claveDeIdempotencia: undefined })).toEqual(MALA);
      expect(entradaDeDeclararElTotal({ ...pedido, sucursalId: OTRO_ID })).toEqual({
        ok: true,
        valor: { ...pedido, importe: { moneda: "ARS", monto: "7070.50" } },
      });
    });
  });

  describe("el conforme general", () => {
    it("toma la jornada y la clave del intento y nada más", () => {
      expect(
        entradaDeDarElConforme({
          claveDeIdempotencia: CLAVE,
          fechaDeNegocio: "2026-11-09",
          sucursalId: ID,
        }),
      ).toEqual({ ok: true, valor: { claveDeIdempotencia: CLAVE, fechaDeNegocio: "2026-11-09" } });
    });

    it("rechaza sin clave o con otra jornada", () => {
      expect(entradaDeDarElConforme({ fechaDeNegocio: "2026-11-09" })).toEqual(MALA);
      expect(entradaDeDarElConforme({ claveDeIdempotencia: CLAVE })).toEqual(MALA);
      expect(
        entradaDeDarElConforme({ claveDeIdempotencia: CLAVE, fechaDeNegocio: "mañana" }),
      ).toEqual(MALA);
      expect(entradaDeDarElConforme(null)).toEqual(MALA);
    });
  });
});
