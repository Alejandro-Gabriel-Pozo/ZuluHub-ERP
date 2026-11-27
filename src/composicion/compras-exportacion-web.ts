import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { HojaDePlanilla } from "../primitivas/planilla/celda";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  armarCabecera,
  armarDetalle,
  armarPagos,
  armarResumen,
  type SalidaDeExportarCompras,
} from "../modulos/compras/publico";
import type { EscritorDePlanilla } from "../puertos/escritor-de-planilla";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeExportarCompras } from "./entradas-de-compras";
import { accionDeCompras } from "./errores-de-compras";
import {
  encabezadosDeCabecera,
  encabezadosDeDetalle,
  encabezadosDeResumen,
  encabezadosDePagos,
  hojasDeLaExportacion,
  nombreDelArchivoDeCompras,
  rotulosDeExportacion,
} from "./compras-exportacion-textos";
import type { Web } from "./web";

/**
 * La exportación de compras a Excel para la ruta de descarga (dueño, 25/11/2026). Junta el caso de uso (que lee todo en una transacción, audita y devuelve las compras) con lo que
 * necesita el archivo: los correos de quien cargó cada compra (identidad; sin permiso para ver personas la celda sale vacía y no se inventa un nombre), los textos del catálogo y el
 * escritor de la planilla. Los errores salen como el genérico (`errores-de-compras.ts`). Nunca devuelve un archivo a medias: o sale entero o sale el error.
 */

export type DependenciasDeExportacionWeb = Readonly<{
  casos: () => Pick<ReturnType<Web["casosDeUsoDeCompras"]>, "exportarCompras">;
  consultasDeIdentidad: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  escritor: EscritorDePlanilla;
  respuesta: DependenciasDeRespuesta;
}>;

export type ArchivoDeCompras = Readonly<{ nombre: string; contenido: Uint8Array }>;

const MOTIVOS_DE_RECHAZO: ReadonlySet<string> = new Set([
  "MODULO_EN_DESARROLLO",
  "MODULO_NO_ACTIVO",
  "MODULO_EN_SOLO_LECTURA",
  "SIN_CAPACIDAD",
  "SIN_PERMISO",
]);
/** Cuántos ids acepta `personasParaMostrar` por pedido (su tope). */
const PERSONAS_POR_PEDIDO = 200;

async function correosDe(
  d: DependenciasDeExportacionWeb,
  contexto: ContextoOperativo,
  ids: readonly string[],
): Promise<Resultado<ReadonlyMap<string, string>, unknown>> {
  const correos = new Map<string, string>();
  for (let i = 0; i < ids.length; i += PERSONAS_POR_PEDIDO) {
    const r = await d
      .consultasDeIdentidad()
      .personasParaMostrar(contexto, { ids: ids.slice(i, i + PERSONAS_POR_PEDIDO) });
    if (!r.ok) {
      // Sin permiso para ver personas, las celdas salen vacías; cualquier otro fallo (base, entrada) no se esconde.
      if (typeof r.error === "string" && MOTIVOS_DE_RECHAZO.has(r.error)) return ok(new Map());
      return err(r.error);
    }
    for (const [id, correo] of r.valor) correos.set(id, correo);
  }
  return ok(correos);
}

function hojasDe(
  salida: SalidaDeExportarCompras,
  correos: ReadonlyMap<string, string>,
): readonly HojaDePlanilla[] {
  const rotulos = rotulosDeExportacion();
  const nombres = hojasDeLaExportacion();
  const cabecera = armarCabecera(salida.compras, correos, rotulos);
  const detalle = armarDetalle(salida.compras, rotulos);
  const resumen = armarResumen(salida.compras);
  const pagos = armarPagos(salida.compras, rotulos);
  return [
    {
      nombre: nombres.cabecera,
      encabezados: encabezadosDeCabecera(cabecera.columnas),
      filas: cabecera.filas,
    },
    {
      nombre: nombres.detalle,
      encabezados: encabezadosDeDetalle(detalle.columnas),
      filas: detalle.filas,
    },
    {
      nombre: nombres.resumen,
      encabezados: encabezadosDeResumen(resumen.columnas),
      filas: resumen.filas,
    },
    {
      nombre: nombres.pagos,
      encabezados: encabezadosDePagos(pagos.columnas),
      filas: pagos.filas,
    },
  ];
}

/** El archivo de compras del período que pide la dirección (`desde` y `hasta`, las dos obligatorias); lo no permitido es un pedido inválido (el genérico). */
export function exportarLasCompras(
  d: DependenciasDeExportacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ArchivoDeCompras>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeExportarCompras,
    async (entrada) => {
      const r = await d.casos().exportarCompras(contexto, entrada);
      if (!r.ok) return r;
      const registradores = [
        ...new Set(r.valor.compras.filter((c) => c.enCabecera).map((c) => c.registradoPor)),
      ];
      const correos = await correosDe(d, contexto, registradores);
      if (!correos.ok) return correos;
      return ok({
        salida: r.valor,
        contenido: await d.escritor.escribir(hojasDe(r.valor, correos.valor)),
      });
    },
    ({ salida, contenido }) => ({
      nombre: nombreDelArchivoDeCompras(salida.desde, salida.hasta),
      contenido,
    }),
  );
}
