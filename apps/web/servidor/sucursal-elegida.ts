import "server-only";
import { cookies } from "next/headers";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { resolverSucursal } from "../../../src/capacidades/permisos/alcance";
import { aRespuesta } from "../../../src/composicion/a-respuesta";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { SucursalId } from "../../../src/primitivas/identificadores/marca";
import { web } from "./composicion";
import { COOKIE_DE_SUCURSAL } from "./cookies";
import { dependenciasDeSesion } from "./sesion";

/**
 * La sucursal con la que la persona mira el listado del facturador (D-34): vive en el servidor (una cookie que el servidor valida en
 * cada pedido, como `pd_empresa`) y no en el navegador. Lo que dice la cookie es solo lo que la persona DICE haber elegido: acá se
 * contrasta con las sucursales que su alcance deja elegir (`sucursalesElegibles`, abiertas y cerradas), y la consulta la verifica
 * otra vez dentro de su transacción. Nunca se trabaja con «todas».
 */

/** Una sucursal que la persona puede elegir: el id, el nombre y si está abierta. */
export type SucursalParaElegir = Readonly<{ id: SucursalId; nombre: string; activa: boolean }>;

/** Las sucursales que el alcance de la persona deja elegir, por nombre. */
export async function sucursalesParaElegir(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly SucursalParaElegir[]>> {
  const lista = await web.consultasDeEmpresas().sucursalesElegibles(contexto);
  return aRespuesta(lista, dependenciasDeSesion.respuesta, (sucursales) =>
    sucursales.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa })),
  );
}

/**
 * Las sucursales ABIERTAS que la persona puede elegir: las del alta de un punto de venta (respuesta del dueño, 2026-10-29: una
 * sucursal cerrada no se ofrece para uno nuevo). El filtro vive en el servidor: al formulario nunca llega una cerrada. Previene:
 * crear un punto de venta en una sucursal que ya cerró. Chequeo: `test/web/sucursal-elegida.test.ts`.
 */
export async function sucursalesAbiertasParaElegir(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly SucursalParaElegir[]>> {
  const lista = await sucursalesParaElegir(contexto);
  return lista.ok ? { ok: true, dato: lista.dato.filter((s) => s.activa) } : lista;
}

/** La elegida de la cookie si sigue siendo una de las que la persona puede elegir; si no (vieja, de otra empresa, ajena), `null`. */
export function elegidaEntre(
  guardada: string | null,
  elegibles: readonly SucursalParaElegir[],
): SucursalId | null {
  if (guardada === null || guardada === "") return null;
  return elegibles.find((s) => s.id === guardada)?.id ?? null;
}

export type SucursalDelPedido = Readonly<{
  elegibles: readonly SucursalParaElegir[];
  /** Lo que la persona eligió y sigue valiendo; `null` si no eligió o ya no vale. Es lo que se le pasa al servidor. */
  elegida: SucursalId | null;
  /** La sucursal con la que trabaja el listado: la elegida, o la única abierta que se toma sola (D-36); `""` si ninguna. */
  efectiva: string;
}>;

export async function sucursalDelPedido(
  contexto: ContextoOperativo,
): Promise<Respuesta<SucursalDelPedido>> {
  const lista = await sucursalesParaElegir(contexto);
  if (!lista.ok) return lista;
  const guardada = (await cookies()).get(COOKIE_DE_SUCURSAL)?.value ?? null;
  const elegida = elegidaEntre(guardada, lista.dato);
  // La misma regla que aplica la consulta, para mostrar cuál es (la consulta es la que decide).
  const efectiva = resolverSucursal(elegida, lista.dato);
  return {
    ok: true,
    dato: { elegibles: lista.dato, elegida, efectiva: efectiva.ok ? efectiva.valor : "" },
  };
}
