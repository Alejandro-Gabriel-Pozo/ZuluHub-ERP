import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { puedeAdministrarImpresoras } from "../../../../../../servidor/modulos";
import { cargarLasImpresoras } from "../../../../../../servidor/comandas";
import { armarLaListaDeImpresoras } from "../../../../../../ui/plantillas/salon/modelo-de-impresoras";
import { PantallaDeListaDeImpresoras } from "../../../../../../ui/plantillas/salon/PantallaDeListaDeImpresoras";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { quitarImpresoraAccion } from "../../../acciones-de-impresoras";

// `/salon/impresoras`: las impresoras de la sucursal con la que se trabaja (maqueta `imprimir.html`, aprobada el 09/11/2026). La empresa, la persona y la sucursal las pone el servidor y el permiso (`impresoras.ver`), la
// perilla `salon` y el módulo en desarrollo los decide la consulta; «Agregar impresora», el nombre que lleva a editar y «Quitar» se ofrecen solo con `impresoras.*` (`puedeAdministrarImpresoras`, cierra ante la duda).
export default async function PaginaDeLaListaDeImpresoras() {
  return pantallaDeOperacion(
    { titulo: "comandas.texto.imprimir_impresoras" },
    async ({ contexto }) => {
      const respuesta = await cargarLasImpresoras(contexto);
      const lista = respuesta.ok
        ? armarLaListaDeImpresoras(
            respuesta.dato.impresoras,
            await puedeAdministrarImpresoras(contexto),
          )
        : null;
      return (
        <PantallaDeListaDeImpresoras
          lista={lista}
          accionDeQuitar={(impresoraId) => quitarImpresoraAccion.bind(null, impresoraId)}
          error={respuesta.ok ? null : <ErrorDelDetalle error={respuesta.error} />}
        />
      );
    },
  );
}
