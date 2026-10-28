/**
 * Buscar en la carta (D8). Todo pasa en el navegador y el texto buscado no sale del celular: acá solo hay
 * funciones puras sobre lo que ya llegó en la página.
 */

/** Con más productos que esto aparece el campo «Buscar en la carta»; con 40 o menos no hace falta (D8). */
export const PRODUCTOS_PARA_BUSCAR = 40;

/**
 * Minúsculas, sin tildes ni diéresis y con los blancos colapsados: «Ñoquis  de CALABAZA» → «noquis de calabaza».
 * Las marcas combinantes se quitan DESPUÉS de pasar a minúsculas porque `İ` suelta una al bajar.
 */
export function normalizarParaBuscar(texto: string): string {
  return texto.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

type Buscable = Readonly<{ nombre: string; descripcion: string | null }>;

/**
 * ¿El producto responde a la búsqueda? Cada palabra buscada tiene que estar en el nombre o en la descripción
 * (en cualquier orden y sin importar tildes ni mayúsculas). Una búsqueda vacía responde todo. Como el nombre
 * normalizado contiene cada una de sus palabras, buscar el nombre exacto de un producto SIEMPRE lo encuentra.
 */
export function coincideConLaBusqueda(producto: Buscable, consulta: string): boolean {
  const buscada = normalizarParaBuscar(consulta);
  // Una búsqueda vacía queda como [""] y todo texto la incluye: responde todo sin un caso aparte.
  const texto = normalizarParaBuscar(`${producto.nombre} ${producto.descripcion ?? ""}`);
  return buscada.split(" ").every((palabra) => texto.includes(palabra));
}

/**
 * Las secciones que quedan con la búsqueda: cada una conserva SU nombre y el orden de la carta, con solo los
 * productos que responden; las que se quedan sin ninguno desaparecen. `total` es lo que se anuncia.
 */
export function filtrarSecciones<
  P extends Buscable,
  S extends Readonly<{ productos: readonly P[] }>,
>(secciones: readonly S[], consulta: string): Readonly<{ secciones: readonly S[]; total: number }> {
  const resultado = secciones
    .map((s) => ({
      ...s,
      productos: s.productos.filter((p) => coincideConLaBusqueda(p, consulta)),
    }))
    .filter((s) => s.productos.length > 0);
  return { secciones: resultado, total: resultado.reduce((n, s) => n + s.productos.length, 0) };
}
