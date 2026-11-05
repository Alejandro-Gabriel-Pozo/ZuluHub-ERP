/**
 * El nombre de la sucursal tal como lo congeló el comprobante al nacer (D-114): lo que copió la base de la sucursal VIGENTE en ese
 * momento; nunca se lee de la sucursal de hoy, así reimprimir da lo mismo aunque la sucursal se renombre. Nulo = el comprobante es
 * anterior a 0020.
 */
export type NombreDeSucursalCongelado = string | null;

/**
 * Lo que el modelo de impresión expone de la sucursal (D-114). SIN rótulo: su texto no está decidido. Forma mínima: un objeto con
 * `nombre`, para que un dato más de la sucursal se sume sin cambiar el tipo del campo.
 */
export type SucursalImpresa = Readonly<{ nombre: string }>;

/**
 * La sucursal a imprimir, o `null` si el comprobante no congeló nombre (nada que mostrar). Un texto vacío tampoco se imprime: la base
 * no lo admite (CHECK `comprobante_sucursal_nombre_ck`), y si llegara, se cierra y no se muestra un renglón en blanco.
 */
export function sucursalImpresa(nombre: NombreDeSucursalCongelado): SucursalImpresa | null {
  if (nombre === null || nombre === "") return null;
  return { nombre };
}
