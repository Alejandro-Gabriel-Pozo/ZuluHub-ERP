import { randomUUID } from "node:crypto";
import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import {
  abrirConteoAccion,
  cancelarConteoAccion,
  guardarLoContadoAccion,
} from "../../../acciones-de-conteo";
import { cargarLaLecturaDelConteo } from "../../../../../../servidor/conteo-de-stock";
import { puedeEnStock } from "../../../../../../servidor/ofertas-de-stock";
import { Boton } from "../../../../../../ui/componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../../../../ui/componentes/EnlaceDeAccion";
import { BotonDeEnvio } from "../../../../../../ui/patrones/BotonDeEnvio.cliente";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeAccion } from "../../../../../../ui/patrones/FormularioDeAccion.cliente";
import { CargaDeConteo } from "../../../../../../ui/plantillas/stock/conteo/CargaDeConteo.cliente";
import { FormularioDeCancelarConteo } from "../../../../../../ui/plantillas/stock/conteo/FormularioDeCancelarConteo.cliente";
import {
  hrefDelConteo,
  hrefDeRevisar,
  leerElConteo,
} from "../../../../../../ui/plantillas/stock/conteo/modelo-de-conteo";
import { SelectorDeDeposito } from "../../../../../../ui/plantillas/stock/lectura/SelectorDeDeposito";
import { textoDeLaUnidad } from "../../../../../../ui/plantillas/produccion/modelo-de-ordenes";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/conteo`: el conteo físico del depósito elegido de la sucursal elegida en el dispositivo (maqueta `stock-conteo.html`, FP-STK-10). Sin conteo abierto, «Abrir conteo» (gerente y administrador); con uno abierto, la carga por
// artículo (también el operador, a ciegas), «Aplicar» (lleva a la revisión) y «Cancelar conteo». El depósito viaja en la dirección; la sucursal la fija el servidor. La clave de abrir se genera una vez al abrir la página.
export default async function PaginaDelConteo({ searchParams }: PropsDePagina) {
  const pedido = leerElConteo(await searchParams);
  return pantallaDeOperacion({ titulo: "stock.pantalla.conteo" }, async ({ contexto }) => {
    const cargado = await cargarLaLecturaDelConteo(
      contexto,
      pedido.depositoId === undefined ? {} : { depositoId: pedido.depositoId },
    );
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    const { depositos, depositoId, conteoId, articulos } = cargado.dato;
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("conteo")} />
        <SelectorDeDeposito
          rotulo={texto({}, "stock.pantalla.depositos")}
          opciones={depositos.map((d) => ({
            id: d.id,
            nombre: d.nombre,
            href: hrefDelConteo(d.id),
            actual: d.id === depositoId,
          }))}
        />
        {depositoId === null ? null : conteoId === null ? (
          (await puedeEnStock(contexto, "conteos.abrir")) ? (
            <FormularioDeAccion accion={abrirConteoAccion.bind(null, randomUUID(), depositoId)}>
              <BotonDeEnvio>{texto({}, "stock.conteo.abrir")}</BotonDeEnvio>
            </FormularioDeAccion>
          ) : (
            <Boton deshabilitado>{texto({}, "stock.conteo.abrir")}</Boton>
          )
        ) : (
          <>
            <CargaDeConteo
              articulos={articulos.map((a) => ({
                articuloId: a.articuloId,
                nombre: a.nombre,
                unidad: textoDeLaUnidad(a.unidadId),
                contado: a.contado,
              }))}
              guardar={guardarLoContadoAccion.bind(null, conteoId)}
            />
            {(await puedeEnStock(contexto, "conteos.aplicar")) ? (
              <EnlaceDeAccion href={hrefDeRevisar(conteoId)} variante="primaria">
                {texto({}, "stock.conteo.aplicar")}
              </EnlaceDeAccion>
            ) : (
              <Boton deshabilitado>{texto({}, "stock.conteo.aplicar")}</Boton>
            )}
            <FormularioDeCancelarConteo
              accion={cancelarConteoAccion.bind(null, conteoId, depositoId)}
              puedeEnviar={await puedeEnStock(contexto, "conteos.cancelar")}
            />
          </>
        )}
      </>
    );
  });
}
