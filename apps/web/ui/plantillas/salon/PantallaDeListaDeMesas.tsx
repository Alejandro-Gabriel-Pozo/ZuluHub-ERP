import type { ReactNode } from "react";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeEstadoDeMesa } from "./FormularioDeEstadoDeMesa.cliente";
import estilos from "./PantallasDeMesas.module.css";
import type { ListaDeMesasArmada } from "./modelo-de-mesas";

export type PropsDePantallaDeListaDeMesas = Readonly<{
  /** Lo que se lista; `null` si no se pudo (entonces va `error`). */
  lista: ListaDeMesasArmada | null;
  /** La acción de «Desactivar» o «Reactivar» de cada mesa, ya ligada a ella. */
  accionDeEstado: (mesaId: string, reactivar: boolean) => AccionDeFormulario;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * La lista de las mesas de la sucursal (S-1; maqueta `mesas.html`, aprobada el 09/11/2026): todas, también las desactivadas, por número, cada una con «Editar mesa» y «Desactivar» o
 * «Reactivar». «Agregar mesa» solo si llega armada, es decir, si la persona puede administrar. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 * Pendiente (no pedido en esta entrega): el dibujo del plano de la maqueta.
 */
export function PantallaDeListaDeMesas({
  lista,
  accionDeEstado,
  error,
}: PropsDePantallaDeListaDeMesas) {
  return (
    <div className={estilos["raiz"]}>
      {error ?? null}
      {lista === null ? null : (
        <>
          <ul className={estilos["lista"]}>
            {lista.filas.map((fila) => (
              <li key={fila.id} className={estilos["fila"]}>
                <div className={estilos["cabecera"]}>
                  <span>{fila.titulo}</span>
                  {fila.marca === null ? null : <Insignia tono="aviso">{fila.marca}</Insignia>}
                </div>
                <p className={estilos["detalle"]}>{fila.detalle}</p>
                <div className={estilos["acciones"]}>
                  {fila.editar.href === null ? (
                    <span className={estilos["secundario"]} aria-disabled="true">
                      {fila.editar.texto}
                    </span>
                  ) : (
                    <a className={estilos["secundario"]} href={fila.editar.href}>
                      {fila.editar.texto}
                    </a>
                  )}
                  <FormularioDeEstadoDeMesa
                    texto={fila.estado.texto}
                    apagado={fila.estado.apagado}
                    accion={accionDeEstado(fila.id, fila.estado.reactivar)}
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
