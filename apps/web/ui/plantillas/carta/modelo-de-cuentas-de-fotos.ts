import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista de la pantalla «Conectá tu cuenta de fotos» (cuentas de imagen declaradas, 0102): de lo que entrega la composición, lo que se ve y NADA más. Puro: sin React ni servidor. Los textos
 * salen del catálogo: dos nuevos (`catalogo.cuentas_de_fotos.*`, propuesta pendiente del OK del dueño, DEC-CAT-001) y el resto ya aprobados («Guardar», «Quitar», «Motivo»); no se arma ningún texto.
 *
 * Reglas (cada una con su prueba en `test/web/cuentas-de-fotos-modelo.test.ts`):
 *  - **Solo las cuentas activas** (las retiradas no se listan: quedan en la base con quién las retiró y por qué).
 *  - **El permiso lo decide el servidor:** sin `vidrieras.administrar_cuentas_de_imagen` la consulta rechaza y la pantalla no llega a armarse; no hay botones apagados ni avisos por permiso.
 *  - **Cada cuenta lleva su versión** (la que la persona vio): retirar la manda y el servidor rechaza si cambió.
 */

/** La pantalla y su única dirección. SUPUESTO (DEC-CAT-002): ruta propia hermana de «Carta en línea», sin entrada nueva en el menú. Revertir: cambiar esta constante y la carpeta de la página. */
export const RUTA_DE_LAS_CUENTAS_DE_FOTOS = "/catalogo/carta-en-linea/cuentas-de-fotos";

/** Lo que entrega la composición (la UI no importa los módulos). */
export type CuentasDeFotosDeLaPantalla = readonly Readonly<{
  id: string;
  cuenta: string;
  version: number;
}>[];

export type CuentasDeFotosArmadas = Readonly<{
  titulo: string;
  /** El formulario de declarar. */
  declarar: Readonly<{ cuenta: string; guardar: string }>;
  /** Una fila por cuenta activa, con lo que necesita su formulario de retiro. */
  cuentas: readonly Readonly<{ id: string; cuenta: string; version: number }>[];
  retirar: Readonly<{ motivo: string; quitar: string }>;
}>;

const T = (d: DiccionarioResuelto, clave: ClaveDeTexto): string => texto(d, clave);

export function armarLasCuentasDeFotos(
  dato: CuentasDeFotosDeLaPantalla,
  d: DiccionarioResuelto = {},
): CuentasDeFotosArmadas {
  return {
    titulo: T(d, "catalogo.cuentas_de_fotos.titulo"),
    declarar: {
      cuenta: T(d, "catalogo.cuentas_de_fotos.cuenta"),
      guardar: T(d, "catalogo.accion.guardar"),
    },
    cuentas: dato.map((c) => ({ id: c.id, cuenta: c.cuenta, version: c.version })),
    retirar: { motivo: T(d, "stock.accion.motivo"), quitar: T(d, "catalogo.carta.quitar") },
  };
}
