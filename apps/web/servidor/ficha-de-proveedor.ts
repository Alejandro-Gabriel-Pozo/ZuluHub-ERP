import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarUnComprobante,
  agregarUnPuntoDeVenta,
  dejarDeUsarUnComprobante,
  dejarDeUsarUnPuntoDeVenta,
  pedirUnComprobante,
  pedirUnPuntoDeVenta,
  resolverUnPedido,
  verLaFichaDelProveedor,
  type DependenciasDeFichaDeProveedorWeb,
  type FichaDelProveedorParaLaPantalla,
} from "../../../src/composicion/ficha-de-proveedor-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ResultadoDeFichaDeProveedor } from "../ui/plantillas/compras/proveedor/resultado-de-proveedor";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * La ficha del proveedor de compras (Compras PR 4): la lectura para las páginas y las acciones de editar y pedir. Finas a propósito (ADR-015, punto 2): la empresa y quién actúa salen de la SESIÓN, nunca
 * del formulario ni de la dirección; el proveedor, el pedido y el número o el tipo se ligan con `.bind` en la página (Next los cifra). El permiso de cada acción (`proveedores.editar_ficha` o
 * `proveedores.pedir_ficha`) lo decide el servidor dentro de su transacción en `src/composicion/ficha-de-proveedor-web.ts`. Ninguna redirige: devuelven el resultado y la pantalla vuelve a cargar.
 * Leer NO escribe.
 */

const dependencias: DependenciasDeFichaDeProveedorWeb = {
  consultas: web.consultasDeCompras,
  consultasDeClientes: web.consultasDeClientes,
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

export type { FichaDelProveedorParaLaPantalla };

/** La ficha de un proveedor de la empresa de la sesión, por el id de la dirección (que se valida de nuevo en la composición). */
export function cargarLaFichaDelProveedor(
  contexto: ContextoOperativo,
  parteId: string,
): Promise<Respuesta<FichaDelProveedorParaLaPantalla>> {
  return verLaFichaDelProveedor(dependencias, contexto, parteId);
}

const terminar = (respuesta: Respuesta<unknown>): ResultadoDeFichaDeProveedor =>
  respuesta.ok ? { estado: "HECHO" } : { estado: "ERROR", error: respuesta.error };

export async function agregarPuntoDeVentaDeLaFicha(
  parteId: string,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) =>
      agregarUnPuntoDeVenta(dependencias, c, { parteId, numero: numeroDe(datos) }),
    ),
  );
}

export async function pedirPuntoDeVentaDeLaFicha(
  parteId: string,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) =>
      pedirUnPuntoDeVenta(dependencias, c, { parteId, numero: numeroDe(datos) }),
    ),
  );
}

export async function dejarDeUsarPuntoDeVentaDeLaFicha(
  parteId: string,
  numero: number,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) => dejarDeUsarUnPuntoDeVenta(dependencias, c, { parteId, numero })),
  );
}

export async function agregarComprobanteDeLaFicha(
  parteId: string,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) =>
      agregarUnComprobante(dependencias, c, { parteId, tipo: textoDe(datos, "tipo") }),
    ),
  );
}

export async function pedirComprobanteDeLaFicha(
  parteId: string,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) =>
      pedirUnComprobante(dependencias, c, { parteId, tipo: textoDe(datos, "tipo") }),
    ),
  );
}

export async function dejarDeUsarComprobanteDeLaFicha(
  parteId: string,
  tipo: string,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) => dejarDeUsarUnComprobante(dependencias, c, { parteId, tipo })),
  );
}

export async function resolverPedidoDeLaFicha(
  pedidoId: string,
  decision: string,
): Promise<ResultadoDeFichaDeProveedor> {
  return terminar(
    await conLaEmpresa((c) => resolverUnPedido(dependencias, c, { pedidoId, decision })),
  );
}

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/** El número del punto de venta como lo manda el campo (texto de dígitos); lo que no es un entero sale como `NaN` y la frontera lo rechaza. */
const numeroDe = (datos: FormData): number => {
  const texto = textoDe(datos, "numero");
  return /^\d{1,10}$/.test(texto) ? Number(texto) : Number.NaN;
};
