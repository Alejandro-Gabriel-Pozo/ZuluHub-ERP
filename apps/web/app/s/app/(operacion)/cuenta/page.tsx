import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { sucursalesDelContexto } from "../../../../../servidor/empresas";
import { PantallaDeCuenta } from "../../../../../ui/plantillas/sesion/PantallaDeCuenta";
import { cerrarSesionAccion } from "../../acciones";

// Cuenta: la empresa y el rol, la sucursal de este dispositivo y cerrar sesión.
export default function PaginaDeCuenta() {
  return pantallaDeOperacion(
    { titulo: "cuenta.titulo", actual: "cuenta" },
    async ({ empresa, contexto }) => {
      // Una persona sin permiso para ver sucursales (un operador) no recibe el selector; no es un error de pantalla.
      const sucursales = await sucursalesDelContexto(contexto);
      return (
        <PantallaDeCuenta
          empresa={empresa}
          sucursales={sucursales.ok ? sucursales.dato : []}
          accionDeCerrarSesion={cerrarSesionAccion}
        />
      );
    },
  );
}
