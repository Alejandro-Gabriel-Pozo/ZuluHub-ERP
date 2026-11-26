import { pantallaDeMovimiento } from "../../../../../../../pantallas/pantalla-de-movimiento";

// `/stock/movimientos/salida`: el formulario de Salida a mano (maqueta `stock.html`, 09/11/2026). Todo lo que hace vive en `pantallas/pantalla-de-movimiento.tsx`.
export default function PaginaDeSalida() {
  return pantallaDeMovimiento("SALIDA");
}
