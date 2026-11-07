import { texto } from "../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { sucursalesDelContexto } from "../../../../../servidor/empresas";
import {
  puedeEditarElContactoDeLaSucursal,
  puedeVerLaConfiguracionFiscal,
} from "../../../../../servidor/modulos";
import { RUTAS_DE_CONFIGURACION } from "../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { PantallaDeCuenta } from "../../../../../ui/plantillas/sesion/PantallaDeCuenta";
import { RUTAS_DE_CUENTA } from "../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import { cerrarSesionAccion } from "../../acciones";

// Cuenta: la empresa y el rol, la sucursal de este dispositivo, el acceso a Configuración fiscal y al Contacto de la sucursal (cada uno solo con su permiso) y
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
      // Solo para quien puede editar sucursales hoy (gerente y administrador): el servidor lo decide y vuelve a validar al abrir y al guardar.
      const contactoDeLaSucursal = (await puedeEditarElContactoDeLaSucursal(contexto))
        ? {
            texto: texto({}, "sucursal.contacto_titulo"),
            href: RUTAS_DE_CUENTA.contactoDeLaSucursal,
          }
        : undefined;
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
