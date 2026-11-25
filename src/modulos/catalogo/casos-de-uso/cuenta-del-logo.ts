import type { PartesDeDireccion } from "../../../capacidades/activos/direccion-externa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TxDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export const mismoLogo = (a: PartesDeDireccion | null, b: PartesDeDireccion | null): boolean =>
  a === null || b === null
    ? a === b
    : a.proveedor === b.proveedor &&
      a.cuenta === b.cuenta &&
      a.idPublico === b.idPublico &&
      a.version === b.version &&
      a.extension === b.extension;

/**
 * Un logo NUEVO o CAMBIADO solo se guarda si su cuenta está declarada y activa en la empresa (0102; spec §5.7.2): quien edita la carta no puede traer el logo de una cuenta ajena.
 * Un logo que no cambia no se vuelve a pedir (las cartas con un logo anterior a las cuentas declaradas siguen editándose; ese logo no se muestra hasta que se declare su cuenta). La
 * base repite la regla con un disparador sobre `carta_publica` (defensa en profundidad).
 */
export async function exigirCuentaDelLogo(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  nuevo: PartesDeDireccion | null,
  actual: PartesDeDireccion | null,
): Promise<R<null>> {
  if (nuevo === null || mismoLogo(actual, nuevo)) return ok(null);
  const declarada = await tx.cuentasDeImagen.activaDe(
    contexto.empresaId,
    nuevo.proveedor,
    nuevo.cuenta,
  );
  return declarada === null ? err("LOGO_DE_CARTA_CUENTA_NO_DECLARADA") : ok(null);
}
