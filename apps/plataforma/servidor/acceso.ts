import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { CodigoDePlataforma } from "../../../src/capacidades/autenticacion/codigos-de-plataforma";
import type { AccesoDeConsola } from "../../../src/composicion/puerta-de-consola";
import type { Resultado } from "../../../src/primitivas/resultado/resultado";
import { destinoSinAcceso } from "../logica/ingreso";
import { consola } from "./consola";

/**
 * Lo que las páginas de la consola saben de «quién es» (h5-p8 §7). Cada pedido lee la sesión de ESTE host
 * (`hostDeLaConsola()`, nunca el encabezado `Host`) y se la pasa a la puerta, que arma el acceso o dice por qué no.
 * El acceso no se guarda entre pedidos. Una página no puede fijar cookies: la renovación de la sesión la hace
 * `GET /api/auth/get-session`, que dispara el aviso de vencimiento.
 */
export const accesoDelPedido = cache(
  async (): Promise<Resultado<AccesoDeConsola, CodigoDePlataforma>> => {
    const sesion = await consola
      .autenticacion()
      .sesionDe({ headers: await headers() }, consola.hostDeLaConsola());
    return consola.puerta().conSesion(sesion);
  },
);

/** Sin acceso, a donde corresponda: ingresar, verificar el código o enrolar el segundo factor. */
export async function exigirAcceso(): Promise<AccesoDeConsola> {
  const resultado = await accesoDelPedido();
  if (!resultado.ok) redirect(destinoSinAcceso(resultado.error));
  return resultado.valor;
}

/**
 * Las pantallas del ingreso (`/ingreso/codigo`, `/ingreso/alta`) solo se ven en su paso: con acceso completo se va
 * a la consola, y en cualquier otro paso a la pantalla que corresponde. Así nadie ve el alta del segundo factor
 * si ya lo tiene, ni la verificación sin haber pasado por Google.
 */
export async function exigirPasoDeIngreso(
  paso: "segundo_factor_requerido" | "segundo_factor_a_enrolar",
): Promise<void> {
  const resultado = await accesoDelPedido();
  if (resultado.ok) redirect("/");
  if (resultado.error !== paso) redirect(destinoSinAcceso(resultado.error));
}

/** El ingreso: con acceso, a la consola; a mitad de camino (segundo factor), a su pantalla; si no, se queda. */
export async function resolverIngreso(): Promise<void> {
  const resultado = await accesoDelPedido();
  if (resultado.ok) redirect("/");
  if (
    resultado.error === "segundo_factor_requerido" ||
    resultado.error === "segundo_factor_a_enrolar"
  ) {
    redirect(destinoSinAcceso(resultado.error));
  }
}
