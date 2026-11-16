import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../servidor/modulos";
import { cargarLasSecciones } from "../../../../../../servidor/secciones";
import { armarLaListaDeSecciones } from "../../../../../../ui/plantillas/catalogo/modelo-de-secciones";
import { PantallaDeListaDeSecciones } from "../../../../../../ui/plantillas/catalogo/PantallaDeListaDeSecciones";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { moverSeccionAccion } from "../../../acciones-de-secciones";

// `/catalogo/secciones`: todas las secciones de la carta de la empresa, también las desactivadas (maqueta `productos-secciones.html`, 12/11/2026). La empresa y la persona las pone el servidor y
// el permiso (`productos.ver`) y el módulo en desarrollo los decide la consulta; las flechas y «Nueva sección» se ofrecen solo con `productos.editar` (`puedeEditarProductos`, cierra ante la duda).
// La acción de las flechas lleva las secciones activas como se ven, cada una con su versión: si otra persona cambió algo antes, el servidor rechaza y la página se vuelve a pedir.
export default async function PaginaDeLaListaDeSecciones() {
  return pantallaDeOperacion({ titulo: "catalogo.seccion.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLasSecciones(contexto);
    const lista = respuesta.ok
      ? armarLaListaDeSecciones(respuesta.dato.secciones, await puedeEditarProductos(contexto))
      : null;
    return (
      <PantallaDeListaDeSecciones
        lista={lista}
        accion={moverSeccionAccion.bind(null, lista === null ? [] : lista.vistas)}
        error={respuesta.ok ? null : <ErrorDelDetalle error={respuesta.error} />}
      />
    );
  });
}
