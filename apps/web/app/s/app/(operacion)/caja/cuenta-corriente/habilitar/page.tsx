import { randomUUID } from "node:crypto";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLosClientesParaHabilitar,
  PLAZO_MAXIMO_PARA_LA_PANTALLA,
  puedeAdministrarCuentas,
} from "../../../../../../../servidor/cuenta-corriente-escritura";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeHabilitarCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/FormularioDeHabilitarCuenta.cliente";
import { clientesParaElegir } from "../../../../../../../ui/plantillas/cuenta-corriente/modelo-de-cuenta-corriente";
import { RUTA_DE_LA_CUENTA_CORRIENTE } from "../../../../../../../ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { textosDeCuentaCorriente } from "../../../../../../../ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente";
import { habilitarCuentaAccion } from "../../../../acciones-de-cuenta-corriente";

// `/caja/cuenta-corriente/habilitar`: habilitar la cuenta corriente de un cliente (maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, «Habilitar cuenta»). Los clientes que se ofrecen son los activos sin cuenta (también los
// sin CUIT: el formulario avisa y no deja habilitar); la lista la entrega el servidor y exige `cuenta_corriente.administrar`. El identificador del alta se genera UNA vez al abrir el formulario y viaja ligado a la acción:
// repetir el envío (doble toque, red cortada) devuelve la misma ficha sin duplicarla. Todo lo demás lo decide el servidor al enviar.
export default async function PaginaDeHabilitarCuenta() {
  const textos = textosDeCuentaCorriente();
  return pantallaDeOperacion(
    { titulo: "cuenta_corriente.habilitar.titulo" },
    async ({ contexto }) => {
      const respuesta = await cargarLosClientesParaHabilitar(contexto);
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      return (
        <FormularioDeHabilitarCuenta
          accion={habilitarCuentaAccion.bind(null, randomUUID())}
          textos={textos}
          clientes={clientesParaElegir(respuesta.dato.clientes, textos)}
          digitosDelPlazo={String(PLAZO_MAXIMO_PARA_LA_PANTALLA).length}
          hrefDeCancelar={RUTA_DE_LA_CUENTA_CORRIENTE}
          puedeGuardar={await puedeAdministrarCuentas(contexto)}
        />
      );
    },
  );
}
