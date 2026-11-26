import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFichaDeLaCuenta } from "../../../../../../../servidor/cuenta-corriente";
import { puedeAdministrarCuentas } from "../../../../../../../servidor/cuenta-corriente-escritura";
import { Boton } from "../../../../../../../ui/componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../../../../../ui/componentes/EnlaceDeAccion";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeReactivarCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/FormularioDeReactivarCuenta.cliente";
import { FormularioDeSuspenderCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/FormularioDeSuspenderCuenta.cliente";
import { PantallaDeLaFichaDeCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/PantallaDeLaFichaDeCuenta";
import { armarLaFichaDeLaCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/modelo-de-cuenta-corriente";
import { rutaDeLasCondicionesDeCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { textosDeCuentaCorriente } from "../../../../../../../ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente";
import {
  reactivarCuentaAccion,
  suspenderCuentaAccion,
} from "../../../../acciones-de-cuenta-corriente";

type PropsDePagina = Readonly<{ params: Promise<{ parteId: string }> }>;

// `/caja/cuenta-corriente/[parteId]`: la ficha de un cliente con su estado de cuenta (maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, «Ficha y estado de cuenta» y «Ficha suspendida»). El id de la dirección
// es lo único que viene del navegador: el servidor lo busca entre las cuentas de la empresa; uno que no está (ajeno, inexistente, mal escrito) sale como el genérico y no dice cuál de los casos es. Las acciones
// que escriben («Cambiar plazo o límite», «Suspender cuenta» y «Reactivar cuenta») salen apagadas sin `cuenta_corriente.administrar` (ayuda: el servidor igual decide) y llevan la ficha y la versión que se vio.
export default async function PaginaDeLaFichaDeCuenta({ params }: PropsDePagina) {
  const { parteId } = await params;
  const textos = textosDeCuentaCorriente();
  return pantallaDeOperacion({ titulo: "cuenta_corriente.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaFichaDeLaCuenta(contexto, parteId);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const ficha = respuesta.dato;
    const puede = await puedeAdministrarCuentas(contexto);
    return conTitulo(
      armarLaFichaDeLaCuenta(ficha, textos).titulo,
      <PantallaDeLaFichaDeCuenta
        ficha={ficha}
        textos={textos}
        acciones={
          <>
            {puede ? (
              <EnlaceDeAccion
                href={rutaDeLasCondicionesDeCuenta(ficha.parteId)}
                variante="secundaria"
              >
                {textos.cambiarCondiciones}
              </EnlaceDeAccion>
            ) : (
              <Boton deshabilitado>{textos.cambiarCondiciones}</Boton>
            )}
            {ficha.estado === "SUSPENDIDA" ? (
              <FormularioDeReactivarCuenta
                key={`reactivar-${String(ficha.version)}`}
                accion={reactivarCuentaAccion.bind(
                  null,
                  ficha.parteId,
                  ficha.cuentaId,
                  ficha.version,
                )}
                textos={{ motivo: textos.motivoDeReactivacion, reactivar: textos.reactivar }}
                puedeGuardar={puede}
              />
            ) : (
              <FormularioDeSuspenderCuenta
                key={`suspender-${String(ficha.version)}`}
                accion={suspenderCuentaAccion.bind(
                  null,
                  ficha.parteId,
                  ficha.cuentaId,
                  ficha.version,
                )}
                textos={{ motivo: textos.motivoDeSuspension, suspender: textos.suspender }}
                puedeGuardar={puede}
              />
            )}
          </>
        }
      />,
    );
  });
}
