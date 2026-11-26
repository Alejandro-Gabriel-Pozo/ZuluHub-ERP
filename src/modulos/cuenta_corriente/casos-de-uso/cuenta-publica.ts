import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import type { CuentaDelCliente, EstadoDeCuenta } from "../dominio/condiciones";

/** Lo que sale de los casos de uso: la ficha con el límite como texto decimal exacto (ADR-006), sin la clave ni la huella. */
export type CuentaPublica = Readonly<{
  id: string;
  parteId: string;
  plazoDias: number;
  limite: ImporteJson;
  estado: EstadoDeCuenta;
  motivoDeSuspension: string | null;
  version: number;
}>;

export function aCuentaPublica(cuenta: CuentaDelCliente): CuentaPublica {
  return {
    id: cuenta.id,
    parteId: cuenta.parteId,
    plazoDias: cuenta.plazoDias,
    limite: importeAJson(cuenta.limite),
    estado: cuenta.estado,
    motivoDeSuspension: cuenta.motivoDeSuspension,
    version: cuenta.version,
  };
}
