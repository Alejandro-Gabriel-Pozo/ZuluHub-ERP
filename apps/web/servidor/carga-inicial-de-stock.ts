import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  opcionesParaLaCargaInicial,
  registrarLaCargaInicial,
  type DependenciasDeCargaInicialWeb,
  type OpcionesDeCargaInicial,
} from "../../../src/composicion/carga-inicial-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { MAXIMO_DE_RENGLONES } from "../../../src/modulos/stock/publico";
import { RUTAS_DE_STOCK } from "../ui/plantillas/stock/rutas-de-stock";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * La carga inicial del stock en tanda de la web: la lectura de lo que ofrece la grilla y la acción que la registra. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúan (`laSucursalDeStock`: la elegida
 * en el dispositivo, nunca la del navegador) y llaman a `src/composicion/carga-inicial-web.ts`. La clave de idempotencia la genera la página al abrir la grilla y viaja ligada a la acción (`bind`). El permiso
 * (`stock.registrar_entrada` y además `stock.ajustar`), la cantidad, el costo y la fecha («de hoy») los decide el servidor dentro de su transacción. Si sale bien vuelve a Existencias.
 */

const dependencias: DependenciasDeCargaInicialWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

export async function cargarLasOpcionesDeLaCargaInicial(
  contexto: ContextoOperativo,
): Promise<Respuesta<OpcionesDeCargaInicial>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return opcionesParaLaCargaInicial(dependencias, contexto, sucursal.dato);
}

/**
 * Los renglones de la grilla tal como los manda el formulario: `articuloId.0`, `cantidad.0`, `costoUnitario.0`, `articuloId.1`… por posición. Se lee de a una fila hasta que falta el artículo, con un tope de un
 * renglón MÁS que el máximo para que la composición lo rechace (nunca se recorre sin límite). Un campo ausente es texto vacío; la forma y los valores los valida la composición y el servidor.
 */
function renglonesDe(datos: FormData): readonly Record<string, string>[] {
  const renglones: Record<string, string>[] = [];
  for (let i = 0; i <= MAXIMO_DE_RENGLONES; i++) {
    if (!datos.has(`articuloId.${i}`)) break;
    renglones.push({
      articuloId: textoDe(datos, `articuloId.${i}`),
      cantidad: textoDe(datos, `cantidad.${i}`),
      costoUnitario: textoDe(datos, `costoUnitario.${i}`),
    });
  }
  return renglones;
}

export async function registrarLaCargaInicialDeLaSucursal(
  clave: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return registrarLaCargaInicial(dependencias, contexto, sucursal.dato, {
        clave,
        depositoId: textoDe(datos, "depositoId"),
        renglones: renglonesDe(datos),
        confirmar: textoDe(datos, "confirmar"),
      });
    }),
    RUTAS_DE_STOCK.existencias,
  );
}
