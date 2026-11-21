import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarElDeposito,
  listarLosDepositos,
  USOS_DE_DEPOSITO,
  type DependenciasDeDepositosWeb,
  type DepositosParaLaPantalla,
} from "../../../src/composicion/depositos-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_DEPOSITOS } from "../ui/plantillas/stock/depositos/modelo-de-depositos";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * «Depósitos» de stock: la lectura de la lista y la acción de agregar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa y llaman a `src/composicion/depositos-web.ts`.
 * La sucursal la fija el SERVIDOR (`laSucursalDeStock`), nunca el navegador. El permiso, el nombre repetido y el «de venta» único los decide el servidor dentro de la transacción: la
 * pantalla no replica ninguna regla. Repetir: el `id` lo genera la página al abrir el formulario y viaja ligado a la acción; el mismo `id` con el mismo contenido no duplica.
 */

const dependencias: DependenciasDeDepositosWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los depósitos de la sucursal elegida, también los desactivados. */
export async function cargarLosDepositos(
  contexto: ContextoOperativo,
): Promise<Respuesta<DepositosParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return listarLosDepositos(dependencias, contexto, sucursal.dato);
}

export async function agregarElDepositoDeLaSucursal(
  id: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return agregarElDeposito(dependencias, contexto, sucursal.dato, {
        id,
        nombre: textoDe(datos, "nombre"),
        uso: textoDe(datos, "uso"),
        deVenta: datos.get("deVenta") === "on",
      });
    }),
    RUTAS_DE_DEPOSITOS.lista,
  );
}

/** Los usos que se ofrecen al agregar un depósito: los del servidor (una regla, un lugar), para que la página no importe la composición. */
export const USOS_PARA_ELEGIR: readonly string[] = USOS_DE_DEPOSITO;
