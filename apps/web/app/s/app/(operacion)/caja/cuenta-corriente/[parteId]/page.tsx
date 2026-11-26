import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFichaDeLaCuenta } from "../../../../../../../servidor/cuenta-corriente";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeLaFichaDeCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/PantallaDeLaFichaDeCuenta";
import { armarLaFichaDeLaCuenta } from "../../../../../../../ui/plantillas/cuenta-corriente/modelo-de-cuenta-corriente";
import { textosDeCuentaCorriente } from "../../../../../../../ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente";

type PropsDePagina = Readonly<{ params: Promise<{ parteId: string }> }>;

// `/caja/cuenta-corriente/[parteId]`: la ficha de un cliente con su estado de cuenta (maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, «Ficha y estado de cuenta» y «Ficha suspendida»). El id de la dirección
// es lo único que viene del navegador: el servidor lo busca entre las cuentas de la empresa; uno que no está (ajeno, inexistente, mal escrito) sale como el genérico y no dice cuál de los casos es.
export default async function PaginaDeLaFichaDeCuenta({ params }: PropsDePagina) {
  const { parteId } = await params;
  const textos = textosDeCuentaCorriente();
  return pantallaDeOperacion({ titulo: "cuenta_corriente.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaFichaDeLaCuenta(contexto, parteId);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    return conTitulo(
      armarLaFichaDeLaCuenta(respuesta.dato, textos).titulo,
      <PantallaDeLaFichaDeCuenta ficha={respuesta.dato} textos={textos} />,
    );
  });
}
