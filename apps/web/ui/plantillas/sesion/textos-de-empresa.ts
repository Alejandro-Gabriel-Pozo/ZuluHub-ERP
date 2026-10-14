import type { RolDeEmpresa } from "../../../../../src/capacidades/permisos/roles";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { EstadoEfectivo } from "../../../../../src/contexto/estados";

/** Una empresa tal como la muestran «elegir empresa», el inicio y la cuenta. */
export type EmpresaParaMostrar = Readonly<{
  empresaId: string;
  nombre: string;
  rol: RolDeEmpresa;
  estadoEfectivo: EstadoEfectivo;
}>;

/** «Gerente», «Administrador», «Operador»: el texto del rol, que la marca puede redactar a su manera. */
export function textoDelRol(rol: RolDeEmpresa, diccionario: DiccionarioResuelto): string {
  return texto(diccionario, `rol.${rol.toLowerCase() as Lowercase<RolDeEmpresa>}.nombre`);
}

/** Por qué la empresa no opera (`motivo.empresa.<estado>`), o `null` si opera. */
export function textoDeEstadoDeEmpresa(
  estado: EstadoEfectivo,
  diccionario: DiccionarioResuelto,
): string | null {
  if (estado === "OPERA") return null;
  return texto(
    diccionario,
    `motivo.empresa.${estado.toLowerCase() as Lowercase<Exclude<EstadoEfectivo, "OPERA">>}`,
  );
}
