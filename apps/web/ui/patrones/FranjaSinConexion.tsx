import { Icono } from "../iconos/Icono";
import { useEnLinea } from "./useEnLinea";
import estilos from "./FranjaSinConexion.module.css";

export type PropsDeFranjaSinConexion = Readonly<{
  /** El texto ya resuelto («Sin conexión. Cuando vuelva, podés seguir: no se envió nada.»). */
  texto: string;
}>;

/**
 * Franja fija mientras no hay conexión. No se puede descartar: se va sola cuando vuelve la red. Los
 * botones de enviar quedan deshabilitados con su motivo (`useEnvioConClave`); la venta en curso queda
 * en pantalla y nada se guarda para enviar después (no hay modo sin conexión).
 */
export function FranjaSinConexion({ texto }: PropsDeFranjaSinConexion) {
  const enLinea = useEnLinea();
  if (enLinea) return null;
  return (
    <div className={estilos["franja"]} role="status">
      <Icono clave="sin-conexion" tamano="medio" decorativo />
      <span>{texto}</span>
    </div>
  );
}
