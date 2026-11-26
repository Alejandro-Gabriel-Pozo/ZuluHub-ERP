import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { corregirLoteAccion } from "../../../../acciones-de-lotes";
import { cargarLosLotes } from "../../../../../../../servidor/lotes-de-stock";
import { puedeEnStock } from "../../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeCorregirLote } from "../../../../../../../ui/plantillas/stock/lotes/FormularioDeCorregirLote.cliente";
import {
  hrefDeLotes,
  leerLosLotes,
  loteParaCorregir,
} from "../../../../../../../ui/plantillas/stock/lotes/modelo-de-lotes";
import { pestanasDeStock } from "../../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../../ui/plantillas/stock/PestanasDeStock";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/lotes/corregir?articulo=…&lote=…`: corregir la fecha de vencimiento de un lote (maqueta `stock-lotes.html`, FP-STK-16). La VERSIÓN del lote se lee acá, al abrir, y viaja ligada a la acción: si otra persona lo
// corrigió antes, el servidor no pisa y la pantalla se recarga. El «Sin asignar» (sin fechas) o un lote que no es del artículo salen como el genérico.
export default async function PaginaDeCorregirLote({ searchParams }: PropsDePagina) {
  const pedido = leerLosLotes(await searchParams);
  return pantallaDeOperacion({ titulo: "stock.lotes.pantalla" }, async ({ contexto }) => {
    if (pedido.articuloId === undefined) {
      return <ErrorDelDetalle error={errorDeCodigo("STOCK_ACCION_NO_PERMITIDA")} />;
    }
    const cargado = await cargarLosLotes(contexto, { articuloId: pedido.articuloId });
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    const lote = loteParaCorregir(cargado.dato, pedido.loteId);
    if (lote === null || pedido.loteId === undefined) {
      return <ErrorDelDetalle error={errorDeCodigo("STOCK_ACCION_NO_PERMITIDA")} />;
    }
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("lotes")} />
        <FormularioDeCorregirLote
          accion={corregirLoteAccion.bind(null, pedido.articuloId, pedido.loteId, lote.version)}
          codigo={lote.codigo}
          venceActual={lote.vence}
          hrefDeCancelar={hrefDeLotes(pedido.articuloId)}
          puedeEnviar={await puedeEnStock(contexto, "lotes.corregir")}
        />
      </>
    );
  });
}
