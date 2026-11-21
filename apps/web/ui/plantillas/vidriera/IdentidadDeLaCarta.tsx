import type { VistaDeIdentidad } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import estilos from "./IdentidadDeLaCarta.module.css";

/**
 * LA ENTRADA COMÚN de la identidad de la carta (V1b): lo único que un dibujo de la carta (la Lista hoy; el Libro y la Cuadrícula cuando se dibujen) toma de `vista.identidad` para mostrar la cara y la placa.
 * Los COLORES no pasan por acá: salen del tema que la página pone en un `<style nonce>` sobre `:root` y valen para cualquier dibujo (`cssDelTemaDeLaCarta`). Un dibujo nuevo usa estas dos piezas y su
 * prueba (`DibujosDeVidriera.test.tsx`) falla si no lo hace: ningún modelo toca cómo se guarda ni cómo se lee la identidad. Sin identidad elegida (`tema` nulo) no devuelven nada: la carta se ve como siempre.
 */

/** Los atributos de la raíz de un dibujo: la cara elegida (`data-cara`), o ninguno si la carta no eligió nada. */
export function atributosDeLaCara(identidad: VistaDeIdentidad): { "data-cara"?: string } {
  return identidad.tema === null ? {} : { "data-cara": identidad.cara };
}

/** La placa con la inicial del nombre, para la cabecera: decorativa (el nombre ya está escrito al lado). El logo no se pinta todavía. */
export function PlacaDeLaCarta({ identidad }: Readonly<{ identidad: VistaDeIdentidad }>) {
  if (identidad.tema === null) return null;
  return (
    <span className={estilos["placa"]} aria-hidden="true" data-placa="" data-cara={identidad.cara}>
      {identidad.inicial}
    </span>
  );
}
