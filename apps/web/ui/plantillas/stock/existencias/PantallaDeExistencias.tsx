import { Boton } from "../../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import { SelectorDeDeposito } from "../lectura/SelectorDeDeposito";
import type { VistaDeExistencias } from "./modelo-de-existencias";
import estilos from "./PantallaDeExistencias.module.css";

export type PropsDePantallaDeExistencias = Readonly<{
  vista: VistaDeExistencias;
  textos: Readonly<{ depositos: string; negativa: string; siguiente: string }>;
  /** Los botones que llevan a los formularios de movimiento; apagados si el servidor no deja hacerlo hoy (solo una ayuda: el guard decide). */
  acciones: readonly Readonly<{ texto: string; href: string; habilitado: boolean }>[];
}>;

/**
 * «Existencias» de la sucursal (maqueta `stock.html`, 09/11/2026): el selector de depósitos y una tarjeta por artículo con su existencia y su unidad; «Negativa» marca el saldo bajo cero.
 * Los botones llevan a los formularios de movimiento (Entrada, Salida, Transferir y Ajustar), apagados sin permiso; los textos llegan resueltos.
 */
export function PantallaDeExistencias({ vista, textos, acciones }: PropsDePantallaDeExistencias) {
  return (
    <div className={estilos["raiz"]}>
      <div className={estilos["acciones"]}>
        {acciones.map((a) =>
          a.habilitado ? (
            <EnlaceDeAccion key={a.href} href={a.href} variante="secundaria">
              {a.texto}
            </EnlaceDeAccion>
          ) : (
            <Boton key={a.href} deshabilitado>
              {a.texto}
            </Boton>
          ),
        )}
      </div>
      <SelectorDeDeposito rotulo={textos.depositos} opciones={vista.opciones} />
      <ul className={estilos["lista"]}>
        {vista.filas.map((fila) => (
          <li key={fila.id} className={estilos["tarjeta"]}>
            <strong className={estilos["titulo"]}>{fila.titulo}</strong>
            <span className={estilos["cantidad"]}>{fila.cantidad}</span>
            {fila.negativa ? <Insignia tono="peligro">{textos.negativa}</Insignia> : null}
          </li>
        ))}
      </ul>
      {vista.hrefDeSiguiente === null ? null : (
        <a href={vista.hrefDeSiguiente}>{textos.siguiente}</a>
      )}
    </div>
  );
}
