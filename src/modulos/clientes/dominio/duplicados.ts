import { normalizarParaBusqueda } from "./busqueda";

/**
 * Los posibles duplicados (E9 §3.1, F3 de `clientes-y-proveedores.md`): un AVISO que no bloquea. El documento repetido NO es un posible duplicado:
 * ese lo rechaza la base (`DOCUMENTO_YA_REGISTRADO`). Dos partes son posible duplicado si comparten el email, el teléfono (comparado por sus
 * dígitos) o el nombre completo (comparado sin tildes ni mayúsculas). La persona decide con «Guardar igual».
 */
export type RazonDeDuplicado = "EMAIL" | "TELEFONO" | "NOMBRE";

export type DatosParaDuplicados = Readonly<{
  email: string | null;
  telefono: string | null;
  /** Apellido, nombre y alias, tal como los arma la columna `nombre_busqueda`. */
  nombreCompleto: string;
}>;

/** Los dígitos de un teléfono (la columna generada `telefono_digitos`); `null` si no tiene o no tiene ninguno. */
export function digitosDeTelefono(telefono: string | null): string | null {
  if (telefono === null) return null;
  const digitos = [...telefono].filter((c) => c >= "0" && c <= "9").join("");
  return digitos === "" ? null : digitos;
}

/** Por qué `otra` es un posible duplicado de `nueva`, en el orden email, teléfono, nombre; vacío si no lo es. */
export function razonesDeDuplicado(
  nueva: DatosParaDuplicados,
  otra: DatosParaDuplicados,
): readonly RazonDeDuplicado[] {
  const razones: RazonDeDuplicado[] = [];
  if (nueva.email !== null && nueva.email === otra.email) razones.push("EMAIL");
  const digitos = digitosDeTelefono(nueva.telefono);
  if (digitos !== null && digitos === digitosDeTelefono(otra.telefono)) razones.push("TELEFONO");
  const nombre = normalizarParaBusqueda(nueva.nombreCompleto);
  if (nombre !== "" && nombre === normalizarParaBusqueda(otra.nombreCompleto)) {
    razones.push("NOMBRE");
  }
  return razones;
}
