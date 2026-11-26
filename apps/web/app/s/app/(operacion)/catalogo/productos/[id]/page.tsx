import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaClasificacionDelProducto } from "../../../../../../../servidor/clasificacion";
import {
  cargarElControlDeStock,
  cargarLaExistenciaPropia,
} from "../../../../../../../servidor/control-de-stock";
import { cargarLaFicha } from "../../../../../../../servidor/ficha-de-producto";
import { cargarLaVisibilidad } from "../../../../../../../servidor/ocultar";
import {
  produccionEncendida,
  puedeControlarElStock,
} from "../../../../../../../servidor/ofertas-de-catalogo";
import {
  puedeEditarProductos,
  puedeOcultarEnElLocal,
  puedeOcultarEnLaEmpresa,
} from "../../../../../../../servidor/modulos";
import { EnlaceDeAccion } from "../../../../../../../ui/componentes/EnlaceDeAccion";
import { ClasificacionDelProducto } from "../../../../../../../ui/plantillas/catalogo/ClasificacionDelProducto.cliente";
import { FormularioDeFichaDeProducto } from "../../../../../../../ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente";
import { armarLaClasificacionDelProducto } from "../../../../../../../ui/plantillas/catalogo/modelo-de-clasificacion";
import {
  armarLaFicha,
  armarLaFranjaDeStockPropio,
} from "../../../../../../../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import { rutaDeLasOpciones } from "../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { rutaDeLaCompraDelProducto } from "../../../../../../../ui/plantillas/catalogo/modelo-de-presentaciones";
import { armarLaVisibilidad } from "../../../../../../../ui/plantillas/catalogo/modelo-de-visibilidad-de-producto";
import { VisibilidadDeLaFichaDeProducto } from "../../../../../../../ui/plantillas/catalogo/VisibilidadDeLaFichaDeProducto.cliente";
import { Pila } from "../../../../../../../ui/primitivas/Pila";
import { Texto } from "../../../../../../../ui/primitivas/Texto";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { clasificarProductoAccion } from "../../../../acciones-de-clasificacion";
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
    // «Se produce en tanda» (PRO-A): el elaborado y el vendible ofrecen el tilde solo con la función «Producción» encendida; si no, la ficha queda como estaba.
    const conStockPropio =
      respuesta.dato.admiteStockPropio && (await produccionEncendida(contexto));
    const ficha = armarLaFicha({
      ...respuesta.dato,
      admiteControlDeStock: respuesta.dato.admiteControlDeStock || conStockPropio,
    });
    const puedeEditar = await puedeEditarProductos(contexto);
    // La clasificación comercial (A14) reemplaza al campo suelto «Categoría» (dueño, 12/11/2026): una sección propia debajo de los datos, con su hoja «Cambiar».
    const clasificacion = await cargarLaClasificacionDelProducto(contexto, ficha.id);
    const oculto = await cargarLaVisibilidad(contexto, ficha.id);
    // El tilde «Se controla el stock» (PR-3): solo si la clase se controla, el producto está activo y se pudo leer (módulo `stock` activo, `stock.ver`); si no, no se dibuja nada.
    const control =
      respuesta.dato.admiteControlDeStock || conStockPropio
        ? await cargarElControlDeStock(contexto, ficha.id)
        : null;
    const controlVisto = control?.ok === true ? control.dato.controlado : null;
    // La franja de stock propio (TP-4 y TP-5): con el control encendido, la existencia propia; apagado, que descuenta sus ingredientes. Sin lectura, sin franja.
    const existenciaPropia =
      conStockPropio && controlVisto === true
        ? await cargarLaExistenciaPropia(contexto, {
            productoId: ficha.id,
            nombre: respuesta.dato.nombre,
            unidadId: respuesta.dato.unidadBaseId,
          })
        : null;
    const franja =
      conStockPropio && controlVisto !== null
        ? armarLaFranjaDeStockPropio(
            controlVisto,
            existenciaPropia?.ok === true ? existenciaPropia.dato : null,
          )
        : null;
    return conTitulo(
      ficha.titulo,
      <Pila separacion={5}>
        <FormularioDeFichaDeProducto
          key={`${ficha.id}-${String(ficha.version)}-${String(controlVisto)}`}
          ficha={ficha}
          accion={guardarFichaAccion.bind(null, ficha.id, ficha.version, controlVisto)}
          controlDeStock={
            controlVisto === null
              ? null
              : { marcada: controlVisto, puedeCambiar: await puedeControlarElStock(contexto) }
          }
          puedeGuardar={puedeEditar}
        />
        {franja === null ? null : <Texto variante="suave">{franja}</Texto>}
        {clasificacion.ok ? (
          <ClasificacionDelProducto
            clasificacion={armarLaClasificacionDelProducto(clasificacion.dato)}
            accion={clasificarProductoAccion}
            puedeCambiar={puedeEditar}
          />
        ) : (
          <ErrorDelDetalle error={clasificacion.error} />
        )}
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
        {/* La solapa «Cómo se compra» (T0): solo para lo que se compra, que es lo único que tiene presentaciones. */}
        {respuesta.dato.seCompra ? (
          <EnlaceDeAccion href={rutaDeLaCompraDelProducto(ficha.id)}>
            {texto({}, "compras.compra.como_se_compra")}
          </EnlaceDeAccion>
        ) : null}
      </Pila>,
    );
  });
}
