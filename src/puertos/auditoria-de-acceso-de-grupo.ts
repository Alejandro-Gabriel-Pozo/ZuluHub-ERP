import type { EmpresaId } from "../primitivas/identificadores/marca";

/**
 * Lo que una consulta de grupo deja asentado: a qué empresa accedió. NO lleva el tenant ni la persona:
 * los pone el adaptador desde el contexto firmado de la transacción, y la base (política
 * `auditoria_acceso_grupo_alta`) exige además que coincidan con él y que la persona sea propietaria
 * activa. Se audita el ACCESO, no el contenido (R3).
 */
export type RegistroDeAccesoDeGrupo = Readonly<{
  /** `null`: consultó la lista de empresas del grupo, no una en particular. */
  empresaId: EmpresaId | null;
}>;

/**
 * Puerto de auditoría de los accesos a la vista de grupo (solo inserción; un disparador impide cambiar
 * o borrar). Es la ÚNICA escritura que una consulta de grupo puede hacer (excepción declarada a
 * ADR-005, por R3): va en la MISMA transacción que la lectura, así que si la lectura se repite por un
 * conflicto de serialización el registro también, y queda uno solo. Solo existe con un contexto de
 * grupo; con cualquier otro lanza `RangeError`.
 */
export interface AuditoriaDeAccesoDeGrupo {
  registrar(registro: RegistroDeAccesoDeGrupo): Promise<void>;
}
