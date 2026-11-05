/**
 * El modelo de vista de «Contacto de la sucursal» (D-98, alcance A de D-113): de la ficha de la sucursal elegida, lo que se escribe y el
 * pedido de `editarSucursal`. Puro: sin React ni servidor. Qué es un teléfono, un correo o una web válidos (y sus largos) lo decide el
 * servidor: acá solo se acomoda la forma del pedido.
 */

/** El contacto que entrega `fichaDeSucursal`: cada dato es texto o `null` (no cargado). */
export type ContactoDeLaSucursal = Readonly<{
  telefono: string | null;
  correo: string | null;
  web: string | null;
}>;

export type CampoDeContacto = keyof ContactoDeLaSucursal;

/** Lo que la persona escribe, tal cual: todo texto, vacío si no hay nada. */
export type ValoresDeContacto = Readonly<Record<CampoDeContacto, string>>;

const CAMPOS_DE_CONTACTO: readonly CampoDeContacto[] = ["telefono", "correo", "web"];

/** Los valores con los que abre el formulario: el contacto guardado, y vacío donde no hay nada. */
export const valoresDelContacto = (contacto: ContactoDeLaSucursal): ValoresDeContacto => ({
  telefono: contacto.telefono ?? "",
  correo: contacto.correo ?? "",
  web: contacto.web ?? "",
});

/** Lo que identifica a la sucursal y a lo que se vio de ella: el pedido lleva la versión que vio la pantalla (control optimista). */
export type SucursalDelContacto = Readonly<{
  sucursalId: string;
  /** El nombre actual: `editarSucursal` lo exige y acá no se edita, así que viaja igual que está. */
  nombre: string;
  version: number;
}>;

/**
 * El pedido de «Guardar» (`editarSucursal`): solo lleva lo que CAMBIÓ. Un campo no tocado va ausente (el servidor no lo toca: así no se
 * pisa lo que otra persona cargó mientras tanto) y uno vaciado va `null` (lo borra). Sin cambios: `null`, no hay nada que enviar.
 * Previene: reenviar los tres campos y pisar el contacto que otra persona cambió, o borrar un dato que la persona no tocó.
 */
export function armarElPedidoDeContacto(
  sucursal: SucursalDelContacto,
  original: ContactoDeLaSucursal,
  v: ValoresDeContacto,
): Readonly<Record<string, unknown>> | null {
  const antes = valoresDelContacto(original);
  const cambios: Partial<Record<CampoDeContacto, string | null>> = {};
  for (const campo of CAMPOS_DE_CONTACTO) {
    // Sin recortar: el recorte de espacios es una regla del contacto (`src/primitivas/contacto/`) y la aplica el servidor; acá solo se
    // distingue «igual», «vaciado» (texto vacío → `null`, borra) y «otro valor» (viaja tal cual). Un valor que solo difiere en espacios
    // viaja y el servidor responde «sin cambios» (éxito).
    const ahora = v[campo];
    if (ahora === antes[campo]) continue;
    cambios[campo] = ahora === "" ? null : ahora;
  }
  if (Object.keys(cambios).length === 0) return null;
  return {
    sucursalId: sucursal.sucursalId,
    versionEsperada: sucursal.version,
    nombre: sucursal.nombre,
    ...cambios,
  };
}

/** El nombre de campo que usa el servidor (`campo` del error) → el campo del formulario donde se marca. Uno que no conoce: `null` (va arriba). */
export const lugarDelErrorDeContacto = (campo: string | undefined): CampoDeContacto | null =>
  CAMPOS_DE_CONTACTO.find((c) => c === campo) ?? null;
