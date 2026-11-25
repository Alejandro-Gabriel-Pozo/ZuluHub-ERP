import type { CartaDeLaLista } from "../../../../../src/puertos/vidriera-publica";
import estilos from "./ListaDeCartasDeLaRaiz.module.css";

export type PropsDeListaDeCartasDeLaRaiz = Readonly<{
  cartas: readonly CartaDeLaLista[];
  /** El camino de cada carta: lo arma el servidor (`rutaPublicaDe`), nunca esta pieza. */
  rutaDe: (codigo: string) => string;
}>;

/**
 * La raíz de la carta en un host dedicado con VARIAS cartas en línea: un enlace por carta con su nombre y, si el comerciante los cargó, su rubro y su lugar. Sin texto propio
 * (todo es dato de la carta) y HTML común: sin JavaScript se lee igual.
 */
export function ListaDeCartasDeLaRaiz({ cartas, rutaDe }: PropsDeListaDeCartasDeLaRaiz) {
  return (
    <ul className={estilos["lista"]}>
      {cartas.map((carta) => (
        <li key={carta.codigo}>
          <a className={estilos["enlace"]} href={rutaDe(carta.codigo)}>
            <span className={estilos["nombre"]}>{carta.nombre}</span>
            {carta.rubro === null ? null : (
              <span className={estilos["detalle"]}>{carta.rubro}</span>
            )}
            {carta.lugar === null ? null : (
              <span className={estilos["detalle"]}>{carta.lugar}</span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
