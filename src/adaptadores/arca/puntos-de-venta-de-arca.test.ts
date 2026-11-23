import { describe, expect, it } from "vitest";
import {
  respuestaDePtosVentaDelManual,
  type PtoVentaDelManual,
} from "../../../test/utilidades/arca-del-manual";
import { ok } from "../../primitivas/resultado/resultado";
import { clasificarParametros, clasificarPuntosDeVenta } from "./clasificar";
import { aPuntosDeVentaDeArca } from "./puntos-de-venta-de-arca";
import type { RespuestaDeTransporte } from "./tipos";

/**
 * `FEParamGetPtosVenta` leído sobre una respuesta CONSTRUIDA DEL MANUAL (WSFE v4.8, l. 3046-3114), NO GRABADA: no hay una grabación de
 * ARCA real de esta operación. Dice «el lector entiende lo que el manual describe», no «ARCA contesta así». SIN VERIFICAR contra ARCA
 * real: qué manda ARCA en `FchBaja` cuando no hay baja, los literales de `EmisionTipo`, y qué contesta una CUIT sin puntos de venta.
 */

const leer = (cuerpo: string, estadoHttp = 200) =>
  aPuntosDeVentaDeArca(clasificarPuntosDeVenta({ tipo: "RESPUESTA", estadoHttp, cuerpo }));

const habilitado: PtoVentaDelManual = { Nro: "1", EmisionTipo: "CAE", Bloqueado: "N" };

const NO_SE_ENTIENDE = {
  ok: false,
  error: {
    codigo: "SERVICIO_NO_DISPONIBLE",
    detalle: "la lista de puntos de venta de ARCA no se pudo leer",
    causa: "PROBLEMA_DEL_SISTEMA",
  },
};

/** Lo mismo cuando lo que no se entiende es el `EmisionTipo`: el detalle (solo para el registro del servidor) lleva el valor recibido ya saneado. */
const NO_SE_ENTIENDE_EMISION = (recibido: string) => ({
  ok: false,
  error: {
    codigo: "SERVICIO_NO_DISPONIBLE",
    detalle: `la lista de puntos de venta de ARCA no se pudo leer (EmisionTipo recibido: ${recibido})`,
    causa: "PROBLEMA_DEL_SISTEMA",
  },
});

describe("los puntos de venta de ARCA, tal como los describe el manual", () => {
  it("varios PtoVenta: el número, si está bloqueado (S/N) y si tiene fecha de baja", () => {
    expect(
      leer(
        respuestaDePtosVentaDelManual({
          puntos: [
            habilitado,
            { Nro: "00002", EmisionTipo: "CAEA", Bloqueado: "S" },
            { Nro: "3", EmisionTipo: "CAE", Bloqueado: "N", FchBaja: "20260131" },
          ],
        }),
      ),
    ).toEqual({
      ok: true,
      valor: [
        { numero: 1, bloqueado: false, dadoDeBaja: false, emision: "CAE" },
        { numero: 2, bloqueado: true, dadoDeBaja: false, emision: "CAEA" },
        { numero: 3, bloqueado: false, dadoDeBaja: true, emision: "CAE" },
      ],
    });
  });

  it("un solo PtoVenta (el lector XML no lo vuelve lista) se lee igual", () => {
    expect(leer(respuestaDePtosVentaDelManual({ puntos: [habilitado] }))).toEqual({
      ok: true,
      valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false, emision: "CAE" }],
    });
  });

  it("FchBaja es opcional (el manual lo marca «N»): ausente o vacío es que no hay baja", () => {
    for (const FchBaja of [undefined, ""]) {
      expect(leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, FchBaja }] }))).toEqual(
        { ok: true, valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false, emision: "CAE" }] },
      );
    }
  });

  it("FchBaja con el texto exacto «NULL» (lo que ARCA manda sin baja, según conocimiento público; SIN VERIFICAR con grabación): no está dado de baja", () => {
    expect(
      leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, FchBaja: "NULL" }] })),
    ).toEqual({
      ok: true,
      valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false, emision: "CAE" }],
    });
  });

  it("FchBaja de 8 dígitos: dado de baja", () => {
    expect(
      leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, FchBaja: "20260131" }] })),
    ).toEqual({
      ok: true,
      valor: [{ numero: 1, bloqueado: false, dadoDeBaja: true, emision: "CAE" }],
    });
  });

  it("un ResultGet vacío es una lista vacía, no un error", () => {
    expect(leer(respuestaDePtosVentaDelManual({ puntos: [] }))).toEqual({ ok: true, valor: [] });
  });

  it("sin ResultGet y sin errores no se entiende (el lector de tablas ya lo trata así): servicio no disponible, no «sin puntos de venta»", () => {
    expect(leer(respuestaDePtosVentaDelManual())).toMatchObject({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE" },
    });
  });

  it("EmisionTipo «CAE» y «CAEA» se leen tal cual (igualdad exacta)", () => {
    const con = (EmisionTipo: string) =>
      leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, EmisionTipo }] }));
    expect(con("CAE")).toEqual({
      ok: true,
      valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false, emision: "CAE" }],
    });
    expect(con("CAEA")).toEqual({
      ok: true,
      valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false, emision: "CAEA" }],
    });
  });
});

