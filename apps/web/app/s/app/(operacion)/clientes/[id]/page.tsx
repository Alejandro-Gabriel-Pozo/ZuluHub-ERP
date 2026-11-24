import { conTitulo, pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLaParte, nuevaClaveDeParte } from "../../../../../../servidor/directorio";
import { accionesDelDirectorio } from "../../../../../../servidor/ofertas-de-clientes";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeParte } from "../../../../../../ui/plantillas/clientes/FormularioDeParte.cliente";
import {
  armarElFormularioDeParte,
  nombreDeLaFicha,
} from "../../../../../../ui/plantillas/clientes/modelo-de-formulario-de-parte";
import {
  desactivarParteAccion,
  editarParteAccion,
  reactivarParteAccion,
} from "../../../acciones-de-directorio";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/clientes/[id]`: la ficha de una persona o empresa, editable (maqueta `directorio.html`). El id de la dirección es lo único que viene del navegador: se busca entre las partes de la empresa;
// una que no está (ajena, inexistente, mal escrita) sale como el genérico y no dice cuál de los casos es. La versión que se vio viaja ligada a la acción: si otra persona cambió la parte
// antes, el servidor rechaza sin escribir. «Desactivar» y «Reactivar» se ofrecen según el estado y salen apagados sin el permiso. Sin el bloque «Contactos» (PR aparte).
export default async function PaginaDeLaParte({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion(
    { titulo: "clientes.lista.clientes_y_proveedores" },
    async ({ contexto }) => {
      const respuesta = await cargarLaParte(id);
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      const ficha = respuesta.dato;
      return conTitulo(
        nombreDeLaFicha(ficha),
        <FormularioDeParte
          formulario={armarElFormularioDeParte(ficha, await accionesDelDirectorio(contexto))}
          accion={editarParteAccion.bind(null, ficha.id, ficha.version, nuevaClaveDeParte())}
          accionDeEstado={(ficha.activa ? desactivarParteAccion : reactivarParteAccion).bind(
            null,
            ficha.id,
          )}
        />,
      );
    },
  );
}
