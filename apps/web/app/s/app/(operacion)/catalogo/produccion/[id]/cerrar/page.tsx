import { randomUUID } from "node:crypto";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { accionesDeProduccion } from "../../../../../../../../servidor/ofertas-de-produccion";
import { cargarLaOrdenParaElCierre } from "../../../../../../../../servidor/produccion";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeCierreDeOrden } from "../../../../../../../../ui/plantillas/produccion/FormularioDeCierreDeOrden.cliente";
import { armarElCierre } from "../../../../../../../../ui/plantillas/produccion/modelo-de-cierre-de-orden";
import { cerrarOrdenAccion } from "../../../../../acciones-de-produccion";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/produccion/[id]/cerrar`: «Cerrar con lo real» (maqueta `produccion.html`, 09/11/2026). El id de la dirección es lo único que viene del navegador: una orden que no está entre las de la empresa y del alcance
// de la persona, o que ya no está abierta, sale como el genérico y no dice cuál de los casos es. Cada ingrediente arranca con lo esperado de la orden; el costo no se muestra (lo congela el servidor al cerrar). La clave de
// idempotencia se genera una vez al armar la página y viaja ligada a la acción (`bind`) junto con la orden: repetir el envío (doble toque, red corta) devuelve el mismo cierre. El permiso (`transformaciones.cerrar`: gerente
// y administrador), el módulo y la perilla los decide el servidor al cerrar; el botón apagado es solo una ayuda.
export default async function PaginaDelCierreDeLaOrden({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion(
    { titulo: "produccion.accion.cerrar_con_lo_real" },
    async ({ contexto }) => {
      const respuesta = await cargarLaOrdenParaElCierre(contexto, id);
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      const cierre = armarElCierre(respuesta.dato);
      return (
        <FormularioDeCierreDeOrden
          accion={cerrarOrdenAccion.bind(null, respuesta.dato.id, randomUUID())}
          cierre={cierre}
          puedeEnviar={(await accionesDeProduccion(contexto)).cerrar === true}
        />
      );
    },
  );
}
