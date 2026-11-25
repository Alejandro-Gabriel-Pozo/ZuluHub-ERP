import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeEstadoDeSeccion } from "./FormularioDeEstadoDeSeccion.cliente";
import { ListaDeProductosDeSeccion } from "./ListaDeProductosDeSeccion.cliente";
import estilos from "./PantallasDeSecciones.module.css";
import type { UnaSeccionArmada } from "./modelo-de-secciones";

export type PropsDePantallaDeUnaSeccion = Readonly<{
  seccion: UnaSeccionArmada;
  /** La acción de «Desactivar» o «Reactivar», ya ligada a la sección (la página elige según su estado). */
  accionDeEstado: AccionDeFormulario;
  /** La acción de «Quitar», ya ligada a la sección y a los productos como la persona los ve. */
  accionDeQuitar: AccionDeFormulario;
}>;

/**
 * Una sección de la carta (A8, partes 1 y 2; maqueta `productos-secciones.html`, 12/11/2026): su marca «Desactivado» si corresponde, «Nombre» y «Desactivar» / «Reactivar», sus productos activos en
 * orden alfabético, cada uno con «Quitar», y «Agregar producto» al final (como el pie de la maqueta; apagado sin permiso). Una sección sin productos no dice nada. Sin textos propios: todos llegan resueltos. El `h1` (el nombre
 * de la sección) lo pone el armazón.
 */
export function PantallaDeUnaSeccion({
  seccion,
  accionDeEstado,
  accionDeQuitar,
}: PropsDePantallaDeUnaSeccion) {
  return (
    <div className={estilos["raiz"]}>
      <a
        className={estilos["volver"]}
        href={seccion.volver.href}
        aria-label={seccion.volver.etiqueta}
      >
        <span aria-hidden="true">‹</span>
      </a>
      {seccion.marca === null ? null : <Insignia tono="aviso">{seccion.marca}</Insignia>}
      <div className={estilos["acciones"]}>
        {seccion.nombre.href === null ? (
          <Boton variante="secundaria" deshabilitado>
            {seccion.nombre.texto}
          </Boton>
        ) : (
          <a className={estilos["secundario"]} href={seccion.nombre.href}>
            {seccion.nombre.texto}
          </a>
        )}
        <FormularioDeEstadoDeSeccion
          texto={seccion.estado.texto}
          accion={accionDeEstado}
          apagado={seccion.estado.apagado}
        />
      </div>
      <ListaDeProductosDeSeccion
        productos={seccion.productos}
        quitar={seccion.quitar}
        accion={accionDeQuitar}
      />
      {seccion.siguiente === null ? null : (
        <a className={estilos["secundario"]} href={seccion.siguiente.href}>
          {seccion.siguiente.texto}
        </a>
      )}
      <div>
        {seccion.agregar.href === null ? (
          <Boton deshabilitado>{seccion.agregar.texto}</Boton>
        ) : (
          <EnlaceDeAccion href={seccion.agregar.href}>{seccion.agregar.texto}</EnlaceDeAccion>
        )}
      </div>
    </div>
  );
}
