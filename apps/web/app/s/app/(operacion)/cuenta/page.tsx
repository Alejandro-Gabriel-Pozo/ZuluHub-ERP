import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { sucursalesDelContexto } from "../../../../../servidor/empresas";
import { pantallasDeCuenta } from "../../../../../servidor/modulos";
import { PantallaDeCuenta } from "../../../../../ui/plantillas/sesion/PantallaDeCuenta";
import { cerrarSesionAccion } from "../../acciones";

// Cuenta: la empresa y el rol, la sucursal de este dispositivo, el acceso a Configuración fiscal y al Contacto de la sucursal (cada uno solo con su permiso) y
// cerrar sesión.
export default function PaginaDeCuenta() {
  return pantallaDeOperacion(
    { titulo: "cuenta.titulo", actual: "cuenta" },
    async ({ empresa, contexto }) => {
      // Una persona sin permiso para ver sucursales (un operador) no recibe el selector; no es un error de pantalla.
      const sucursales = await sucursalesDelContexto(contexto);
      // Las pantallas de Cuenta salen de la misma tabla del menú (`ui/navegacion/menu.ts`), con su módulo y su acción: el servidor decide y vuelve
      // a validar al abrir y al guardar.
      const pantallas = await pantallasDeCuenta(contexto);
      const configuracionFiscal = pantallas.get("configuracion-fiscal");
      const contactoDeLaSucursal = pantallas.get("contacto");
      return (
        <PantallaDeCuenta
          empresa={empresa}
          sucursales={sucursales.ok ? sucursales.dato : []}
          {...(configuracionFiscal === undefined ? {} : { configuracionFiscal })}
          {...(contactoDeLaSucursal === undefined ? {} : { contactoDeLaSucursal })}
          accionDeCerrarSesion={cerrarSesionAccion}
        />
      );
    },
  );
}
