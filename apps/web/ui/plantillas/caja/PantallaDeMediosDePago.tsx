import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { AccionDeMedio } from "./AccionDeMedio.cliente";
import type { AccionesDeMedios, FilaDeMedio } from "./modelo-de-medios-de-pago";
import estilos from "./PantallaDeMediosDePago.module.css";

type TextosDeMedios = Readonly<{
  agregar: string;
  editar: string;
  desactivar: string;
  reactivar: string;
}>;

export type PropsDePantallaDeMediosDePago = Readonly<{
  filas: readonly FilaDeMedio[];
  acciones: AccionesDeMedios;
  textos: TextosDeMedios;
  /** Adónde lleva «Agregar medio». */
  hrefDeAgregar: string;
  /** Las acciones de servidor de cada medio, ya ligadas a su id (`bind`): desactivar y reactivar. */
  accionDe: (
    fila: FilaDeMedio,
  ) => Readonly<{ desactivar: AccionDeFormulario; reactivar: AccionDeFormulario }>;
}>;

/**
 * La lista de medios de pago (maqueta `medios.html`, 09/11/2026): una tarjeta por medio, también los desactivados, con su nombre, su estado, qué cuenta de cobro lleva
 * y los botones de editar y desactivar o reactivar. Sin permiso, el botón sale apagado. El efectivo no se desactiva nunca: su botón sale apagado. Al pie,
 * «Agregar medio». Sin textos propios: todos llegan resueltos.
 */
export function PantallaDeMediosDePago({
  filas,
  acciones,
  textos,
  hrefDeAgregar,
  accionDe,
}: PropsDePantallaDeMediosDePago) {
  return (
    <div className={estilos["raiz"]}>
      <ul className={estilos["lista"]}>
        {filas.map((fila) => {
          const ofrecida = fila.activo ? acciones.desactivar : acciones.reactivar;
          const accion = fila.activo ? accionDe(fila).desactivar : accionDe(fila).reactivar;
          const texto = fila.activo ? textos.desactivar : textos.reactivar;
          const apagada = !ofrecida || (fila.activo && !fila.sePuedeDesactivar);
          return (
            <li key={fila.id} className={estilos["tarjeta"]}>
              <div className={estilos["cabecera"]}>
                <strong className={estilos["titulo"]}>{fila.titulo}</strong>
                <Insignia tono={fila.estado.tono}>{fila.estado.texto}</Insignia>
              </div>
              <span className={estilos["detalle"]}>{fila.detalle}</span>
              <div className={estilos["acciones"]}>
                {acciones.editar ? (
                  <EnlaceDeAccion href={fila.href}>{textos.editar}</EnlaceDeAccion>
                ) : (
                  <Boton deshabilitado variante="secundaria">
                    {textos.editar}
                  </Boton>
                )}
                {apagada ? (
                  <Boton deshabilitado variante="secundaria">
                    {texto}
                  </Boton>
                ) : (
                  <AccionDeMedio accion={accion}>{texto}</AccionDeMedio>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div>
        {acciones.agregar ? (
          <EnlaceDeAccion href={hrefDeAgregar}>{textos.agregar}</EnlaceDeAccion>
        ) : (
          <Boton deshabilitado>{textos.agregar}</Boton>
        )}
      </div>
    </div>
  );
}
