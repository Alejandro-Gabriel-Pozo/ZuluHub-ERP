import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { CargaDeAutorizacionSinMemoria } from "../../puertos/autorizacion";
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

  it("caso inyectado: la de lectura NO entra donde se pide la de escritura (si `tsc` deja de fallar acá, se perdió la barrera)", () => {
    // @ts-expect-error la carga que memoriza no es asignable a la que no memoriza
    const mal: CargaDeAutorizacionSinMemoria = crearAutorizacionDeLecturaDePostgres(SIN_BASE);
    expect(mal.memoriza).toBe(true);
    const bien: CargaDeAutorizacionSinMemoria = crearAutorizacionDePostgres(SIN_BASE);
    expect(bien.memoriza).toBeUndefined();
  });
});
