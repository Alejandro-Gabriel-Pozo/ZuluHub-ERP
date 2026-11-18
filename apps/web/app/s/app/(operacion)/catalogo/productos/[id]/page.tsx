import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFicha } from "../../../../../../../servidor/ficha-de-producto";
import { cargarLaVisibilidad } from "../../../../../../../servidor/ocultar";
import {
  puedeEditarProductos,
  puedeOcultarEnElLocal,
  puedeOcultarEnLaEmpresa,
} from "../../../../../../../servidor/modulos";
import { EnlaceDeAccion } from "../../../../../../../ui/componentes/EnlaceDeAccion";
import { FormularioDeFichaDeProducto } from "../../../../../../../ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente";
import { armarLaFicha } from "../../../../../../../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import { rutaDeLasOpciones } from "../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { armarLaVisibilidad } from "../../../../../../../ui/plantillas/catalogo/modelo-de-visibilidad-de-producto";
import { VisibilidadDeLaFichaDeProducto } from "../../../../../../../ui/plantillas/catalogo/VisibilidadDeLaFichaDeProducto.cliente";
import { Pila } from "../../../../../../../ui/primitivas/Pila";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { ocultarOMostrarAccion } from "../../../../acciones-de-ocultar";
import { guardarFichaAccion } from "../../../../acciones-de-productos";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]`: los datos de un producto (maqueta `productos.html`, solapa «Datos», 12/11/2026). El id de la dirección es lo único que viene del navegador: se busca entre
// los productos de la empresa; uno que no está ahí (ajeno, inexistente, mal escrito) sale como el genérico y no dice cuál de los casos es. La acción lleva la versión que se vio; si
// otra persona guardó antes, el servidor rechaza. Sin entrada en el menú: se llega por la dirección. El permiso (`productos.ver`) y el módulo en desarrollo los decide la consulta.
// Debajo, la tarjeta de visibilidad (A15, «Ocultar»): solo si se pudo leer dónde está oculto (la consulta pide `vidrieras.ver` y el módulo `vidriera` activo; si no, la ficha sigue sin ella).
export default async function PaginaDeLaFichaDeUnProducto({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaFicha(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const ficha = armarLaFicha(respuesta.dato);
    const oculto = await cargarLaVisibilidad(contexto, ficha.id);
    return conTitulo(
      ficha.titulo,
      <Pila separacion={5}>
        <FormularioDeFichaDeProducto
          key={`${ficha.id}-${String(ficha.version)}`}
          ficha={ficha}
          accion={guardarFichaAccion.bind(null, ficha.id, ficha.version)}
          puedeGuardar={await puedeEditarProductos(contexto)}
        />
        {oculto.ok ? (
          <VisibilidadDeLaFichaDeProducto
            filas={armarLaVisibilidad(oculto.dato, {
              local: await puedeOcultarEnElLocal(contexto),
              empresa: await puedeOcultarEnLaEmpresa(contexto),
            })}
            acciones={{
              LOCAL: ocultarOMostrarAccion.bind(
                null,
                ficha.id,
                "LOCAL",
                !(oculto.dato.local ?? false),
              ),
              EMPRESA: ocultarOMostrarAccion.bind(null, ficha.id, "EMPRESA", !oculto.dato.empresa),
            }}
          />
        ) : null}
        {/* La solapa «Opciones» (A13): solo para lo que se vende, que es lo único que tiene opciones. */}
        {respuesta.dato.seVende ? (
          <EnlaceDeAccion href={rutaDeLasOpciones(ficha.id)}>
            {texto({}, "catalogo.ficha.opciones")}
          </EnlaceDeAccion>
        ) : null}
      </Pila>,
    );
  });
}
