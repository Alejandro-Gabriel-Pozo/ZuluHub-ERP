import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type {
  CargaDeAutorizacionDeLectura,
  CargaDeAutorizacionSinMemoria,
} from "../../puertos/autorizacion";
import {
  crearAutorizacionDeLecturaDePostgres,
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "./autorizacion";

/**
 * La memoria de permisos solo existe en la fábrica de LECTURA; la de escritura no la tiene ni puede recibirla. Previene: que una transacción
 * que escribe decida con un permiso viejo porque alguien le pasó el adaptador que memoriza. Nada se consulta acá (la base no se toca).
 */
const SIN_BASE = {} as Kysely<AutorizacionDb>;

describe("las dos fábricas de la carga de autorización", () => {
  it("la de escritura no memoriza y la de lectura lleva la marca de que sí", () => {
    expect("memoriza" in crearAutorizacionDePostgres(SIN_BASE)).toBe(false);
    expect(crearAutorizacionDeLecturaDePostgres(SIN_BASE).memoriza).toBe(true);
  });

  it("la de lectura NO entra donde se pide la de escritura (si `tsc` falla acá, se perdió o cambió la barrera de tipos)", () => {
    // Prueba de tipos: el tipo `Asignable<...>` tiene que ser exactamente `false` para la de lectura y `true` para la de escritura.
    const lecturaEnEscritura: Asignable<
      CargaDeAutorizacionDeLectura,
      CargaDeAutorizacionSinMemoria
    > = false;
    const escrituraEnEscritura: Asignable<
      ReturnType<typeof crearAutorizacionDePostgres>,
      CargaDeAutorizacionSinMemoria
    > = true;
    expect(lecturaEnEscritura).toBe(false);
    expect(escrituraEnEscritura).toBe(true);
  });
});

type Asignable<A, B> = [A] extends [B] ? true : false;
