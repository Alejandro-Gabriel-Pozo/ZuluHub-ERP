import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { respuestaGenericaDeVentas } from "../../../src/composicion/errores-de-ventas";
import {
  cargarVentaRapida,
  cotizarElCarrito,
  type CarritoCotizado,
  type DependenciasDeVentaRapidaWeb,
  type VentaRapidaParaLaPantalla,
} from "../../../src/composicion/venta-rapida-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * VENTA RÁPIDA del mostrador: la carga de lo que se ofrece y la cotización del carrito. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa y llaman a
 * `src/composicion/venta-rapida-web.ts`, donde se prueba el resto. La sucursal la fija el SERVIDOR: es la elegida en este dispositivo (cookie validada contra las que la persona puede
 * elegir, `sucursalDelPedido`), nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). El permiso, el alcance y el precio los decide el servidor dentro de su
 * transacción: la pantalla no replica ninguna regla ni calcula ningún total. Ambas son lecturas: no escriben, no hay nada que repetir con cuidado.
 */

const dependencias: DependenciasDeVentaRapidaWeb = {
  consultasDeCatalogo: web.consultasDeCatalogo,
  consultasDeVentas: web.consultasDeVentas,
  respuesta: dependenciasDeSesion.respuesta,
};

/** La sucursal con la que trabaja la persona, o el genérico si no hay ninguna. */
async function laSucursal(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  return sucursal.dato.efectiva === ""
    ? respuestaGenericaDeVentas()
    : { ok: true, dato: sucursal.dato.efectiva };
}

/** Lo que se ofrece en la sucursal elegida: secciones, productos con su precio, medidas, opciones y recargos. */
export async function cargarLaVentaRapida(
  contexto: ContextoOperativo,
): Promise<Respuesta<VentaRapidaParaLaPantalla>> {
  const sucursal = await laSucursal(contexto);
  if (!sucursal.ok) return sucursal;
  return cargarVentaRapida(dependencias, contexto, sucursal.dato);
}

/** El total del carrito (y el de cada línea) de la sucursal elegida, calculado por el servidor en cada cambio. */
export function cotizarElCarritoDeLaSucursal(crudo: unknown): Promise<Respuesta<CarritoCotizado>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return cotizarElCarrito(dependencias, contexto, sucursal.dato, crudo);
  });
}
