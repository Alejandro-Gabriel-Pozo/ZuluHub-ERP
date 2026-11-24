import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { nuevaClaveDeParte } from "../../../../../../servidor/directorio";
import { accionesDelDirectorio } from "../../../../../../servidor/ofertas-de-clientes";
import { FormularioDeParte } from "../../../../../../ui/plantillas/clientes/FormularioDeParte.cliente";
import { leerLosFiltros } from "../../../../../../ui/plantillas/clientes/modelo-de-directorio";
import { armarElFormularioDeParte } from "../../../../../../ui/plantillas/clientes/modelo-de-formulario-de-parte";
import { crearParteAccion } from "../../../acciones-de-directorio";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/clientes/nuevo`: el alta de una persona o empresa (maqueta `directorio.html`, «Nuevo»). Nada viene del navegador más que lo que se escribe y, de la dirección, el rol con el que se llegó
// (`?rol=proveedor` o `?rol=cliente`: la casilla de ese rol nace tildada; cualquier otro valor, ninguna). La página fija UNA clave de creación al abrirse y la liga a la acción: el doble toque, el
// reintento y «Guardar igual» son una sola alta; recargar la página es otro intento. «Guardar» sale apagado sin `partes.crear` (`accionesDelDirectorio`).
export default async function PaginaDeLaParteNueva({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "clientes.lista.nuevo" }, async ({ contexto }) => (
    <FormularioDeParte
      formulario={armarElFormularioDeParte(
        null,
        await accionesDelDirectorio(contexto),
        leerLosFiltros(params).rol,
      )}
      accion={crearParteAccion.bind(null, nuevaClaveDeParte())}
      accionDeEstado={null}
    />
  ));
}
