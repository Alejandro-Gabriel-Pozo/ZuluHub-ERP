import { randomUUID } from "node:crypto";
import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { reasignarLoteAccion } from "../../../../acciones-de-lotes";
import { cargarLosLotes } from "../../../../../../../servidor/lotes-de-stock";
import { cargarLosDepositosParaReasignar } from "../../../../../../../servidor/lotes-escritura-de-stock";
import { puedeEnStock } from "../../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeReasignarLote } from "../../../../../../../ui/plantillas/stock/lotes/FormularioDeReasignarLote.cliente";
import {
  hrefDeLotes,
  leerLosLotes,
  loteParaReasignar,
} from "../../../../../../../ui/plantillas/stock/lotes/modelo-de-lotes";
import { pestanasDeStock } from "../../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../../ui/plantillas/stock/PestanasDeStock";
import { textoDeLaUnidad } from "../../../../../../../ui/plantillas/produccion/modelo-de-ordenes";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/lotes/reasignar?articulo=…&lote=…`: reasignar existencia del «Sin asignar» a un lote que YA existe (maqueta `stock-lotes.html`, FP-STK-16). La clave de la reasignación se genera una vez al abrir la página y viaja
// ligada a la acción: el mismo clic repetido es una sola reasignación. Un lote que no es el «Sin asignar» con existencia, o ajeno al artículo, sale como el genérico.
export default async function PaginaDeReasignarLote({ searchParams }: PropsDePagina) {
  const pedido = leerLosLotes(await searchParams);
  return pantallaDeOperacion({ titulo: "stock.lotes.pantalla" }, async ({ contexto }) => {
    const generico = <ErrorDelDetalle error={errorDeCodigo("STOCK_ACCION_NO_PERMITIDA")} />;
    if (pedido.articuloId === undefined || pedido.loteId === undefined) return generico;
    const cargado = await cargarLosLotes(contexto, { articuloId: pedido.articuloId });
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    const depositos = await cargarLosDepositosParaReasignar(contexto);
    if (!depositos.ok) return <ErrorDelDetalle error={depositos.error} />;
    const lote = loteParaReasignar(cargado.dato, pedido.loteId, depositos.dato, (clave, valores) =>
      texto({}, clave, valores),
    );
    if (lote === null) return generico;
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("lotes")} />
        <FormularioDeReasignarLote
          accion={reasignarLoteAccion.bind(null, randomUUID(), pedido.articuloId, pedido.loteId)}
          origen={lote.origen}
          unidad={textoDeLaUnidad(lote.unidadId)}
          depositos={lote.depositos}
          destinos={lote.destinos}
          hrefDeCancelar={hrefDeLotes(pedido.articuloId)}
          puedeEnviar={await puedeEnStock(contexto, "lotes.reasignar")}
        />
      </>
    );
  });
}
