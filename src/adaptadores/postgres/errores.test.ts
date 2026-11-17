import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  ErrorDeConexionDeBase,
  causaDeConexion,
  esConexionCortada,
  esPozoAgotado,
  traducirErrorDeBase,
} from "./errores";

/** El pozo agotado sale tipado (no como excepción cruda), sin detalle técnico; lo demás que no es de la base sigue sin traducirse. */
describe("pozo agotado", () => {
  it("el rechazo de `pg-pool` por espera agotada se reconoce y se traduce a un error inesperado sin sqlstate", () => {
    const error = new Error("timeout exceeded when trying to connect");
    expect(esPozoAgotado(error)).toBe(true);
    expect(traducirErrorDeBase(error)).toEqual({
      tipo: "Inesperado",
      sqlstate: null,
      mensaje: "no hubo una conexión libre a la base a tiempo (pozo agotado)",
    });
  });

  it("otras excepciones no se confunden con un pozo agotado ni se traducen", () => {
    for (const otro of [
      new Error("timeout exceeded"),
      new Error("Timeout exceeded when trying to connect"),
      new RangeError("timeout exceeded when trying to connect "),
      "timeout exceeded when trying to connect",
      null,
    ]) {
      expect(esPozoAgotado(otro)).toBe(false);
      expect(traducirErrorDeBase(otro)).toBeNull();
    }
  });
});

/** El corte de la conexión sale tipado y genérico: sin host, puerto, usuario ni el mensaje de `pg` o del sistema. */
describe("conexión cortada", () => {
  const GENERICO = {
    tipo: "Inesperado",
    sqlstate: null,
    mensaje: "se cortó la conexión con la base",
  };
  const conCodigo = (mensaje: string, code: string) => Object.assign(new Error(mensaje), { code });
  const delServidor = (code: string, mensaje: string) =>
    Object.assign(new pg.DatabaseError(mensaje, 0, "error"), { code });

  it.each([
    "Connection terminated unexpectedly",
    "Connection terminated",
    "Client has encountered a connection error and is not queryable",
    "Client was closed and is not queryable",
  ])("el mensaje de `pg` «%s» se reconoce y se traduce a un error genérico", (mensaje) => {
    expect(esConexionCortada(new Error(mensaje))).toBe(true);
    expect(traducirErrorDeBase(new Error(mensaje))).toEqual(GENERICO);
  });

  it.each([
    "ECONNRESET",
    "ECONNABORTED",
    "EPIPE",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ])("un error de red %s (con el host en su mensaje) sale sin el host", (code) => {
    const error = conCodigo(`connect ${code} 10.1.2.3:5432 ep-secreto.ejemplo.tech`, code);
    expect(esConexionCortada(error)).toBe(true);
    expect(traducirErrorDeBase(error)).toEqual(GENERICO);
    expect(JSON.stringify(traducirErrorDeBase(error))).not.toContain("10.1.2.3");
  });

  it.each(["57P01", "57P02", "57P03", "08000", "08003", "08006", "08P01"])(
    "el aviso del servidor con SQLSTATE %s (el backend se cierra) sale genérico, sin su detalle",
    (code) => {
      const error = delServidor(code, "terminating connection due to administrator command");
      expect(esConexionCortada(error)).toBe(true);
      // El SQLSTATE queda para el registro; el mensaje sigue genérico y sin el texto del servidor.
      expect(traducirErrorDeBase(error)).toEqual({ ...GENERICO, sqlstate: code });
    },
  );

  it("otras fallas no se toman por un corte: un SQLSTATE vecino, un mensaje parecido o un código desconocido", () => {
    for (const code of ["57014", "57P04", "07000", "09000", "0A000", "28P01", "53300", "XX000"]) {
      expect(esConexionCortada(delServidor(code, "otro"))).toBe(false);
    }
    for (const otro of [
      new Error("connection terminated unexpectedly"),
      new Error("Connection terminated unexpectedly."),
      new Error("Connection terminated due to timeout"),
      conCodigo("x", "EACCES"),
      Object.assign(new Error("x"), { code: 104 }),
      "Connection terminated",
      undefined,
    ]) {
      expect(esConexionCortada(otro)).toBe(false);
      expect(traducirErrorDeBase(otro)).toBeNull();
    }
  });

  it("un error de conexión ya tipado (lo que lanza el pozo) se traduce con su mensaje fijo y su causa", () => {
    expect(new ErrorDeConexionDeBase("POZO_AGOTADO").message).toBe(
      "no hubo una conexión libre a la base a tiempo (pozo agotado)",
    );
    expect(new ErrorDeConexionDeBase("CONEXION_CORTADA").message).toBe(
      "se cortó la conexión con la base",
    );
    expect(causaDeConexion(new ErrorDeConexionDeBase("POZO_AGOTADO"))).toBe("POZO_AGOTADO");
    expect(causaDeConexion(new ErrorDeConexionDeBase("CONEXION_CORTADA"))).toBe("CONEXION_CORTADA");
    expect(esConexionCortada(new ErrorDeConexionDeBase("POZO_AGOTADO"))).toBe(false);
    expect(traducirErrorDeBase(new ErrorDeConexionDeBase("POZO_AGOTADO"))).toEqual({
      tipo: "Inesperado",
      sqlstate: null,
      mensaje: "no hubo una conexión libre a la base a tiempo (pozo agotado)",
    });
    expect(traducirErrorDeBase(new ErrorDeConexionDeBase("CONEXION_CORTADA"))).toEqual(GENERICO);
    expect(new ErrorDeConexionDeBase("CONEXION_CORTADA").name).toBe("ErrorDeConexionDeBase");
  });

  it("el pozo agotado crudo de `pg-pool` tiene causa de pozo; lo desconocido, ninguna", () => {
    expect(causaDeConexion(new Error("timeout exceeded when trying to connect"))).toBe(
      "POZO_AGOTADO",
    );
    expect(causaDeConexion(new Error("otra cosa"))).toBeNull();
  });
});
