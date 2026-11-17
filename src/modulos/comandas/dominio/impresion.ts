import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * LOS TRABAJOS DE IMPRESIÓN (E7 §3.2 y §3.10; PP-1: diálogo de impresión del sistema). El navegador no puede confirmar que salió el papel: «impresa» es
 * lo que DECLARÓ el dispositivo (S-13). El estado del trabajo es el resultado de su último intento. Un documento original tiene un solo trabajo
 * (la base lo impone); reintentar es el mismo trabajo con `intentos + 1`; cada copia es un trabajo nuevo. Listas cerradas, denegar por defecto.
 * Puro: sin reloj ni azar.
 */
export const ESTADOS_DE_TRABAJO = ["PENDIENTE", "IMPRESA", "FALLIDA"] as const;
export type EstadoDeTrabajo = (typeof ESTADOS_DE_TRABAJO)[number];

export const RESULTADOS_DE_INTENTO = ["IMPRESA", "FALLIDA"] as const;
export type ResultadoDeIntento = (typeof RESULTADOS_DE_INTENTO)[number];

export const USOS_DE_IMPRESORA = ["COMANDA", "TICKET"] as const;
export type UsoDeImpresora = (typeof USOS_DE_IMPRESORA)[number];

export const TIPOS_DE_DOCUMENTO = ["COMANDA", "ANULACION", "TICKET"] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const PAPELES_EN_MM = [58, 80] as const;
export type PapelEnMm = (typeof PAPELES_EN_MM)[number];

export type IntentoDeImpresion = Readonly<{ numero: number; resultado: ResultadoDeIntento }>;

/** Sin intentos: `PENDIENTE`; con intentos: el resultado del de mayor número (no importa en qué orden lleguen). */
export function estadoDelTrabajo(intentos: readonly IntentoDeImpresion[]): EstadoDeTrabajo {
  let ultimo: IntentoDeImpresion | null = null;
  for (const i of intentos) if (ultimo === null || i.numero > ultimo.numero) ultimo = i;
  return ultimo === null ? "PENDIENTE" : ultimo.resultado;
}

/** «Reintentar» solo si el trabajo falló: previene un segundo papel de un trabajo pendiente o ya impreso. */
export function decidirReintento(
  estado: EstadoDeTrabajo,
): Resultado<null, "TRABAJO_NO_REINTENTABLE"> {
  return estado === "FALLIDA" ? ok(null) : err("TRABAJO_NO_REINTENTABLE");
}

export function papelEnMm(valor: number): Resultado<PapelEnMm, "PAPEL_INVALIDO"> {
  const papel = PAPELES_EN_MM.find((p) => p === valor);
  return papel === undefined ? err("PAPEL_INVALIDO") : ok(papel);
}

export function usoDeImpresora(texto: string): Resultado<UsoDeImpresora, "USO_INVALIDO"> {
  const uso = USOS_DE_IMPRESORA.find((u) => u === texto);
  return uso === undefined ? err("USO_INVALIDO") : ok(uso);
}

export function tipoDeDocumento(texto: string): Resultado<TipoDeDocumento, "DOCUMENTO_INVALIDO"> {
  const tipo = TIPOS_DE_DOCUMENTO.find((t) => t === texto);
  return tipo === undefined ? err("DOCUMENTO_INVALIDO") : ok(tipo);
}

/** Qué impresora sirve a cada documento: la comanda y el aviso de anulación van a la de cocina; el ticket, a la del cliente. */
export function usoParaElDocumento(tipo: TipoDeDocumento): UsoDeImpresora {
  return tipo === "TICKET" ? "TICKET" : "COMANDA";
}
