import { pantallaDeMovimiento } from "../../../../../../../pantallas/pantalla-de-movimiento";

// `/stock/movimientos/entrada`: el formulario de Entrada a mano (maqueta `stock.html`, 09/11/2026). Todo lo que hace vive en `pantallas/pantalla-de-movimiento.tsx`.
export default function PaginaDeEntrada() {
  return pantallaDeMovimiento("ENTRADA");
}
