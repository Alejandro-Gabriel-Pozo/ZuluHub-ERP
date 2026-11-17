import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Texto } from "../../primitivas/Texto";
import { BotonDePruebaDeImpresora } from "./BotonDePruebaDeImpresora.cliente";
import { FormularioDeEstadoDeMesa } from "./FormularioDeEstadoDeMesa.cliente";
import estilos from "./PantallasDeMesas.module.css";
import propios from "./PantallasDeImpresoras.module.css";
import type { ListaDeImpresorasArmada } from "./modelo-de-impresoras";

export type PropsDePantallaDeListaDeImpresoras = Readonly<{
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaDeImpresorasArmada | null;
  /** La acción de «Quitar» de cada impresora, ya ligada a ella. */
  accionDeQuitar: (impresoraId: string) => AccionDeFormulario;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de las impresoras de la sucursal (S-2; maqueta `imprimir.html`, aprobada el 09/11/2026): cada una con su nombre (que lleva a editarla), el papel y para qué sirve, «Imprimir prueba» y «Quitar».
 * «Agregar impresora» solo si llega armada, es decir, si la persona puede administrar; si no, el mensaje genérico y todo lo que cambia algo apagado (estado «Sin permiso» de la maqueta). Sin textos propios: todos llegan
 * resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeImpresoras({
  lista,
  accionDeQuitar,
  error,
}: PropsDePantallaDeListaDeImpresoras) {
  return (
    <div className={estilos["raiz"]}>
      {error ?? null}
      {lista === null ? null : (
        <>
          {lista.sinPermiso === null ? null : (
            <Aviso tono="info">
              <Texto>{lista.sinPermiso}</Texto>
            </Aviso>
          )}
          <ul className={estilos["lista"]}>
            {lista.filas.map((fila) => (
              <li key={fila.id} className={estilos["fila"]}>
                <div className={estilos["cabecera"]}>
                  {fila.editar === null ? (
                    <span aria-disabled="true">{fila.nombre}</span>
                  ) : (
                    <a className={propios["nombre"]} href={fila.editar}>
                      {fila.nombre}
                    </a>
                  )}
                  <span>{fila.papel}</span>
                </div>
                <p className={estilos["detalle"]}>{fila.uso}</p>
                <div className={estilos["acciones"]}>
                  <BotonDePruebaDeImpresora
                    texto={fila.prueba}
                    textoImprimiendo={lista.imprimiendo}
                    nombre={fila.nombre}
                    papelMm={fila.papelMm}
                  />
                  <FormularioDeEstadoDeMesa
                    texto={fila.quitar.texto}
                    apagado={fila.quitar.apagado}
                    accion={accionDeQuitar(fila.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
          {lista.nueva === null ? null : (
            <div>
              <EnlaceDeAccion href={lista.nueva.href}>{lista.nueva.texto}</EnlaceDeAccion>
            </div>
          )}
        </>
      )}
    </div>
  );
}
