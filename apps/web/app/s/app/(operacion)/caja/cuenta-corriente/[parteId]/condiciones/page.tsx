import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cargarLaFichaDeLaCuenta } from "../../../../../../../../servidor/cuenta-corriente";
import {
  PLAZO_MAXIMO_PARA_LA_PANTALLA,
  puedeAdministrarCuentas,
} from "../../../../../../../../servidor/cuenta-corriente-escritura";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeCondicionesDeCuenta } from "../../../../../../../../ui/plantillas/cuenta-corriente/FormularioDeCondicionesDeCuenta.cliente";
import { rutaDeLaFichaDeCuenta } from "../../../../../../../../ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { textosDeCuentaCorriente } from "../../../../../../../../ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente";
import { cambiarCondicionesAccion } from "../../../../../acciones-de-cuenta-corriente";

type PropsDePagina = Readonly<{ params: Promise<{ parteId: string }> }>;

// `/caja/cuenta-corriente/[parteId]/condiciones`: cambiar el plazo y el límite de un cliente (botón «Cambiar plazo o límite» de la ficha). El id de la dirección es lo único que viene del navegador: uno que no es de un
// cliente con cuenta de la empresa sale como el genérico. La acción lleva la ficha y la versión que se vio: si otra persona la cambió antes, el servidor rechaza. «Guardar» sale apagado sin `cuenta_corriente.administrar`.
export default async function PaginaDeCondicionesDeCuenta({ params }: PropsDePagina) {
  const { parteId } = await params;
  const textos = textosDeCuentaCorriente();
  return pantallaDeOperacion(
    { titulo: "cuenta_corriente.ficha.cambiar_condiciones" },
    async ({ contexto }) => {
      const respuesta = await cargarLaFichaDeLaCuenta(contexto, parteId);
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      const ficha = respuesta.dato;
      return (
        <FormularioDeCondicionesDeCuenta
          key={`${ficha.cuentaId}-${String(ficha.version)}`}
          accion={cambiarCondicionesAccion.bind(null, ficha.parteId, ficha.cuentaId, ficha.version)}
          textos={{
            plazo: textos.plazo,
            limite: textos.limiteDeCreditoEnPesos,
            guardar: textos.guardar,
            cancelar: textos.cancelar,
          }}
          actual={{ plazoDias: ficha.plazoDias, limite: ficha.limite.monto }}
          digitosDelPlazo={String(PLAZO_MAXIMO_PARA_LA_PANTALLA).length}
          hrefDeCancelar={rutaDeLaFichaDeCuenta(ficha.parteId)}
          puedeGuardar={await puedeAdministrarCuentas(contexto)}
        />
      );
    },
  );
}
