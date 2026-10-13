import { describe, expect, expectTypeOf, it } from "vitest";
import type { EmisorId } from "../primitivas/identificadores/marca";
import type { ConsultaDeEmisores, EstadoDeEmisor } from "./emisores";

/**
 * El contrato del puerto de emisores (K8, X20): tres estados exactos, con `NO_EXISTE` como único valor
 * de «no hay» (caja lo llamaba con otro nombre y otro valor), y una consulta que recibe un `EmisorId`.
 * Son pruebas de tipos: si el contrato cambia, `npm run typecheck` falla acá.
 */
describe("el puerto de emisores", () => {
  it("el estado tiene exactamente tres valores", () => {
    expectTypeOf<EstadoDeEmisor>().toEqualTypeOf<"ACTIVO" | "INACTIVO" | "NO_EXISTE">();
  });

  it("estado recibe un EmisorId y devuelve el estado, atado a la transacción (sin pasar tx)", () => {
    expectTypeOf<ConsultaDeEmisores["estado"]>().toEqualTypeOf<
      (emisorId: EmisorId) => Promise<EstadoDeEmisor>
    >();
    expectTypeOf<keyof ConsultaDeEmisores>().toEqualTypeOf<"estado">();
  });

  it("un texto sin la marca de EmisorId no es un emisor", () => {
    const noSeEjecuta = (consulta: ConsultaDeEmisores) => {
      // @ts-expect-error un texto cualquiera no es un EmisorId
      void consulta.estado("e1");
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});
