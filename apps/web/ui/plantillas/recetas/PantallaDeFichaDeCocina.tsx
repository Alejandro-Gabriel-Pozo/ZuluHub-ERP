import { Texto } from "../../primitivas/Texto";
import type { CocinaArmada } from "./modelo-de-receta";
import estilos from "./PantallaDeUnaReceta.module.css";

export type PropsDePantallaDeFichaDeCocina = Readonly<{ cocina: CocinaArmada }>;

/**
 * La ficha de cocina (maqueta `receta.html`, 15/11/2026, `vCocina`): el nombre del producto, «Rinde N · Versión V», cada ingrediente con su cantidad BRUTA y los pasos. Sin costos ni precios
 * (D99: la consulta no los trae) y sin «Imprimir» (S7). Solo lectura. Sin textos propios: todos llegan resueltos. El `h1` («Ficha de cocina») lo pone el armazón.
 */
export function PantallaDeFichaDeCocina({ cocina }: PropsDePantallaDeFichaDeCocina) {
  return (
    <div className={estilos["raiz"]}>
      <Texto como="h2" variante="subtitulo">
        {cocina.titulo}
      </Texto>
      <Texto variante="suave">{cocina.encabezado}</Texto>
      <ul className={estilos["lista"]}>
        {cocina.filas.map((fila) => (
          <li key={fila.clave} className={estilos["linea"]}>
            <span className={estilos["renglon"]}>
              <span className={estilos["nombre"]}>{fila.nombre}</span>
              <span className={`${estilos["valor"] ?? ""} ${estilos["fuerte"] ?? ""}`}>
                {fila.cantidad}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {cocina.pasos === null ? null : <p className={estilos["pasos"]}>{cocina.pasos}</p>}
    </div>
  );
}
