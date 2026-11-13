import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { pendientesDeFacturar } from "../../../../../../../servidor/facturar-tickets";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarLosPendientes,
  pedidoDeLosPendientes,
} from "../../../../../../../ui/plantillas/facturacion/modelo-de-pendientes";
import { PantallaDePendientesDeFacturar } from "../../../../../../../ui/plantillas/facturacion/PantallaDePendientesDeFacturar";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/facturacion/comprobantes/pendientes`: los tickets cobrados sin comprobante vigente de la sucursal con la que trabaja la persona (la
// elegida en el Listado, o la única abierta; sin ninguna, el servidor lo dice y nunca lista «todas»). El permiso (`ventas.ver`) lo exige la
// consulta de ventas adentro. El título es el del armazón (el único `h1`); «Comprobantes» queda marcado en la barra.
export default async function PaginaDePendientesDeFacturar({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.pendientes_titulo", actual: "comprobantes" },
    async ({ contexto }) => {
      const respuesta = await pendientesDeFacturar(contexto, pedidoDeLosPendientes(params));
      if (!respuesta.ok) {
        return (
          <PantallaDePendientesDeFacturar
            pendientes={null}
            error={<ErrorDelDetalle error={respuesta.error} />}
          />
        );
      }
      return <PantallaDePendientesDeFacturar pendientes={armarLosPendientes({}, respuesta.dato)} />;
    },
  );
}
