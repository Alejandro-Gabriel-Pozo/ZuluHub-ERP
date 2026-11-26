import { Insignia } from "../../../componentes/Insignia";
import { SelectorDeDeposito } from "../lectura/SelectorDeDeposito";
import type { VistaDeExistencias } from "./modelo-de-existencias";
import estilos from "./PantallaDeExistencias.module.css";

export type PropsDePantallaDeExistencias = Readonly<{
  vista: VistaDeExistencias;
  textos: Readonly<{ depositos: string; negativa: string; siguiente: string }>;
}>;

/**
 * «Existencias» de la sucursal (maqueta `stock.html`, 09/11/2026): el selector de depósitos y una tarjeta por artículo con su existencia y su unidad; «Negativa» marca el saldo bajo cero.
 * Es solo lectura: los textos llegan resueltos y no hay botones que escriban.
 */
export function PantallaDeExistencias({ vista, textos }: PropsDePantallaDeExistencias) {
  return (
    <div className={estilos["raiz"]}>
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
