import { errorDeCodigo } from "../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarElArbolDeClasificacion } from "../../../../../../servidor/clasificacion";
import { puedeEditarProductos } from "../../../../../../servidor/modulos";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeClasificacion } from "../../../../../../ui/plantillas/catalogo/PantallaDeClasificacion.cliente";
import { armarElArbol } from "../../../../../../ui/plantillas/catalogo/modelo-de-clasificacion";
import {
  crearNodoDeClasificacionAccion,
  desactivarNodoDeClasificacionAccion,
  moverNodoDeClasificacionAccion,
  reactivarNodoDeClasificacionAccion,
  renombrarNodoDeClasificacionAccion,
} from "../../../acciones-de-clasificacion";

// `/catalogo/clasificacion`: la clasificación comercial de la empresa, el árbol departamento → categoría de hasta 4 niveles (maqueta `clasificacion.html`, aprobada el 12/11/2026). Solo la ven y la
// editan gerente y administrador (`productos.editar`, alcance de toda la empresa): el operador no ve la entrada y, si llega por la dirección, ve «Esta acción no está permitida». Es una ayuda de
// pantalla: cada acción vuelve a pasar por el guard dentro de su transacción. La empresa y la persona las pone el servidor; el módulo en desarrollo y el permiso de lectura los decide la consulta.
export default async function PaginaDeLaClasificacion() {
  return pantallaDeOperacion({ titulo: "catalogo.clasificacion.titulo" }, async ({ contexto }) => {
    if (!(await puedeEditarProductos(contexto))) {
      return <ErrorDelDetalle error={errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA")} />;
    }
    const respuesta = await cargarElArbolDeClasificacion(contexto);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    return (
      <PantallaDeClasificacion
        arbol={armarElArbol(respuesta.dato.nodos)}
        acciones={{
          crear: crearNodoDeClasificacionAccion,
          renombrar: renombrarNodoDeClasificacionAccion,
          mover: moverNodoDeClasificacionAccion,
          desactivar: desactivarNodoDeClasificacionAccion,
          reactivar: reactivarNodoDeClasificacionAccion,
        }}
      />
    );
  });
}