describe("EmisionTipo con otra forma: toda la respuesta es «servicio no disponible» (fail closed), con el valor saneado en el detalle", () => {
  const con = (EmisionTipo: string | undefined) =>
    leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, EmisionTipo }] }));

  it.each([
    ["ausente", undefined, "FORMA_INVALIDA"],
    ["vacío", "", "FORMA_INVALIDA"],
    ["en minúscula", "cae", "cae"],
    ["CAEAX", "CAEAX", "CAEAX"],
    ["«NULL»", "NULL", "NULL"],
    ["«CAE - CAEA»", "CAE - CAEA", "FORMA_INVALIDA"],
    ["de más de 8 caracteres", "ABCDEFGHI", "FORMA_INVALIDA"],
    ["con signos", "C@E", "FORMA_INVALIDA"],
  ] as const)("%s", (_nombre, EmisionTipo, enElDetalle) => {
    expect(con(EmisionTipo)).toEqual(NO_SE_ENTIENDE_EMISION(enElDetalle));
  });

  it("« CAE» y «CAE » (con espacios) se rechazan (el lector XML recorta los espacios antes, por eso se prueba sobre las filas ya leídas)", () => {
    for (const EmisionTipo of [" CAE", "CAE ", "CAE\n"]) {
      const fila = { Nro: "1", Bloqueado: "N", EmisionTipo };
      expect(aPuntosDeVentaDeArca(ok([fila]))).toEqual(NO_SE_ENTIENDE_EMISION("FORMA_INVALIDA"));
    }
  });

  it("si lo ilegible es otro campo y EmisionTipo está bien, el detalle no lo menciona", () => {
    expect(aPuntosDeVentaDeArca(ok([{ Nro: "x", Bloqueado: "N", EmisionTipo: "CAE" }]))).toEqual(
      NO_SE_ENTIENDE,
    );
  });
});

describe("lo que no se entiende no se interpreta: toda la respuesta es «servicio no disponible»", () => {
  const con = (p: PtoVentaDelManual) => leer(respuestaDePtosVentaDelManual({ puntos: [p] }));

  it.each([
    ["Nro que no es un número", { ...habilitado, Nro: "uno" }],
    ["Nro de más de 5 dígitos (el manual dice Int(5))", { ...habilitado, Nro: "100000" }],
    ["Nro vacío", { ...habilitado, Nro: "" }],
    ["Nro ausente", { ...habilitado, Nro: undefined }],
    ["Bloqueado distinto de S o N", { ...habilitado, Bloqueado: "X" }],
    ["Bloqueado en minúscula", { ...habilitado, Bloqueado: "s" }],
    ["Bloqueado vacío", { ...habilitado, Bloqueado: "" }],
    ["Bloqueado ausente (el manual lo marca obligatorio)", { ...habilitado, Bloqueado: undefined }],
    ["FchBaja que no son 8 dígitos", { ...habilitado, FchBaja: "2026-01-31" }],
    ["FchBaja con un texto cualquiera", { ...habilitado, FchBaja: "cualquiera" }],
    ["FchBaja «null» en minúscula", { ...habilitado, FchBaja: "null" }],
    ["FchBaja «Null»", { ...habilitado, FchBaja: "Null" }],
    ["FchBaja «NULO»", { ...habilitado, FchBaja: "NULO" }],
    ["FchBaja de 7 dígitos (ceros)", { ...habilitado, FchBaja: "0000000" }],
    ["FchBaja de 7 dígitos (fecha)", { ...habilitado, FchBaja: "2026111" }],
  ] as const)("%s", (_nombre, punto) => {
    expect(con(punto)).toEqual(NO_SE_ENTIENDE);
  });

  it("FchBaja « NULL» o «NULL » (con espacios): se rechaza (el lector XML recorta los espacios antes, por eso se prueba sobre las filas ya leídas)", () => {
    for (const FchBaja of [" NULL", "NULL ", "NULL\n"]) {
      const fila = { Nro: "1", Bloqueado: "N", EmisionTipo: "CAE", FchBaja };
      expect(aPuntosDeVentaDeArca(ok([fila]))).toEqual(NO_SE_ENTIENDE);
    }
  });

  it("una sola fila ilegible invalida las demás (no se adivina cuál valía)", () => {
    expect(
      leer(respuestaDePtosVentaDelManual({ puntos: [habilitado, { ...habilitado, Nro: "x" }] })),
    ).toEqual(NO_SE_ENTIENDE);
  });

  it("una fila buena con «NULL» y otra mala: toda la respuesta se rechaza", () => {
    expect(
      leer(
        respuestaDePtosVentaDelManual({
          puntos: [
            { ...habilitado, FchBaja: "NULL" },
            { ...habilitado, Nro: "2", FchBaja: "null" },
          ],
        }),
      ),
    ).toEqual(NO_SE_ENTIENDE);
  });

  it("un hijo de ResultGet que no es un PtoVenta con campos no es una fila", () => {
    const cuerpo = respuestaDePtosVentaDelManual({ puntos: [] }).replace(
      "<ResultGet></ResultGet>",
      "<ResultGet>texto suelto</ResultGet>",
    );
    expect(leer(cuerpo).ok).toBe(false);
  });
});

