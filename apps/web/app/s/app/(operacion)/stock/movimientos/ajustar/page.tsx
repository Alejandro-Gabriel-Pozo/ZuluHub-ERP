import { pantallaDeMovimiento } from "../../../../../../../pantallas/pantalla-de-movimiento";

// `/stock/movimientos/ajustar`: el formulario de Ajustar a mano (maqueta `stock.html`, 09/11/2026). Todo lo que hace vive en `pantallas/pantalla-de-movimiento.tsx`.
export default function PaginaDeAjustar() {
  return pantallaDeMovimiento("AJUSTAR");
}
