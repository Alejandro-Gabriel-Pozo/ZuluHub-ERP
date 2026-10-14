import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import estilos from "./EsqueletoDePantalla.module.css";

/**
 * El esqueleto mientras carga una pantalla ([01] §6.4: «nunca bloquear toda la pantalla»): bloques con la
 * forma del contenido y un «Cargando…» anunciado como región ocupada. Sin animación si la persona pidió
 * menos movimiento (la duración de los tokens vale 0 ms).
 */
export function EsqueletoDePantalla({
  diccionario = {},
}: Readonly<{ diccionario?: DiccionarioResuelto }>) {
  return (
    <main className={estilos["raiz"]}>
      <RegionDeEstado ocupada visible={false}>
        {texto(diccionario, "estado.cargando")}
      </RegionDeEstado>
      <div className={estilos["bloque"]} data-ancho="medio" aria-hidden="true" />
      <div className={estilos["bloque"]} data-ancho="completo" aria-hidden="true" />
      <div className={estilos["bloque"]} data-ancho="completo" aria-hidden="true" />
    </main>
  );
}
