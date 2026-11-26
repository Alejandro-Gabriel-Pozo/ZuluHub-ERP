import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosLotes, cargarLosVencimientos } from "../../../../../../servidor/lotes-de-stock";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarLosLotes,
  armarLosVencimientos,
  leerLosLotes,
} from "../../../../../../ui/plantillas/stock/lotes/modelo-de-lotes";
import {
  PantallaDeLotes,
  PantallaDeVencimientos,
} from "../../../../../../ui/plantillas/stock/lotes/PantallaDeLotes";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/lotes`: los lotes de un artículo y, con `?vista=vencimientos`, lo que vence en los próximos días de la sucursal elegida en el dispositivo (maqueta `stock-lotes.html`, FP-STK-13 y FP-STK-14). Solo lectura y sin
// importes. El artículo y los días viajan en la dirección; la sucursal la fija el servidor, nunca la dirección.
export default async function PaginaDeLotes({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  const pedido = leerLosLotes(params);
  return pantallaDeOperacion({ titulo: "stock.lotes.pantalla" }, async ({ contexto }) => {
    const pestanas = <PestanasDeStock pestanas={pestanasDeStock("lotes")} />;
    if (pedido.vencimientos) {
      const cargado = await cargarLosVencimientos(
        contexto,
        pedido.dias === undefined ? {} : { dias: pedido.dias },
      );
      if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
      return (
        <>
          {pestanas}
          <PantallaDeVencimientos
            vista={armarLosVencimientos(cargado.dato, (clave, valores) =>
              texto({}, clave, valores),
            )}
            titulo={texto({}, "stock.lotes.vencimientos")}
            textos={{
              vence: texto({}, "stock.lotes.vence"),
              existencia: texto({}, "stock.pantalla.existencia"),
            }}
          />
        </>
      );
    }
    const cargado = await cargarLosLotes(
      contexto,
      pedido.articuloId === undefined ? {} : { articuloId: pedido.articuloId },
    );
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    return (
      <>
        {pestanas}
        <PantallaDeLotes
          vista={armarLosLotes(cargado.dato, (clave, valores) => texto({}, clave, valores))}
          textos={{
            articulo: texto({}, "stock.accion.articulo"),
            vencimientos: texto({}, "stock.lotes.vencimientos"),
            vence: texto({}, "stock.lotes.vence"),
            existencia: texto({}, "stock.pantalla.existencia"),
            disponible: texto({}, "stock.pantalla.disponible"),
          }}
        />
      </>
    );
  });
}
