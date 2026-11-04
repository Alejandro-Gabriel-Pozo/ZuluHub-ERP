import { describe, expect, it } from "vitest";
import {
  respuestaDePtosVentaDelManual,
  type PtoVentaDelManual,
} from "../../../test/utilidades/arca-del-manual";
import { clasificarParametros } from "./clasificar";
import { aPuntosDeVentaDeArca } from "./puntos-de-venta-de-arca";
import type { RespuestaDeTransporte } from "./tipos";

/**
 * `FEParamGetPtosVenta` leído sobre una respuesta CONSTRUIDA DEL MANUAL (WSFE v4.8, l. 3046-3114), NO GRABADA: no hay una grabación de
 * ARCA real de esta operación. Dice «el lector entiende lo que el manual describe», no «ARCA contesta así». SIN VERIFICAR contra ARCA
 * real: qué manda ARCA en `FchBaja` cuando no hay baja, los literales de `EmisionTipo`, y qué contesta una CUIT sin puntos de venta.
 */

const leer = (cuerpo: string, estadoHttp = 200) =>
  aPuntosDeVentaDeArca(
    clasificarParametros({ tipo: "RESPUESTA", estadoHttp, cuerpo }, "FEParamGetPtosVenta"),
  );

const habilitado: PtoVentaDelManual = { Nro: "1", EmisionTipo: "CAE", Bloqueado: "N" };

const NO_SE_ENTIENDE = {
  ok: false,
  error: {
    codigo: "SERVICIO_NO_DISPONIBLE",
    detalle: "la lista de puntos de venta de ARCA no se pudo leer",
  },
};

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
        { numero: 1, bloqueado: false, dadoDeBaja: false },
        { numero: 2, bloqueado: true, dadoDeBaja: false },
        { numero: 3, bloqueado: false, dadoDeBaja: true },
      ],
    });
  });

  it("un solo PtoVenta (el lector XML no lo vuelve lista) se lee igual", () => {
    expect(leer(respuestaDePtosVentaDelManual({ puntos: [habilitado] }))).toEqual({
      ok: true,
      valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false }],
    });
  });

  it("FchBaja es opcional (el manual lo marca «N»): ausente o vacío es que no hay baja", () => {
    for (const FchBaja of [undefined, ""]) {
      expect(leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, FchBaja }] }))).toEqual(
        { ok: true, valor: [{ numero: 1, bloqueado: false, dadoDeBaja: false }] },
      );
    }
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

  it("EmisionTipo no cambia nada de lo que se lee (se ignora a propósito: D-77 no lo pide)", () => {
    const con = (EmisionTipo: string | undefined) =>
      leer(respuestaDePtosVentaDelManual({ puntos: [{ ...habilitado, EmisionTipo }] }));
    expect(con("CAEA")).toEqual(con("CAE"));
    expect(con(undefined)).toEqual(con("CAE"));
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
    ["FchBaja con un texto cualquiera", { ...habilitado, FchBaja: "NULL" }],
  ] as const)("%s", (_nombre, punto) => {
    expect(con(punto)).toEqual(NO_SE_ENTIENDE);
  });

  it("una sola fila ilegible invalida las demás (no se adivina cuál valía)", () => {
    expect(
      leer(respuestaDePtosVentaDelManual({ puntos: [habilitado, { ...habilitado, Nro: "x" }] })),
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
  it("errores de ARCA (no 600 ni 601): servicio no disponible, con los códigos y sin el texto de ARCA", () => {
    const r = leer(
      respuestaDePtosVentaDelManual({
        errores: [{ codigo: 602, texto: "Sin datos con rutas C:\\secreto" }],
      }),
    );
    expect(r).toEqual({
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
