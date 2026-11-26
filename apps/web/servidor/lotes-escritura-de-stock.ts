import "server-only";
import {
  controlarElLoteDelArticulo,
  corregirElLote,
  depositosParaReasignar,
  dejarDeControlarElLoteDelArticulo,
  reasignarEntreLotes,
  type DependenciasDeLotesEscrituraWeb,
} from "../../../src/composicion/lotes-escritura-web";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { hrefDeLotes } from "../ui/plantillas/stock/lotes/modelo-de-lotes";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * Las acciones de escritura de la pestaña «Lotes»: controlar por lote, dejar de controlar, corregir la fecha de vencimiento y reasignar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúan (la
 * sucursal es la elegida en el dispositivo, nunca la del navegador) y llaman a `src/composicion/lotes-escritura-web.ts`. El artículo, el lote, su versión y la clave de la reasignación viajan ligados a la acción
 * (`bind`), no como campos que la persona edite. El permiso, la perilla del plan, la idempotencia y toda cuenta los decide el servidor dentro de su transacción.
 */

const dependencias: DependenciasDeLotesEscrituraWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

export async function controlarElLoteDelArticuloDeLaPagina(
  articuloId: string,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      controlarElLoteDelArticulo(dependencias, contexto, { articuloId }),
    ),
    hrefDeLotes(articuloId),
  );
}

export async function dejarDeControlarElLoteDelArticuloDeLaPagina(
  articuloId: string,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      dejarDeControlarElLoteDelArticulo(dependencias, contexto, { articuloId }),
    ),
    hrefDeLotes(articuloId),
  );
}

/** Corrige la fecha de vencimiento con la versión que se vio; si sale bien vuelve a los lotes del artículo. */
export async function corregirElLoteDeLaPagina(
  articuloId: string,
  loteId: string,
  version: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      corregirElLote(dependencias, contexto, {
        loteId,
        version,
        vence: textoDe(datos, "vence"),
        detalle: textoDe(datos, "detalle"),
      }),
    ),
    hrefDeLotes(articuloId),
  );
}

/** Reasigna existencia del lote de origen (fijado por la página) a otro lote del artículo; si sale bien vuelve a los lotes del artículo. */
export async function reasignarElLoteDeLaPagina(
  clave: string,
  articuloId: string,
  loteOrigenId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return reasignarEntreLotes(dependencias, contexto, sucursal.dato, {
        clave,
        articuloId,
        depositoId: textoDe(datos, "depositoId"),
        loteOrigenId,
        loteDestinoId: textoDe(datos, "loteDestinoId"),
        cantidad: textoDe(datos, "cantidad"),
        detalle: textoDe(datos, "detalle"),
      });
    }),
    hrefDeLotes(articuloId),
  );
}

/** Los depósitos de la sucursal elegida en el dispositivo (nunca la del navegador), para la pantalla de Reasignar. */
export async function cargarLosDepositosParaReasignar(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly Readonly<{ id: string; nombre: string }>[]>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return depositosParaReasignar(dependencias, contexto, sucursal.dato);
}
