import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { accionesDeLaPantallaDeCaja } from "../../../../../servidor/ofertas-de-caja";
import { cargarLaCajaDeLaSucursal } from "../../../../../servidor/sesion-de-caja";
import { ErrorDelDetalle } from "../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeCaja } from "../../../../../ui/plantillas/caja/PantallaDeCaja";
import { abrirCajaAccion } from "../../acciones-de-sesion-de-caja";

// `/caja`: la pantalla «Caja» del mostrador de la sucursal elegida en el dispositivo (maqueta `caja.html`): hoy, abrir la caja. Sin sucursal elegida no se asume «todas»: sale el genérico. Con el
// módulo `caja` en desarrollo el servidor rechaza la lectura y sale su motivo.
export default async function PaginaDeLaCaja() {
  return pantallaDeOperacion({ titulo: "caja.pantalla.titulo" }, async ({ contexto }) => {
    const lectura = await cargarLaCajaDeLaSucursal(contexto);
    if (!lectura.ok) return <ErrorDelDetalle error={lectura.error} />;
    return (
      <PantallaDeCaja
        cajas={lectura.dato.cajas}
        permisos={await accionesDeLaPantallaDeCaja(contexto)}
        acciones={{ abrir: abrirCajaAccion }}
      />
    );
  });
}
