import { randomUUID } from "node:crypto";
import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeAbrirOrdenes } from "../../../../../../../servidor/ofertas-de-produccion";
import { cargarLaNuevaOrdenDeLaSucursal } from "../../../../../../../servidor/produccion";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeNuevaOrden } from "../../../../../../../ui/plantillas/produccion/FormularioDeNuevaOrden.cliente";
import { RUTA_DE_PRODUCCION } from "../../../../../../../ui/plantillas/produccion/filtros-de-ordenes";
import {
  opcionesDeProducto,
  textosDeNuevaOrden,
} from "../../../../../../../ui/plantillas/produccion/modelo-de-nueva-orden";
import { abrirOrdenAccion } from "../../../../acciones-de-produccion";

// `/catalogo/produccion/nueva`: «Nueva orden» (maqueta `produccion.html`, 09/11/2026). Lo que se ofrece (productos con receta y artículo propio, y el depósito de venta que es origen y destino) sale del
// servidor para la sucursal elegida en este dispositivo; el navegador manda solo el producto y la cantidad. La clave de idempotencia se genera una vez al armar la página y viaja ligada a la acción (`bind`):
// repetir el envío (doble toque, red corta) devuelve la misma orden. El permiso (`transformaciones.abrir`), el módulo y la perilla los decide el servidor al abrir; el botón apagado es solo una ayuda.
export default async function PaginaDeLaNuevaOrden() {
  return pantallaDeOperacion(
    { titulo: "produccion.pantalla.nueva_orden" },
    async ({ contexto }) => {
      const oferta = await cargarLaNuevaOrdenDeLaSucursal(contexto);
      if (!oferta.ok) return <ErrorDelDetalle error={oferta.error} />;
      if (oferta.dato.productos.length === 0) {
        return <ErrorDelDetalle error={errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA")} />;
      }
      return (
        <FormularioDeNuevaOrden
          accion={abrirOrdenAccion.bind(null, randomUUID())}
          textos={textosDeNuevaOrden()}
          productos={opcionesDeProducto(oferta.dato.productos)}
          hrefDeCancelar={RUTA_DE_PRODUCCION}
          puedeEnviar={await puedeAbrirOrdenes(contexto)}
        />
      );
    },
  );
}