describe("las fallas de ARCA no se confunden con una lista vacía", () => {
  it("602 solo, sin puntos de venta: la CUIT no tiene ninguno, es una lista vacía (no un servicio caído)", () => {
    expect(
      leer(
        respuestaDePtosVentaDelManual({
          errores: [{ codigo: 602, texto: "Sin datos con rutas C:\\secreto" }],
        }),
      ),
    ).toEqual({ ok: true, valor: [] });
  });

  it("602 junto a otro código, o con puntos de venta: no se sabe, servicio no disponible", () => {
    const con602Y500 = leer(
      respuestaDePtosVentaDelManual({
        errores: [
          { codigo: 602, texto: "m" },
          { codigo: 500, texto: "m" },
        ],
      }),
    );
    expect(con602Y500).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "ARCA respondió con errores (602, 500)" },
    });
    expect(
      leer(
        respuestaDePtosVentaDelManual({
          puntos: [habilitado],
          errores: [{ codigo: 602, texto: "m" }],
        }),
      ),
    ).toMatchObject({ ok: false, error: { codigo: "SERVICIO_NO_DISPONIBLE" } });
  });

  it("un error ya clasificado pasa tal cual por el lector (602 en una tabla común sigue siendo servicio no disponible)", () => {
    const comoTabla = clasificarParametros(
      {
        tipo: "RESPUESTA",
        estadoHttp: 200,
        cuerpo: respuestaDePtosVentaDelManual({ errores: [{ codigo: 602, texto: "m" }] }),
      },
      "FEParamGetPtosVenta",
    );
    expect(aPuntosDeVentaDeArca(comoTabla)).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "ARCA respondió con errores (602)" },
    });
  });

  it("600 y 601 (el token no sirve para esa CUIT): falta la autorización del servicio", () => {
    for (const codigo of [600, 601]) {
      const r = leer(respuestaDePtosVentaDelManual({ errores: [{ codigo, texto: "m" }] }));
      expect(r).toMatchObject({
        ok: false,
        error: { codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE" },
      });
    }
  });

  it("errores junto con puntos de venta: manda el error (nada se aprovecha de una respuesta con errores)", () => {
    const r = leer(
      respuestaDePtosVentaDelManual({
        puntos: [habilitado],
        errores: [{ codigo: 500, texto: "m" }],
      }),
    );
    expect(r).toMatchObject({ ok: false, error: { codigo: "SERVICIO_NO_DISPONIBLE" } });
  });

  it("HTTP que no es 200, XML ilegible, XML cortado y DOCTYPE: servicio no disponible, sin lista", () => {
    const valida = respuestaDePtosVentaDelManual({ puntos: [habilitado] });
    expect(leer(valida, 500).ok).toBe(false);
    expect(leer("no es xml").ok).toBe(false);
    expect(leer(valida.slice(0, valida.length - 30)).ok).toBe(false);
    expect(leer(`<!DOCTYPE x [<!ENTITY a "b">]>${valida}`).ok).toBe(false);
  });

  it("un Envelope de otra operación no se acepta como el de esta", () => {
    const deOtra = respuestaDePtosVentaDelManual({ puntos: [habilitado] }).replaceAll(
      "FEParamGetPtosVenta",
      "FEParamGetTiposDoc",
    );
    expect(leer(deOtra).ok).toBe(false);
  });

  it("lo que no llegó a leerse (sin respuesta del transporte) es servicio no disponible", () => {
    const sinRespuesta: RespuestaDeTransporte = { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" };
    const r = aPuntosDeVentaDeArca(clasificarParametros(sinRespuesta, "FEParamGetPtosVenta"));
    expect(r).toMatchObject({ ok: false, error: { codigo: "SERVICIO_NO_DISPONIBLE" } });
  });
});
