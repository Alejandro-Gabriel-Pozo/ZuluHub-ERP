import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLosPuntosDeVenta } from "../../../../../../../servidor/configuracion-fiscal";
import { sucursalesParaElegir } from "../../../../../../../servidor/sucursal-elegida";
import { FormularioDePuntoDeVenta } from "../../../../../../../ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { ConMigas } from "../../../../../../../ui/plantillas/configuracion-fiscal/MigasDeConfiguracion";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { crearPuntoDeVentaAccion } from "../../../../acciones-de-configuracion-fiscal";

// `/configuracion-fiscal/puntos-de-venta/nuevo`: el alta de un punto de venta. El emisor sale del servidor (D-47) y las sucursales, de
// las de la empresa; el formulario genera las claves de idempotencia al abrirse.
export default async function PaginaDeAltaDePuntoDeVenta() {
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_pv_agregar" },
    async ({ contexto }) => {
      const puntos = await cargarLosPuntosDeVenta(contexto);
      if (!puntos.ok) return <ErrorDelDetalle error={puntos.error} />;
      const sucursales = await sucursalesParaElegir(contexto);
      if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
      return (
        <ConMigas
          tramos={[
            {
              texto: texto({}, "fiscal.pantalla.config_titulo"),
              href: RUTAS_DE_CONFIGURACION.lista,
            },
            {
              texto: texto({}, "fiscal.pantalla.config_puntos_de_venta"),
              href: RUTAS_DE_CONFIGURACION.puntosDeVenta,
            },
          ]}
        >
          <FormularioDePuntoDeVenta
            emisorId={puntos.dato.emisorId}
            original={null}
            sucursales={sucursales.dato.map((s) => ({
              valor: s.id,
              etiqueta: s.activa
                ? s.nombre
                : texto({}, "fiscal.pantalla.listado_sucursal_cerrada", { nombre: s.nombre }),
            }))}
            guardar={crearPuntoDeVentaAccion}
            rutaAlTerminar={RUTAS_DE_CONFIGURACION.puntosDeVenta}
            rutaAlCancelar={RUTAS_DE_CONFIGURACION.puntosDeVenta}
          />
        </ConMigas>
      );
    },
  );
}
