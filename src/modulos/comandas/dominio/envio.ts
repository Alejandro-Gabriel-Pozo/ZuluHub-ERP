import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";

/**
 * EL ENVÍO A COCINA Y EL ESTADO DE CADA LÍNEA (E7 §3.2 `linea_de_comanda`, §3.5; D76, D87, D114). El estado de una línea se DERIVA: sin envío y
 * `AHORA` = para enviar; sin envío y `DESPUES` = espera; con envío = enviada. Cada línea sale en UN solo envío (la base lo impone con
 * `UPDATE … WHERE envio_id IS NULL`); acá vive la decisión pura de qué línea entra en cada envío. Puro: sin reloj ni azar.
 */
export const SALIDAS_DE_LINEA = ["AHORA", "DESPUES"] as const;
export type SalidaDeLinea = (typeof SALIDAS_DE_LINEA)[number];

export const TIPOS_DE_ENVIO = ["ENVIO", "SALIDA_PEDIDA"] as const;
export type TipoDeEnvio = (typeof TIPOS_DE_ENVIO)[number];

export const ROLES_DE_RENGLON = ["SALE", "ESPERA"] as const;
export type RolDeRenglon = (typeof ROLES_DE_RENGLON)[number];

export type EstadoDeLineaDeComanda = "PARA_ENVIAR" | "ESPERA" | "ENVIADA";

export type LineaDeComanda = Readonly<{
  lineaId: string;
  /** La línea sigue vigente en la cuenta (no fue anulada ni quitada). */
  vigente: boolean;
  /** El envío en que salió; `null` = todavía no se envió. */
  envioId: string | null;
  salida: SalidaDeLinea;
}>;

export function estadoDeLineaDeComanda(
  linea: Pick<LineaDeComanda, "envioId" | "salida">,
): EstadoDeLineaDeComanda {
  if (linea.envioId !== null) return "ENVIADA";
  return linea.salida === "AHORA" ? "PARA_ENVIAR" : "ESPERA";
}

/** D86 y D114: no se cobra con platos sin enviar o esperando. El servidor lo rechaza aunque la pantalla ya tenga «Cobrar» apagado. */
export function puedeCobrarse(
  lineas: readonly Pick<LineaDeComanda, "vigente" | "envioId" | "salida">[],
): Resultado<null, "HAY_PLATOS_SIN_ENVIAR"> {
  return lineas.some((l) => l.vigente && estadoDeLineaDeComanda(l) !== "ENVIADA")
    ? err("HAY_PLATOS_SIN_ENVIAR")
    : ok(null);
}

/** Cambiar «sale ahora / sale después» solo mientras la línea no se envió. */
export function decidirCambiarSalida(
  linea: Pick<LineaDeComanda, "vigente" | "envioId">,
): Resultado<null, "LINEA_YA_ENVIADA" | "LINEA_NO_VIGENTE"> {
  if (!linea.vigente) return err("LINEA_NO_VIGENTE");
  return linea.envioId === null ? ok(null) : err("LINEA_YA_ENVIADA");
}

export type SeleccionDeEnvio = Readonly<{
  /** Las líneas que entran al envío (se les fija el `envio_id`). */
  salen: readonly string[];
  /** Solo en `ENVIO`: las que van en el papel como «no preparar todavía» y NO se marcan enviadas. */
  esperan: readonly string[];
  /** Solo en `SALIDA_PEDIDA`: las pedidas que no estaban esperando (ya enviadas, quitadas o ajenas): se ignoran con aviso, no fallan el resto. */
  ignoradas: readonly string[];
}>;

/**
 * Qué líneas toma un envío. `ENVIO`: todas las vigentes que salen ahora y no se enviaron; las que esperan van en el papel con su rol. `SALIDA_PEDIDA`
 * («pedir que salga»): las vigentes en espera, todas (`"TODAS"`) o las pedidas. Previene: una línea enviada dos veces, o un plato en espera que sale solo.
 */
export function seleccionarParaElEnvio(
  tipo: TipoDeEnvio,
  lineas: readonly LineaDeComanda[],
  pedidas: readonly string[] | "TODAS" = "TODAS",
): SeleccionDeEnvio {
  const vigentesSinEnviar = lineas.filter((l) => l.vigente && l.envioId === null);
  if (tipo === "ENVIO") {
    return {
      salen: vigentesSinEnviar.filter((l) => l.salida === "AHORA").map((l) => l.lineaId),
      esperan: vigentesSinEnviar.filter((l) => l.salida === "DESPUES").map((l) => l.lineaId),
      ignoradas: [],
    };
  }
  const enEspera = new Set(
    vigentesSinEnviar.filter((l) => l.salida === "DESPUES").map((l) => l.lineaId),
  );
  if (pedidas === "TODAS") return { salen: [...enEspera], esperan: [], ignoradas: [] };
  const unicas = [...new Set(pedidas)];
  return {
    salen: unicas.filter((id) => enEspera.has(id)),
    esperan: [],
    ignoradas: unicas.filter((id) => !enEspera.has(id)),
  };
}

// fuente-unica: ajeno — coincide con el 40 de la etiqueta de una cuenta de ventas; es el largo máximo del rótulo del envío («Mesa 5»), dato sin relación
export const LARGO_MAXIMO_DEL_ROTULO = 40;
// fuente-unica: ajeno — coincide con el 40 de otros textos cortos; es el largo máximo del nombre de una impresora, dato sin relación
export const LARGO_MAXIMO_DEL_NOMBRE_DE_IMPRESORA = 40;

/** El rótulo del envío («Mesa 5»): una foto de texto corto, con la lista de permitidos de siempre. Lo arma el servidor desde la mesa, no la pantalla. */
export function rotuloDeEnvio(texto: string): Resultado<string, "ROTULO_INVALIDO"> {
  const r = textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_ROTULO,
    exigirUnaLetra: false,
  });
  return r.ok ? ok(r.valor) : err("ROTULO_INVALIDO");
}

export function nombreDeImpresora(
  texto: string,
): Resultado<string, "NOMBRE_DE_IMPRESORA_INVALIDO"> {
  const r = textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_IMPRESORA,
    exigirUnaLetra: true,
  });
  return r.ok ? ok(r.valor) : err("NOMBRE_DE_IMPRESORA_INVALIDO");
}
