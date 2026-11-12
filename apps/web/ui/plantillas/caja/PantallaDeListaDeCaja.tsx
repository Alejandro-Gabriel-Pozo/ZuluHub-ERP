import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { AccionDeLista } from "./AccionDeLista.cliente";
import type { AccionesDeLista, FilaDeLista } from "./lista-de-caja";
import estilos from "./PantallaDeListaDeCaja.module.css";

type TextosDeLista = Readonly<{
  agregar: string;
  editar: string;
  desactivar: string;
  reactivar: string;
}>;

export type PropsDePantallaDeListaDeCaja = Readonly<{
  filas: readonly FilaDeLista[];
  acciones: AccionesDeLista;
  textos: TextosDeLista;
  /** Adónde lleva «Agregar medio». */
  hrefDeAgregar: string;
  /** Las acciones de servidor de cada medio, ya ligadas a su id (`bind`): desactivar y reactivar. */
  accionDe: (
    fila: FilaDeLista,
  ) => Readonly<{ desactivar: AccionDeFormulario; reactivar: AccionDeFormulario }>;
}>;

/**
 * La lista de la configuración de caja (medios de pago, cuentas de cobro y cajas; maqueta `medios.html`, 09/11/2026): una tarjeta por elemento, también los desactivados, con su nombre, su estado, su detalle
 * y los botones de editar y desactivar o reactivar. Sin permiso, el botón sale apagado; el que no se desactiva nunca (el efectivo) también. Al pie, el botón de agregar.
 * Sin textos propios: todos llegan resueltos.
 */
export function PantallaDeListaDeCaja({
  filas,
  acciones,
  textos,
  hrefDeAgregar,
  accionDe,
}: PropsDePantallaDeListaDeCaja) {
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
              {fila.detalle === "" ? null : (
                <span className={estilos["detalle"]}>{fila.detalle}</span>
              )}
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
                  <AccionDeLista accion={accion}>{texto}</AccionDeLista>
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
