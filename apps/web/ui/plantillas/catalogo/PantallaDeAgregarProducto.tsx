import type { ReactNode } from "react";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeBuscadorDeCandidatos } from "./FormularioDeBuscadorDeCandidatos.cliente";
import { ListaDeCandidatos } from "./ListaDeCandidatos.cliente";
import estilos from "./PantallasDeSecciones.module.css";
import type { CandidatosArmados } from "./modelo-de-secciones";

export type PropsDePantallaDeAgregarProducto = Readonly<{
  candidatos: CandidatosArmados;
  /** La acción de «Agregar producto», ya ligada a la sección y a los candidatos que se ven. */
  accion: AccionDeFormulario;
  /** El error ya pintado de la lectura (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * «Agregar producto» a una sección (A8, parte 2; maqueta `productos-secciones.html`, 12/11/2026): el buscador, los productos que se pueden elegir (con su sección de hoy al lado) y «Cancelar», que
 * vuelve a la sección. Es una pantalla y no una hoja (S6 de la ficha: la búsqueda por dirección reusa el patrón de la lista de productos). Una lista vacía no dice nada. Sin textos propios: todos
 * llegan resueltos. El `h1` («Agregar producto») lo pone el armazón.
 */
export function PantallaDeAgregarProducto({
  candidatos,
  accion,
  error,
}: PropsDePantallaDeAgregarProducto) {
  return (
    <div className={estilos["raiz"]}>
      {/* La `key` reinicia el campo cuando cambia el texto de la dirección. */}
      <FormularioDeBuscadorDeCandidatos
        key={candidatos.buscador.valorInicial}
        buscador={candidatos.buscador}
      />
      {error ?? null}
      <ListaDeCandidatos filas={candidatos.filas} accion={accion} />
      {candidatos.siguiente === null ? null : (
        <a className={estilos["secundario"]} href={candidatos.siguiente.href}>
          {candidatos.siguiente.texto}
        </a>
      )}
      <a className={estilos["secundario"]} href={candidatos.cancelar.href}>
        {candidatos.cancelar.texto}
      </a>
    </div>
  );
}
