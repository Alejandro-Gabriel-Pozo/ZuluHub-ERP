/**
 * FICHA DEL DATO: TELÉFONO DE CONTACTO. (DECIDIDO = D-98, 2026-11-04; SUPUESTO = del ingeniero, revertible; SIN DECIDIR = falta la
 * decisión del dueño.)
 *
 * - Qué es: el teléfono de un local (hoy, el de la sucursal) que la factura impresa muestra si existe (D-98).
 * - Cómo se escribe: texto libre de UNA línea, sin formato fijo ("+54 11 4321-0000", "4321-0000 int. 2"). Normalización: solo se
 *   recortan los blancos de los extremos; no se tocan los dígitos ni los separadores. Sin caracteres de control. De 1 a
 *   `LARGO_MAXIMO_DEL_TELEFONO` (40) caracteres (SUPUESTO). Uno solo por local (SUPUESTO).
 * - Obligatorio/opcional: OPCIONAL (D-98). Vacío = «no tiene»: un texto en blanco o `null` borra el dato (SUPUESTO); en la base es
 *   NULL, nunca un texto vacío.
 * - Único: NO. La base no le pone unicidad (dos sucursales pueden tener el mismo teléfono). Si debe serlo: SIN DECIDIR.
 * - Quién lo cambia: quien edita la sucursal (permiso `sucursales.editar`: gerente y administrador; SUPUESTO).
 * - Verificado o declarado: solo DECLARADO; nadie lo verifica.
 * - Se congela en comprobantes: SÍ, el vigente al darse de alta el comprobante (`comprobante.sucursal_telefono`, copiado por la
 *   base); no cambia nunca después. Los comprobantes anteriores a 0019 quedan sin teléfono (D-98).
 * - Dato personal: puede serlo (un celular cargado como teléfono del local). Se audita el antes y el después en `auditoria_empresa`
 *   (de solo inserción) y queda en las facturas ya emitidas. Si alguna norma de datos personales lo alcanza: SIN DECIDIR.
 * - Cómo se compara y cómo se imprime: se compara por igualdad exacta del texto ya recortado ("4321-0000" y "43210000" son
 *   distintos). Cómo se imprime (rótulo, lugar en el papel): SIN DECIDIR (la plantilla imprimible, D-97, no está construida).
 * - Código de error: `TELEFONO_INVALIDO` (la sucursal lo expone como `TELEFONO_DE_SUCURSAL_INVALIDO`).
 * - Ejemplos válidos: "+54 11 4321-0000", "4321-0000 int. 2", "x". Inválidos: "" (vacío), "43\n21" (salto de línea), 41 caracteres.
 *
 * Los largos son lo que repite el CHECK `sucursal_telefono_ck` (0019); un test de integración compara los dos (`contacto-check.test.ts`).
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import { esUnaLineaSinControl, largoEnCaracteres } from "./una-linea";

/**
 * Teléfono de contacto: texto libre de una línea ("+54 11 4321-0000", "4321-0000 int. 2"), sin formato fijo y UNO solo.
 * Solo nace de `telefonoDesdeTexto`. Es una primitiva y no del dominio de la sucursal porque lo usan también clientes y
 * proveedores: dos reglas de teléfono serían dos CHECK distintos para el mismo dato.
 *
 * El tope es un SUPUESTO del ingeniero (sin fuente del dueño): lo repite el CHECK `sucursal_telefono_ck` (0019) y un test
 * de integración prueba el borde en las dos puntas. Cambiarlo es cambiar acá y un CHECK nuevo en cada tabla que lo guarde.
 */
export type Telefono = Marca<string, "Telefono">;

export const LARGO_MAXIMO_DEL_TELEFONO = 40;

/** Sin espacios en los extremos, de 1 a 40 caracteres y sin caracteres de control. Un texto en blanco no es un teléfono. */
export function telefonoDesdeTexto(texto: string): Resultado<Telefono, "TELEFONO_INVALIDO"> {
  const limpio = texto.trim();
  if (
    limpio === "" ||
    largoEnCaracteres(limpio) > LARGO_MAXIMO_DEL_TELEFONO ||
    !esUnaLineaSinControl(limpio)
  ) {
    return err("TELEFONO_INVALIDO");
  }
  return ok(limpio as Telefono);
}
