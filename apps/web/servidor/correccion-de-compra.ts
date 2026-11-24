import "server-only";
import {
  anularLaCompra,
  corregirLaCompra,
  type DependenciasDeCorreccionDeCompraWeb,
} from "../../../src/composicion/correccion-de-compra-web";
import { rutaDeLaCompra } from "../ui/plantillas/compras/rutas-de-compras";
import type {
  ResultadoDeAnular,
  ResultadoDeCorregir,
} from "../ui/plantillas/compras/correccion/resultado-de-correccion";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Corregir» una línea y «Anular» una compra (Compras PR 10). Finas a propósito (ADR-015, punto 2): la empresa y quién actúa salen de la SESIÓN, nunca del formulario ni de la dirección, y todo lo demás (el
 * permiso, el alcance de sucursal, la versión, la repetición) lo decide el servidor dentro de su transacción en `src/composicion/correccion-de-compra-web.ts`. Ninguna redirige (un `redirect` dentro de
 * una acción pierde el host): devuelven el resultado y la pantalla navega.
 */

const dependencias: DependenciasDeCorreccionDeCompraWeb = {
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

/** La clave de UN intento de corregir: la fija la página al abrirse. Previene: que un doble toque o un reintento por red cortada corrijan dos veces. */
export const nuevaClaveDeCorreccion = (): string => crypto.randomUUID();

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/** El precio y el motivo salen del formulario; la compra, la línea, las correcciones que se vieron y la clave las liga la página con `.bind` (no viajan en un campo). */
export async function corregirLaLineaDeLaCompra(
  recepcionId: string,
  linea: number,
  correccionesVistas: number,
  clave: string,
  datos: FormData,
): Promise<ResultadoDeCorregir> {
  const r = await conLaEmpresa((contexto) =>
    corregirLaCompra(dependencias, contexto, {
      clave,
      recepcionId,
      linea,
      correccionesVistas,
      precio: textoDe(datos, "precio"),
      motivo: textoDe(datos, "motivo"),
    }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaCompra(recepcionId) }
    : { estado: "ERROR", error: r.error };
}

/** Anular la compra con el motivo del formulario; la compra la liga la página con `.bind`. */
export async function anularLaCompraDeLaPantalla(
  recepcionId: string,
  datos: FormData,
): Promise<ResultadoDeAnular> {
  // `conLaEmpresa` solo devuelve la respuesta: lo que se sabe de más (la compra ya consumida) se saca por una variable.
  let consumida = false;
  const r = await conLaEmpresa(async (contexto) => {
    const anulacion = await anularLaCompra(dependencias, contexto, {
      recepcionId,
      motivo: textoDe(datos, "motivo"),
    });
    consumida = anulacion.consumida;
    return anulacion.respuesta;
  });
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaCompra(recepcionId) }
    : { estado: "ERROR", error: r.error, consumida };
}
