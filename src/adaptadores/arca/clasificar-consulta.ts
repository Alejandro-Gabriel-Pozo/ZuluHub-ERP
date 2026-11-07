import type { DatosConsultados, ResultadoDeConsulta } from "../../modulos/fiscal/publico";
import { alicuotaDeId } from "./codigos";
import {
  codigoDeArca,
  enteroDeArca,
  fechaDeArca,
  FORMA_DEL_CAE,
  importeDeArca,
} from "./conversiones-de-arca";
import { cuerpoDe, RESPUESTA_ILEGIBLE } from "./cuerpo-de-respuesta";
import { codigosComoTexto, soloSinDatos } from "./errores-de-arca";
import {
  leerConsulta,
  type AlicuotaLeida,
  type AsociadoLeido,
  type ComprobanteConsultadoLeido,
} from "./leer-respuestas";
import type { RespuestaDeTransporte } from "./tipos";

/** Clasificación de la respuesta de `FECompConsultar` (la regla general está en `clasificar.ts`). */

/** Lo que se consultó: la respuesta tiene que ser de ESE número, y una nota tiene que traer su asociado. */
export type EsperadoDeConsulta = Readonly<{
  /** La CUIT del emisor: es la del comprobante asociado de una nota (una nota no asocia otro emisor). */
  cuit: string;
  puntoDeVenta: number;
  tipoDeComprobante: number;
  numero: bigint;
  esNota: boolean;
}>;

const consultaFallida = (detalle: string): ResultadoDeConsulta => ({
  tipo: "CONSULTA_FALLIDA",
  detalle,
});

/** Falta o no se entiende un campo de lo registrado: no se sabe qué tiene ARCA, se reintenta. */
const campoInvalido = (campo: string): ResultadoDeConsulta =>
  consultaFallida(`la respuesta de ARCA no trae un ${campo} válido`);

function alicuotasConsultadas(
  leidas: readonly AlicuotaLeida[],
): DatosConsultados["alicuotas"] | string {
  const alicuotas: DatosConsultados["alicuotas"][number][] = [];
  for (const leida of leidas) {
    const alicuota = alicuotaDeId(leida.id);
    const base = importeDeArca(leida.base);
    const iva = importeDeArca(leida.importe);
    if (alicuota === null || base === null || iva === null) return "Iva";
    alicuotas.push({ alicuota, base, iva });
  }
  return alicuotas;
}

function asociadoConsultado(
  leidos: readonly AsociadoLeido[],
  esperado: EsperadoDeConsulta,
): DatosConsultados["asociado"] | string {
  const [leido] = leidos;
  if (leido === undefined) return esperado.esNota ? "CbtesAsoc" : null;
  const tipo = codigoDeArca(leido.tipoDeComprobante, 3);
  const puntoDeVenta = codigoDeArca(leido.puntoDeVenta, 5);
  const numero = enteroDeArca(leido.numero, 8);
  // ARCA puede no repetir la CUIT: una nota solo asocia comprobantes de su propio emisor (§B.3.5).
  const cuit = leido.cuit === "" ? esperado.cuit : leido.cuit;
  const fecha = fechaDeArca(leido.fecha);
  if (
    leidos.length > 1 ||
    tipo === null ||
    puntoDeVenta === null ||
    numero === null ||
    !/^[0-9]{11}$/.test(cuit) ||
    fecha === null
  ) {
    return "CbtesAsoc";
  }
  return { tipoDeComprobante: tipo, puntoDeVenta, numero, cuit, fecha };
}

/** Lo registrado en ARCA como `DatosConsultados`, o el nombre del primer campo que no sirve. */
function datosConsultados(
  c: ComprobanteConsultadoLeido,
  esperado: EsperadoDeConsulta,
): DatosConsultados | string {
  const puntoDeVenta = codigoDeArca(c.puntoDeVenta, 5);
  const tipoDeComprobante = codigoDeArca(c.tipoDeComprobante, 3);
  const numero = enteroDeArca(c.desde, 8);
  const hasta = enteroDeArca(c.hasta, 8);
  const fecha = fechaDeArca(c.fecha);
  const tipoDeDocumento = codigoDeArca(c.tipoDeDocumento, 2);
  const numeroDeDocumento = enteroDeArca(c.numeroDeDocumento, 11);
  const total = importeDeArca(c.total);
  const neto = importeDeArca(c.neto);
  const iva = importeDeArca(c.iva);
  if (puntoDeVenta !== esperado.puntoDeVenta) return "PtoVta";
  if (tipoDeComprobante !== esperado.tipoDeComprobante) return "CbteTipo";
  if (numero !== esperado.numero || hasta !== esperado.numero) return "CbteDesde";
  if (fecha === null) return "CbteFch";
  if (tipoDeDocumento === null) return "DocTipo";
  if (numeroDeDocumento === null) return "DocNro";
  if (!/^[A-Z0-9]{3}$/.test(c.moneda)) return "MonId";
  if (total === null) return "ImpTotal";
  if (neto === null) return "ImpNeto";
  if (iva === null) return "ImpIVA";
  const alicuotas = alicuotasConsultadas(c.alicuotas);
  if (typeof alicuotas === "string") return alicuotas;
  const asociado = asociadoConsultado(c.asociados, esperado);
  if (typeof asociado === "string") return asociado;
  return {
    tipoDeComprobante,
    puntoDeVenta,
    numero,
    fecha,
    tipoDeDocumento,
    numeroDeDocumento,
    moneda: c.moneda,
    total,
    neto,
    iva,
    alicuotas,
    asociado,
  };
}

/**
 * Lo que ARCA tiene de un número. `NO_ENCONTRADO` es solo el 602 (y solo el 602): un 601, un 500 o
 * cualquier otra falla es `CONSULTA_FALLIDA`, que se reintenta. Un registro que no es de ese número, que no
 * es `A` o cuyo CAE no tiene 14 dígitos tampoco se da por encontrado.
 */
export function clasificarConsulta(
  respuesta: RespuestaDeTransporte,
  esperado: EsperadoDeConsulta,
): ResultadoDeConsulta {
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) return consultaFallida(cuerpo.motivo);
  const leida = leerConsulta(cuerpo.cuerpo);
  if (leida === null) return consultaFallida(RESPUESTA_ILEGIBLE);
  const { errores, comprobante } = leida;
  if (comprobante === null) {
    if (soloSinDatos(errores)) return { tipo: "NO_ENCONTRADO" };
    return consultaFallida(
      errores.length === 0
        ? "ARCA respondió sin datos ni errores"
        : `ARCA respondió con errores (${codigosComoTexto(errores)})`,
    );
  }
  const datos = datosConsultados(comprobante, esperado);
  if (typeof datos === "string") return campoInvalido(datos);
  const vence = fechaDeArca(comprobante.vencimiento);
  if (comprobante.resultado !== "A") return campoInvalido("Resultado");
  if (!FORMA_DEL_CAE.test(comprobante.codigo)) {
    return campoInvalido("CodAutorizacion");
  }
  if (vence === null) return campoInvalido("FchVto");
  return { tipo: "ENCONTRADO", datos, codigo: comprobante.codigo, vence };
}
