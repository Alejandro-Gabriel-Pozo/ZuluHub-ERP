import { texto } from "../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { sucursalesDelContexto } from "../../../../../servidor/empresas";
import { puedeVerLaConfiguracionFiscal } from "../../../../../servidor/modulos";
import { RUTAS_DE_CONFIGURACION } from "../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { PantallaDeCuenta } from "../../../../../ui/plantillas/sesion/PantallaDeCuenta";
import { cerrarSesionAccion } from "../../acciones";

// Cuenta: la empresa y el rol, la sucursal de este dispositivo, el acceso a Configuración fiscal (solo con el permiso de esa pantalla) y
// cerrar sesión.
export default function PaginaDeCuenta() {
  return pantallaDeOperacion(
    { titulo: "cuenta.titulo", actual: "cuenta" },
    async ({ empresa, contexto }) => {
      // Una persona sin permiso para ver sucursales (un operador) no recibe el selector; no es un error de pantalla.
      const sucursales = await sucursalesDelContexto(contexto);
      const configuracionFiscal = (await puedeVerLaConfiguracionFiscal(contexto))
        ? {
            texto: texto({}, "fiscal.pantalla.config_titulo"),
            href: RUTAS_DE_CONFIGURACION.lista,
          }
        : undefined;
      return (
        <PantallaDeCuenta
          empresa={empresa}
          sucursales={sucursales.ok ? sucursales.dato : []}
          {...(configuracionFiscal === undefined ? {} : { configuracionFiscal })}
          accionDeCerrarSesion={cerrarSesionAccion}
        />
      );
    },
  );
}
