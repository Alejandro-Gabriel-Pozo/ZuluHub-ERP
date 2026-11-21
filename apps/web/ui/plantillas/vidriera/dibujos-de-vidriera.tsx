import type { ReactElement } from "react";
import type { ModeloDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/modelos";
import {
  PlantillaDeVidriera,
  type PropsDePlantillaDeVidriera,
} from "./PlantillaDeVidriera.cliente";

/**
 * Qué modelo de carta tiene dibujo (V1b). Una entrada por modelo del catálogo (el compilador falla si se suma un modelo y no se anota acá): una función que dibuja la carta con su vista, o `null` si todavía
 * no se construyó (`CUADRICULA` y `LIBRO`: tienen elección y perilla pero ningún dibujo en la web). Todo dibujo recibe `vista.identidad` por la entrada común (`IdentidadDeLaCarta.tsx`);
 * `DibujosDeVidriera.test.tsx` lo comprueba para cada uno y falla si hay un dibujo (`Plantilla*.cliente.tsx`) que no figura acá.
 */
export type DibujoDeVidriera = (props: PropsDePlantillaDeVidriera) => ReactElement;

export const DIBUJOS_DE_VIDRIERA = {
  LISTA: (props) => <PlantillaDeVidriera {...props} />,
  CUADRICULA: null,
  LIBRO: null,
} as const satisfies Readonly<Record<ModeloDeVidriera, DibujoDeVidriera | null>>;
