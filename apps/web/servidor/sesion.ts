import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hostDelPedido, type PuertaResuelta } from "../../../src/capacidades/experiencia/puerta";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  resolverEmpresa,
  type DependenciasDeSesion,
  type EntradaALaEmpresa,
} from "../../../src/composicion/sesion-y-empresa";
import { marcaComercialId } from "../../../src/primitivas/identificadores/marca";
import type { SesionAutenticada } from "../../../src/puertos/autenticacion";
import { web } from "./composicion";
import { COOKIE_DE_EMPRESA } from "./cookies";
import { exigirPuerta } from "./pedido";

/**
 * Lo que las páginas y las acciones de la aplicación saben de «quién es y en qué empresa trabaja» (armazón
 * web §3.2, pasos 6 a 10). Es el único lugar de `apps/web` que arma `DependenciasDeSesion`; la lógica está
 * en `src/composicion/sesion-y-empresa.ts`, donde se prueba con la base real.
 */
export const dependenciasDeSesion: DependenciasDeSesion = {
  autenticacion: web.autenticacion,
  consultasDeSesion: web.consultasDeSesion,
  casosDeUsoDeIdentidad: web.casosDeUsoDeIdentidad,
  consultasDeEmpresas: web.consultasDeEmpresas,
  ahora: () => new Date(),
  // El detalle de lo inesperado va al registro del servidor (los registros de Vercel), nunca a la pantalla.
  respuesta: {
    registrar: (detalle) => {
      console.error(`[web] ${detalle}`);
    },
  },
};

export type SesionDelPedido = Readonly<{
  puerta: PuertaResuelta;
  /** `null`: sin cookie, cookie vencida o de otro host (G4). */
  sesion: SesionAutenticada | null;
}>;

/**
 * La puerta y la sesión DE ESTE host. Una cookie copiada de otra marca no vale acá: `sesionDe` la rechaza
 * porque la sesión recuerda el host donde nació (P-6). Se calcula una vez por pedido (`cache`).
 */
export const sesionDelPedido = cache(async (): Promise<SesionDelPedido> => {
  const puerta = await exigirPuerta("APP");
  const encabezados = await headers();
  const sesion = await dependenciasDeSesion
    .autenticacion()
    .sesionDe({ headers: encabezados }, puerta.host);
  return { puerta, sesion };
});

/** Sin sesión, a ingresar (volviendo al inicio). Cada página lo llama: un layout no se vuelve a correr al navegar. */
export async function exigirSesion(): Promise<
  Readonly<{ puerta: PuertaResuelta; sesion: SesionAutenticada }>
> {
  const { puerta, sesion } = await sesionDelPedido();
  if (sesion === null) redirect("/ingreso");
  return { puerta, sesion };
}

export type EmpresaDelPedido = Readonly<{
  puerta: PuertaResuelta;
  sesion: SesionAutenticada;
  /** Lo que se puede mostrar; los errores van por el traductor único (ADR-016). */
  entrada: Respuesta<EntradaALaEmpresa>;
}>;

/**
 * A qué empresa entra la persona en este pedido: sesión + marca del host + cookie `zh_empresa` validada.
 * Una cookie de otra marca o de una empresa que ya no es suya da `SIN_PERMISO`.
 */
export const empresaDelPedido = cache(async (): Promise<EmpresaDelPedido> => {
  const { puerta, sesion } = await exigirSesion();
  const cookieDeEmpresa = (await cookies()).get(COOKIE_DE_EMPRESA)?.value ?? null;
  const entrada = await resolverEmpresa(dependenciasDeSesion, {
    sesion,
    marcaId: marcaComercialId(puerta.marcaId),
    cookieDeEmpresa,
  });
  return { puerta, sesion, entrada };
});

/** El host del pedido tal como llegó (para comparar con el `Origin`); distinto del host normalizado de la puerta. */
export async function hostCrudoDelPedido(): Promise<string> {
  return hostDelPedido(await headers());
}
