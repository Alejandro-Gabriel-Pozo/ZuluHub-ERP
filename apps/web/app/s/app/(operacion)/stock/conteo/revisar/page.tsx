import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { aplicarConteoAccion } from "../../../../acciones-de-conteo";
import { cargarLaRevisionDelConteo } from "../../../../../../../servidor/conteo-de-stock";
import { puedeEnStock } from "../../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeAplicarConteo } from "../../../../../../../ui/plantillas/stock/conteo/FormularioDeAplicarConteo.cliente";
import {
  armarLaRevision,
  hrefDelConteo,
  leerElConteo,
} from "../../../../../../../ui/plantillas/stock/conteo/modelo-de-conteo";
import { pestanasDeStock } from "../../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../../ui/plantillas/stock/PestanasDeStock";
import { ListaDeConteoAplicado } from "../../../../../../../ui/plantillas/stock/conteo/ListaDeConteoAplicado";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/conteo/revisar?conteo=…`: la revisión del conteo abierto (lo contado, lo que el sistema creía a esa hora, lo movido desde entonces, la diferencia y su motivo) y, ya aplicado, el resultado (FP-STK-11 y FP-STK-12).
// Lo que el sistema creía solo llega a quien puede aplicar (el conteo es a ciegas para el resto). La huella de lo que se ve se liga a «Aplicar»: si cambió, el servidor no aplica y la pantalla recarga.
export default async function PaginaDeRevisarElConteo({ searchParams }: PropsDePagina) {
  const pedido = leerElConteo(await searchParams);
  return pantallaDeOperacion({ titulo: "stock.pantalla.conteo" }, async ({ contexto }) => {
    const cargado = await cargarLaRevisionDelConteo(
      contexto,
      pedido.conteoId === undefined ? {} : { conteoId: pedido.conteoId },
    );
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    const dato = cargado.dato;
    const vista = armarLaRevision(dato, (clave, valores) => texto({}, clave, valores));
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("conteo")} />
        {dato.estado === "ABIERTO" ? (
          <FormularioDeAplicarConteo
            accion={aplicarConteoAccion.bind(null, dato.conteoId, dato.huella ?? "")}
            filas={vista.filas}
            hrefDeCancelar={hrefDelConteo()}
            puedeEnviar={dato.huella !== null && (await puedeEnStock(contexto, "conteos.aplicar"))}
          />
        ) : (
          <ListaDeConteoAplicado
            titulo={dato.estado === "APLICADO" ? texto({}, "stock.conteo.aplicado") : null}
            filas={vista.aplicadas}
            rotulos={{
              contado: texto({}, "stock.conteo.contado"),
              diferencia: texto({}, "stock.conteo.diferencia"),
              motivo: texto({}, "stock.accion.motivo"),
            }}
          />
        )}
      </>
    );
  });
}
