import { ok, type Resultado } from "../resultado/resultado";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO } from "./nombre-de-producto";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: TEXTO DE BÚSQUEDA DE PRODUCTOS (lista de A1, `fichas-de-modulo/a1-productos-y-precios.md` §6: filtro «texto» de `listarProductos`). Lo que se escribe
 * en el buscador para encontrar un producto por su nombre. Se valida con la MISMA lista de permitidos que el nombre (`texto-de-una-linea`, con los signos de catálogo) y
 * con el mismo largo máximo (nada que se busque puede ser más largo que lo buscado): así no entra un carácter que ningún nombre puede tener. Vacío o solo blancos = sin
 * filtro (`null`), no un error: el buscador vacío muestra todo. Sin letras exigidas: se puede buscar «7up» o «2x1». Costo conocido: un texto que empieza con `+` o `-`
 * se rechaza, igual que un nombre (Q7, dueño, 2026-11-06). Previene: un filtro libre que llega sin validar a la consulta (largo sin tope, control e invisibles).
 */
export function textoDeBusquedaDeProductoDesdeTexto(
  texto: string,
): Resultado<string | null, MotivoDeTextoInvalido> {
  if (texto.trim() === "") return ok(null);
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}
