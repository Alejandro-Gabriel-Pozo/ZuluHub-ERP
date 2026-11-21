import type { VistaDeIdentidad } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import estilos from "./IdentidadDeLaCarta.module.css";
import { LogoDeLaPlaca } from "./LogoDeLaPlaca.cliente";

/**
 * LA ENTRADA COMÚN de la identidad de la carta (V1b): lo único que un dibujo de la carta (la Lista hoy; el Libro y la Cuadrícula cuando se dibujen) toma de `vista.identidad` para mostrar la cara y la placa.
 * Los COLORES no pasan por acá: salen del tema que la página pone en un `<style nonce>` sobre `:root` y valen para cualquier dibujo (`cssDelTemaDeLaCarta`). Un dibujo nuevo usa estas dos piezas y su
 * prueba (`DibujosDeVidriera.test.tsx`) falla si no lo hace: ningún modelo toca cómo se guarda ni cómo se lee la identidad. Sin identidad elegida (`tema` nulo) no devuelven nada: la carta se ve como siempre.
 */

/** Los atributos de la raíz de un dibujo: la cara elegida (`data-cara`), o ninguno si la carta no eligió nada. */
export function atributosDeLaCara(identidad: VistaDeIdentidad): { "data-cara"?: string } {
  return identidad.tema === null ? {} : { "data-cara": identidad.cara };
}

/**
 * La placa de la cabecera, decorativa (el nombre ya está escrito al lado): la inicial del nombre y, si la carta cargó un logo, la imagen encima. El logo es una ruta PROPIA de la carta
 * (`vista.identidad.logo`): el servidor lo trae del proveedor y lo entrega desde acá, porque la CSP solo deja imágenes propias. Si la imagen no llega, queda la inicial. Sin cara, color
 * ni logo elegidos no devuelve nada: la carta se ve como siempre.
 */
export function PlacaDeLaCarta({ identidad }: Readonly<{ identidad: VistaDeIdentidad }>) {
  if (identidad.tema === null && identidad.logo === null) return null;
  return (
    <span className={estilos["placa"]} aria-hidden="true" data-placa="" data-cara={identidad.cara}>
      {identidad.inicial}
      {identidad.logo === null ? null : <LogoDeLaPlaca direccion={identidad.logo} />}
    </span>
  );
}
