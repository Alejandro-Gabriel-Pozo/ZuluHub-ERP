import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  discriminaIva,
  type AlicuotaDeCompra,
  type CondicionDeIvaDeLaEmpresa,
  type TipoDeComprobanteDeProveedor,
} from "./comprobante";

/**
 * Qué IVA entra al COSTO de una línea (DEC-0322, decisión del dueño del 11/11/2026): según la condición de la empresa frente al IVA, en una Factura A con
 * IVA discriminado — responsable inscripto: ninguno (el IVA es crédito fiscal, el costo es el neto); monotributista o exento: la alícuota de la línea (ese IVA
 * no se recupera, el costo es el importe con IVA incluido; `EXENTO` y `NO_GRAVADO` no llevan IVA). En una B o C, o en una línea sin alícuota, ninguno: el costo es
 * el importe de la línea en todos los casos. Si la condición no se puede leer y el IVA está discriminado, `CONDICION_DE_IVA_NO_DISPONIBLE`: la compra no se
 * registra (cierra, no supone). Es la ÚNICA regla: la usan el registro de la compra y la corrección de precio.
 */
export function alicuotaQueEntraAlCosto(
  condicion: CondicionDeIvaDeLaEmpresa | null,
  tipo: TipoDeComprobanteDeProveedor,
  alicuota: AlicuotaDeCompra | null,
): Resultado<AlicuotaDeCompra | null, "CONDICION_DE_IVA_NO_DISPONIBLE"> {
  if (!discriminaIva(tipo) || alicuota === null) return ok(null);
  if (condicion === null) return err("CONDICION_DE_IVA_NO_DISPONIBLE");
  if (condicion === "RESPONSABLE_INSCRIPTO") return ok(null);
  return ok(alicuota === "EXENTO" || alicuota === "NO_GRAVADO" ? null : alicuota);
}
