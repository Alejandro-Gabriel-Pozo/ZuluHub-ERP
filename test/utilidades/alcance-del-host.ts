import type { AlcanceDelHost } from "../../src/capacidades/experiencia/puerta";

/** El alcance de un host COMPARTIDO de una marca (dueño: la marca): lo que arman las pruebas que no son de un host dedicado. */
export const deLaMarca = (marcaId: string): AlcanceDelHost => ({
  marcaId,
  duenio: { tipo: "MARCA" },
});

/** El alcance de un host DEDICADO a una empresa de esa marca. */
export const deLaEmpresa = (marcaId: string, empresaId: string): AlcanceDelHost => ({
  marcaId,
  duenio: { tipo: "EMPRESA", empresaId },
});
