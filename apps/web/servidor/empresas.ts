import "server-only";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  empresasDeLaPersona,
  sucursalesDeLaEmpresa,
} from "../../../src/composicion/sesion-y-empresa";
import { marcaComercialId } from "../../../src/primitivas/identificadores/marca";
import { dependenciasDeSesion, exigirSesion } from "./sesion";

/**
 * Las empresas de la persona del pedido EN LA MARCA DE ESTE HOST (la pantalla «elegir empresa»). La marca sale
 * de la puerta, nunca de lo que mande el navegador; sin sesión, a ingresar.
 */
export async function empresasDelPedido() {
  const { puerta, sesion } = await exigirSesion();
  const empresas = await empresasDeLaPersona(
    dependenciasDeSesion,
    sesion,
    marcaComercialId(puerta.marcaId),
  );
  return { puerta, empresas };
}

/** Las sucursales activas de la empresa del contexto (para el selector de este dispositivo). */
export function sucursalesDelContexto(contexto: ContextoOperativo) {
  return sucursalesDeLaEmpresa(dependenciasDeSesion, contexto);
}
