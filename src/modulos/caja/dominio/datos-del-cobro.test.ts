import { describe, expect, it } from "vitest";
import type { DatoDelCobro } from "../estados";
import { datosCompletados, validarDatosDelCobro, type DatosDelCobro } from "./datos-del-cobro";
import type { DatosQuePideElMedio } from "./medios";

const TODOS: DatosQuePideElMedio = {
  cupon: true,
  ultimos4: true,
  marca: true,
  cuotas: true,
  dni: true,
};
const NINGUNO: DatosQuePideElMedio = {
  cupon: false,
  ultimos4: false,
  marca: false,
  cuotas: false,
  dni: false,
};
const MARCA = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VACIOS = { cupon: null, ultimos4: null, marcaDeTarjetaId: null, cuotas: null, dni: null };

const validar = (datos: DatosDelCobro, habilitados = TODOS) =>
  validarDatosDelCobro(datos, habilitados);
const invalido = (dato: DatoDelCobro, motivo: "FORMA" | "NUMERO_DE_TARJETA" = "FORMA") => ({
  ok: false,
  error: { codigo: "DATO_DE_COBRO_INVALIDO", dato, motivo },
});

describe("datos opcionales del cobro (e3 §3.6)", () => {
  it("todo vacío es válido y el cobro sale igual (nunca bloquean), con o sin datos habilitados", () => {
    expect(validar({})).toEqual({ ok: true, valor: VACIOS });
    expect(validar({}, NINGUNO)).toEqual({ ok: true, valor: VACIOS });
  });

  it("devuelve cada dato bien escrito tal cual", () => {
    const r = validar({
      cupon: "AB-123/4",
      ultimos4: "0042",
      marcaDeTarjetaId: MARCA,
      cuotas: 12,
      dni: "12345678",
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        cupon: "AB-123/4",
        ultimos4: "0042",
        marcaDeTarjetaId: MARCA,
        cuotas: 12,
        dni: "12345678",
      },
    });
  });

  describe("cupón", () => {
    it.each([
      "4509 9535 6623 3704",
      "4509-9535-6623-3704",
      "4509.9535.6623.3704",
      "4509953566233704",
      "4509/9535/6623/3704",
      "4509_9535_6623_3704",
    ])("rechaza el número de una tarjeta: %s", (cupon) => {
      const r = validar({ cupon });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ codigo: "DATO_DE_COBRO_INVALIDO", dato: "cupon" });
    });

    it("trece dígitos aun con separadores es NUMERO_DE_TARJETA; doce no", () => {
      expect(validar({ cupon: "4509-9535-6623-3704" })).toEqual(
        invalido("cupon", "NUMERO_DE_TARJETA"),
      );
      expect(validar({ cupon: "1234567890123" })).toEqual(invalido("cupon", "NUMERO_DE_TARJETA"));
      expect(validar({ cupon: "1234-5678-9012" }).ok).toBe(true);
      expect(validar({ cupon: "123456789012" }).ok).toBe(true);
      // Una letra en el medio corta el tramo de dígitos.
      expect(validar({ cupon: "123456A7890123" }).ok).toBe(true);
    });

    it.each([
      "ABC 123",
      " ABC",
      "ABC ",
      "",
      "...",
      "---",
      "_",
      "/",
      "AÑO1",
      "AB#1",
      "x".repeat(33),
    ])("rechaza por la forma: %j", (cupon) => {
      expect(validar({ cupon })).toEqual(invalido("cupon"));
    });

    it("rechaza por forma lo que la primitiva toma por un número de tarjeta aunque no tenga 13 dígitos seguidos", () => {
      // 16 dígitos que pasan Luhn, cortados por letras.
      expect(validar({ cupon: "4111A1111B1111C1111" })).toEqual(invalido("cupon"));
    });

    it("acepta 32 caracteres, separadores en el medio y de a un solo carácter alfanumérico", () => {
      expect(validar({ cupon: "A".repeat(32) }).ok).toBe(true);
      expect(validar({ cupon: "a" }).ok).toBe(true);
      expect(validar({ cupon: "-7-" }).ok).toBe(true);
    });

    it("un cupón que no es texto es inválido", () => {
      expect(validar({ cupon: 5 as unknown as string })).toEqual(invalido("cupon"));
    });
  });

  describe("últimos 4", () => {
    it("exactamente 4 dígitos; los ceros se conservan", () => {
      expect(validar({ ultimos4: "0042" }).ok).toBe(true);
    });
    it.each(["123", "12345", "4509953566233704", "12a4", " 123", "1234 ", "", "١٢٣٤"])(
      "rechaza %j y nunca trunca",
      (ultimos4) => {
        expect(validar({ ultimos4 })).toEqual(invalido("ultimos4"));
      },
    );
    it("un valor que no es texto es inválido", () => {
      expect(validar({ ultimos4: 1234 as unknown as string })).toEqual(invalido("ultimos4"));
    });
  });

  describe("marca", () => {
    it("el id de una marca es un uuid", () => {
      expect(validar({ marcaDeTarjetaId: MARCA.toUpperCase() }).ok).toBe(true);
      for (const malo of ["visa", "", "0a1b2c3d-4e5f-4a6b-8c7d", `${MARCA}x`, `x${MARCA}`]) {
        expect(validar({ marcaDeTarjetaId: malo })).toEqual(invalido("marca"));
      }
      expect(validar({ marcaDeTarjetaId: 5 as unknown as string })).toEqual(invalido("marca"));
    });
  });

  describe("cuotas", () => {
    it("entero de 1 a 36", () => {
      for (const cuotas of [1, 2, 12, 35, 36]) expect(validar({ cuotas }).ok).toBe(true);
    });
    it.each([0, 37, 2.5, -1, -0, Number.NaN, Number.POSITIVE_INFINITY, 1e21, 0.5])(
      "rechaza %s",
      (cuotas) => {
        expect(validar({ cuotas })).toEqual(invalido("cuotas"));
      },
    );
    it("rechaza lo que no es un número", () => {
      for (const malo of ["5", "abc", "", 5n, null]) {
        expect(validar({ cuotas: malo as unknown as number })).toEqual(invalido("cuotas"));
      }
    });
  });

  describe("DNI", () => {
    it("de 6 a 9 dígitos, sin puntos", () => {
      for (const dni of ["123456", "1234567", "12345678", "123456789"])
        expect(validar({ dni }).ok).toBe(true);
    });
    it.each([
      "12345",
      "1234567890",
      "12.345.678",
      "1234567a",
      "",
      " 12345678",
      "12345678 ",
      "012345678",
    ])("rechaza %j", (dni) => {
      expect(validar({ dni })).toEqual(invalido("dni"));
    });
    it("un valor que no es texto es inválido", () => {
      expect(validar({ dni: 12345678 as unknown as string })).toEqual(invalido("dni"));
    });
  });

  describe("habilitación por el medio", () => {
    it.each([
      ["cupon", { cupon: "A1" }],
      ["ultimos4", { ultimos4: "1234" }],
      ["marca", { marcaDeTarjetaId: MARCA }],
      ["cuotas", { cuotas: 3 }],
      ["dni", { dni: "12345678" }],
    ] as const)("un %s que el medio no habilitó se rechaza", (dato, datos) => {
      expect(validar(datos, NINGUNO)).toEqual({
        ok: false,
        error: { codigo: "DATO_DE_COBRO_NO_HABILITADO", dato },
      });
      expect(validar(datos, { ...NINGUNO, [dato]: true }).ok).toBe(true);
    });

    it("si no está habilitado se rechaza por eso aunque además esté mal escrito", () => {
      expect(validar({ ultimos4: "x" }, NINGUNO)).toEqual({
        ok: false,
        error: { codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "ultimos4" },
      });
    });

    it("devuelve el primer error en el orden cupón, últimos 4, marca, cuotas, DNI", () => {
      expect(validar({ cupon: " ", ultimos4: "x", dni: "x" })).toEqual(invalido("cupon"));
      expect(validar({ ultimos4: "x", marcaDeTarjetaId: "x" })).toEqual(invalido("ultimos4"));
      expect(validar({ marcaDeTarjetaId: "x", cuotas: 0 })).toEqual(invalido("marca"));
      expect(validar({ cuotas: 0, dni: "x" })).toEqual(invalido("cuotas"));
      expect(validar({ dni: "x" })).toEqual(invalido("dni"));
    });

    it("el texto vacío o un null no son «ausente»: son un dato mal escrito", () => {
      expect(validar({ cupon: "" })).toEqual(invalido("cupon"));
      expect(validar({ dni: null as unknown as string })).toEqual(invalido("dni"));
    });
  });

  it("la lista de datos completados (para la auditoría) nombra solo los que vinieron, en orden", () => {
    expect(datosCompletados({})).toEqual([]);
    expect(datosCompletados({ dni: "1", cupon: "A", cuotas: 3 })).toEqual([
      "cupon",
      "cuotas",
      "dni",
    ]);
    expect(datosCompletados({ ultimos4: "1234", marcaDeTarjetaId: MARCA })).toEqual([
      "ultimos4",
      "marca",
    ]);
  });
});
