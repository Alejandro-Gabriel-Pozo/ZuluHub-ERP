import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

export type Sucursal = Readonly<{
  id: SucursalId;
  empresaId: EmpresaId;
  nombre: string;
  activa: boolean;
  version: number;
}>;

export type ErrorDeSucursal = "NOMBRE_DE_SUCURSAL_INVALIDO";

export function nombreDeSucursalValido(texto: string): Resultado<string, ErrorDeSucursal> {
  const limpio = texto.trim();
  return limpio === "" ? err("NOMBRE_DE_SUCURSAL_INVALIDO") : ok(limpio);
}
