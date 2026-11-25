import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";
import { nombreDePresentacionDesdeTexto as nombreCanonico } from "../../../primitivas/texto/nombre-de-presentacion";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";

/** Una cantidad MAYOR que cero, o `null` si el texto no es un decimal canónico de hasta 4 decimales. */
function cantidadPositiva(texto: string): Cantidad | null {
  try {
    const cantidad = cantidadDesdeTexto(texto);
    return cantidad.unidades > 0n ? cantidad : null;
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

/**
 * Una presentación de compra (E9 §3.2; D131): «caja de 12», «bolsa 25 kg», «pieza ≈ 4 kg». La cantidad está en la unidad BASE del producto y no cambia
 * nunca («otra cantidad es otra presentación»); con peso variable es solo el peso aproximado, para pedir y estimar (nunca entra a la cuenta: `calcularLinea`
 * usa el peso real). El nombre es único por producto sin distinguir mayúsculas (su clave). Pura: sin reloj ni azar. Los mismos límites los repite la base
 * (`presentacion_nombre_ck`, `presentacion_cantidad_ck`); el largo del nombre vive en su primitiva (`nombre-de-presentacion.ts`) y los compara una prueba de integración.
 */
export type DatosDePresentacion = Readonly<{
  nombre: string;
  nombreClave: string;
  /** Texto decimal de 4 decimales. */
  cantidad: string;
  dePesoVariable: boolean;
}>;

export type ErrorDePresentacion = "NOMBRE_INVALIDO" | "CANTIDAD_INVALIDA";

export function nombreDePresentacionDesdeTexto(
  texto: string,
): Resultado<Readonly<{ nombre: string; nombreClave: string }>, "NOMBRE_INVALIDO"> {
  const nombre = nombreCanonico(texto);
  if (!nombre.ok) return err("NOMBRE_INVALIDO");
  return ok({ nombre: nombre.valor, nombreClave: claveDeNombre(nombre.valor) });
}

export function datosDePresentacion(
  entrada: Readonly<{ nombre: string; cantidad: string; dePesoVariable: boolean }>,
): Resultado<DatosDePresentacion, ErrorDePresentacion> {
  const nombre = nombreDePresentacionDesdeTexto(entrada.nombre);
  if (!nombre.ok) return nombre;
  const cantidad = cantidadPositiva(entrada.cantidad);
  if (cantidad === null) return err("CANTIDAD_INVALIDA");
  return ok({
    nombre: nombre.valor.nombre,
    nombreClave: nombre.valor.nombreClave,
    cantidad: cantidadATexto(cantidad),
    dePesoVariable: entrada.dePesoVariable,
  });
}
