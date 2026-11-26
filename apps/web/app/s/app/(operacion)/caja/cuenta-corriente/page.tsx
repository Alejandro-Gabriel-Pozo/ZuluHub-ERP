import { Boton } from "../../../../../../ui/componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../../../../ui/componentes/EnlaceDeAccion";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLaListaDeCuentas } from "../../../../../../servidor/cuenta-corriente";
import { puedeAdministrarCuentas } from "../../../../../../servidor/cuenta-corriente-escritura";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeLaListaDeCuentas } from "../../../../../../ui/plantillas/cuenta-corriente/PantallaDeLaListaDeCuentas";
import { RUTA_DE_HABILITAR_CUENTA } from "../../../../../../ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { textosDeCuentaCorriente } from "../../../../../../ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente";

// `/caja/cuenta-corriente`: los clientes con cuenta corriente, con su saldo, lo vencido y su crédito (maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, pestaña «Clientes con saldo»). La lectura exige
// `cuenta_corriente.ver` y la decide el servidor; lo que no se puede mostrar (sin permiso, módulo cerrado, orden que no existe) sale como el genérico: nunca una lista que parezca completa. De la dirección solo se toma `orden`. «Habilitar cliente» sale apagado sin `cuenta_corriente.administrar` (ayuda: el servidor igual decide).
export default async function PaginaDeLaCuentaCorriente({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  return pantallaDeOperacion({ titulo: "cuenta_corriente.lista.titulo" }, async ({ contexto }) => {
    const lista = await cargarLaListaDeCuentas(contexto, parametros);
    if (!lista.ok) return <ErrorDelDetalle error={lista.error} />;
    const textos = textosDeCuentaCorriente();
    return (
      <PantallaDeLaListaDeCuentas
        lista={lista.dato}
        textos={textos}
        acciones={
          (await puedeAdministrarCuentas(contexto)) ? (
            <EnlaceDeAccion href={RUTA_DE_HABILITAR_CUENTA} variante="primaria">
              {textos.habilitarCliente}
            </EnlaceDeAccion>
          ) : (
            <Boton deshabilitado>{textos.habilitarCliente}</Boton>
          )
        }
      />
    );
  });
}
