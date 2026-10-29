import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosPuntosDeVenta } from "../../../../../../servidor/configuracion-fiscal";
import { accionesDePuntosDeVenta } from "../../../../../../servidor/modulos";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { armarLaListaDePuntosDeVenta } from "../../../../../../ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";
import { PantallaDePuntosDeVenta } from "../../../../../../ui/plantillas/configuracion-fiscal/PantallaDePuntosDeVenta";
import { ErrorDelDetalle } from "../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";

// `/configuracion-fiscal/puntos-de-venta`: todos los puntos de venta del emisor, también los que no están activos (D-60).
export default async function PaginaDePuntosDeVenta() {
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_puntos_de_venta" },
    async ({ contexto }) => {
      const puntos = await cargarLosPuntosDeVenta(contexto);
      if (!puntos.ok) return <ErrorDelDetalle error={puntos.error} />;
      const acciones = await accionesDePuntosDeVenta(contexto);
      return (
        <PantallaDePuntosDeVenta
          migas={[
            {
              texto: texto({}, "fiscal.pantalla.config_titulo"),
              href: RUTAS_DE_CONFIGURACION.lista,
            },
          ]}
          filas={armarLaListaDePuntosDeVenta(puntos.dato.items)}
          vacio={texto({}, "fiscal.pantalla.config_pv_vacio")}
          ayuda={texto({}, "fiscal.pantalla.config_pv_ayuda")}
          agregar={{
            texto: texto({}, "fiscal.pantalla.config_pv_agregar"),
            href: RUTAS_DE_CONFIGURACION.nuevoPuntoDeVenta,
            oferta: acciones.agregar,
          }}
        />
      );
    },
  );
}
