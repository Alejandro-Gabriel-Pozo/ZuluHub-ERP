import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeEditarOpciones } from "../../../../../../../../servidor/modulos";
import { cargarLaCopia, cargarLasOpciones } from "../../../../../../../../servidor/opciones";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { HojaDeCopiaDeOpciones } from "../../../../../../../../ui/plantillas/catalogo/HojaDeCopiaDeOpciones.cliente";
import {
  armarLaCopia,
  armarLasOpciones,
} from "../../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { PantallaDeOpciones } from "../../../../../../../../ui/plantillas/catalogo/PantallaDeOpciones";
import { copiarOpcionesAccion } from "../../../../../acciones-de-opciones";

type PropsDePagina = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

// `/catalogo/productos/[id]/opciones`: los grupos de opciones de un producto (maqueta `productos.html`, solapa «Opciones», 12/11/2026). El id de la dirección es lo único que viene del
// navegador: se busca entre los productos de la empresa; uno que no está ahí (ajeno, inexistente, mal escrito, que no se vende) sale como el genérico y no dice cuál de los casos es. Los
// botones de escribir («Editar», «Agregar grupo», «Copiar de otro producto») se dibujan siempre y van apagados si la persona no puede editar las opciones. Sin entrada en el menú: se llega
// desde la ficha. El permiso (`productos.ver`) y el módulo en desarrollo los decide la consulta.
// Con `?copiar=` la solapa se dibuja con la hoja de «Copiar de otro producto» abierta (DEC-0731): el valor es el producto de origen que se está mirando y solo se lo reconoce si es uno de los
// candidatos que devolvió el servidor (si no, el primero); la vista previa la arma siempre el servidor. La clave de la copia (idempotencia) y la versión vista las liga la página con `.bind`.
export default async function PaginaDeLasOpcionesDeUnProducto({
  params,
  searchParams,
}: PropsDePagina) {
  const { id } = await params;
  const { copiar } = await searchParams;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLasOpciones(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const puede = await puedeEditarOpciones(contexto);
    const opciones = armarLasOpciones(respuesta.dato, puede);
    const solapa = <PantallaDeOpciones opciones={opciones} />;
    if (copiar === undefined) return conTitulo(opciones.titulo, solapa);
    const lectura = await cargarLaCopia(
      contexto,
      id,
      typeof copiar === "string" && copiar !== "1" ? copiar : null,
    );
    if (!lectura.ok) return <ErrorDelDetalle error={lectura.error} />;
    const copia = armarLaCopia(lectura.dato, puede);
    return conTitulo(
      opciones.titulo,
      <>
        {solapa}
        <HojaDeCopiaDeOpciones
          key={`${copia.id}-${String(lectura.dato.versionDeOpciones)}`}
          copia={copia}
          accion={copiarOpcionesAccion.bind(
            null,
            copia.id,
            lectura.dato.versionDeOpciones,
            lectura.dato.claveDeLaCopia,
          )}
        />
      </>,
    );
  });
}
