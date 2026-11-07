/**
 * La puerta de «Elegir sucursal» al ingresar (dueño, 2026-11-05): hay que pasar por la pantalla cuando la persona tiene sucursales
 * para elegir y todavía no tiene una efectiva (no eligió y no hay una única abierta que se tome sola, D-36). Una regla, un lugar:
 * la usa el Inicio. Previene: dejar entrar sin sucursal (el servidor cerraría con error) o pedir elegir cuando ya hay una.
 * Chequeo: `test/web/puerta-de-sucursal.test.ts`.
 */
export function debeElegirSucursal(cantidadElegibles: number, efectiva: string): boolean {
  return cantidadElegibles > 0 && efectiva === "";
}
