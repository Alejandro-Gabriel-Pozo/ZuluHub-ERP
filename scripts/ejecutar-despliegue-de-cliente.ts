import { VARIABLE_DE_LA_CADENA } from "./ejecutar-crear-primer-admin";
import { VARIABLE_DEL_HOST_DE_LA_BASE, hostDeLaBaseCoincide } from "./host-de-la-base";
import { ocultarSecretos } from "../src/adaptadores/postgres/describir-falla-de-base";
import {
  EQUIPO_DE_VERCEL,
  VARIABLE_DEL_TOKEN,
  leerPedidoDeVercel,
  leerTokenDeVercel,
} from "../src/adaptadores/vercel/plan-de-variables";

/**
 * Lo que rodea al despliegue de la web de un CLIENTE (`desplegar-cliente.yml`; PRIMER-DESPLIEGUE.md, H.5). El despliegue en sí lo hace la CLI de Vercel (versión fija en el workflow); acá
 * están las dos partes que son nuestras y se pueden probar:
 *
 *  1. `datosDelDespliegue`: de la LISTA CERRADA de clientes sale el proyecto (nunca de una entrada), se le pregunta a Vercel a qué cuenta pertenece y se entregan al runner `VERCEL_ORG_ID` y
 *     `VERCEL_PROJECT_ID` (lo que la CLI lee para saber adónde desplegar, sin carpeta `.vercel`). Si Vercel no confirma que ese proyecto existe y a quién pertenece, no se despliega nada.
 *  2. `verificarDespliegue`: contra la dirección técnica que imprimió la CLI (solo `https://<algo>.vercel.app`), pide `/api/salud` con reintentos (un despliegue recién hecho tarda en responder).
 *     Resultado: LISTO (200 con `{"ok":true}`), PROTEGIDO (401 o 403: Vercel protege la dirección técnica y no se pudo mirar; NO es un OK) o FALLA.
 *
 * El token viaja solo en un encabezado y nunca se imprime. Salida: 0 hecho, 1 falla, 2 datos incorrectos, 3 protegido (NO VERIFICADO).
 */

export const PEDIDOS_DE_SALUD = 12;
export const ESPERA_ENTRE_PEDIDOS_EN_MS = 10_000;
const DIRECCION_TECNICA = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.vercel\.app$/;

type Entorno = Readonly<Record<string, string | undefined>>;
type Pedido = (
  url: string,
  encabezados?: Readonly<Record<string, string>>,
) => Promise<Readonly<{ estado: number; cuerpo: string }>>;

export type EntradaDeDatosDelDespliegue = Readonly<{
  ambiente: string | undefined;
  entorno: Entorno;
  pedir: Pedido;
  entregar: (linea: string) => void;
  info: (linea: string) => void;
  error: (linea: string) => void;
}>;

export async function datosDelDespliegue(entrada: EntradaDeDatosDelDespliegue): Promise<number> {
  const token = leerTokenDeVercel(entrada.entorno);
  const secreto = "token" in token ? token.token : undefined;
  const error = (linea: string) => entrada.error(ocultarSecretos(linea, secreto));
  const pedido = leerPedidoDeVercel(entrada.ambiente);
  if (pedido === null || !entrada.ambiente?.startsWith("cliente-")) {
    error("ERROR: el ambiente no es un cliente de la lista cerrada. No se hizo nada.");
    return 2;
  }
  if (
    !hostDeLaBaseCoincide(
      entrada.entorno[VARIABLE_DE_LA_CADENA],
      entrada.entorno[VARIABLE_DEL_HOST_DE_LA_BASE],
    )
  ) {
    error(
      `ERROR: el host de ${VARIABLE_DE_LA_CADENA} no es el declarado en ${VARIABLE_DEL_HOST_DE_LA_BASE}. No se hizo nada.`,
    );
    return 2;
  }
  if ("problema" in token) {
    error(`ERROR: ${VARIABLE_DEL_TOKEN} falta o no tiene la forma pedida. No se hizo nada.`);
    return 2;
  }
  let respuesta: Readonly<{ estado: number; cuerpo: string }>;
  try {
    respuesta = await entrada.pedir(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(pedido.proyecto)}?slug=${encodeURIComponent(EQUIPO_DE_VERCEL)}`,
      { authorization: `Bearer ${token.token}` },
    );
  } catch {
    error("ERROR: no se pudo consultar el proyecto en Vercel (red o tiempo). No se hizo nada.");
    return 1;
  }
  if (respuesta.estado !== 200) {
    error(
      `ERROR: Vercel contestó ${String(respuesta.estado)} al consultar el proyecto del cliente: el token no tiene alcance a ese proyecto o el proyecto no existe. No se hizo nada.`,
    );
    return 1;
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(respuesta.cuerpo);
  } catch {
    cuerpo = null;
  }
  const datos =
    typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as Record<string, unknown>) : {};
  const cuenta = datos["accountId"];
  if (
    datos["id"] !== pedido.proyecto ||
    typeof cuenta !== "string" ||
    !/^[A-Za-z0-9_]{5,64}$/.test(cuenta)
  ) {
    error("ERROR: la respuesta de Vercel no confirma el proyecto del cliente. No se hizo nada.");
    return 1;
  }
  entrada.entregar(`VERCEL_ORG_ID=${cuenta}`);
  entrada.entregar(`VERCEL_PROJECT_ID=${pedido.proyecto}`);
  entrada.info(`Proyecto de ${pedido.etiqueta} confirmado en Vercel; se despliega a producción.`);
  return 0;
}

export type EntradaDeVerificacion = Readonly<{
  /** Lo que imprimió la CLI de Vercel como dirección del despliegue. */
  url: string | undefined;
  pedir: Pedido;
  esperar: (milisegundos: number) => Promise<void>;
  info: (linea: string) => void;
  error: (linea: string) => void;
}>;

export async function verificarDespliegue(entrada: EntradaDeVerificacion): Promise<number> {
  const url = entrada.url?.trim() ?? "";
  if (!DIRECCION_TECNICA.test(url)) {
    entrada.error(
      "ERROR: la dirección del despliegue no tiene la forma https://<nombre>.vercel.app. No se verificó nada.",
    );
    return 2;
  }
  let ultimo: number | null = null;
  for (let intento = 1; intento <= PEDIDOS_DE_SALUD; intento += 1) {
    try {
      const respuesta = await entrada.pedir(`${url}/api/salud`);
      ultimo = respuesta.estado;
      if (respuesta.estado === 200) {
        let ok = false;
        try {
          ok = (JSON.parse(respuesta.cuerpo) as { ok?: unknown }).ok === true;
        } catch {
          ok = false;
        }
        if (ok) {
          entrada.info("LISTO: /api/salud contestó 200 con ok=true.");
          return 0;
        }
      }
      if (respuesta.estado === 401 || respuesta.estado === 403) {
        entrada.error(
          "NO VERIFICADO: Vercel protege la dirección técnica del despliegue (401/403) y no se pudo mirar /api/salud. Esto NO es un OK: se mira la dirección pública cuando el dominio ya apunte y el estado del despliegue en Vercel.",
        );
        return 3;
      }
    } catch {
      ultimo = null;
    }
    if (intento < PEDIDOS_DE_SALUD) await entrada.esperar(ESPERA_ENTRE_PEDIDOS_EN_MS);
  }
  entrada.error(
    `ERROR: /api/salud no contestó 200 con ok=true tras ${String(PEDIDOS_DE_SALUD)} intentos (último estado: ${ultimo === null ? "sin respuesta" : String(ultimo)}).`,
  );
  return 1;
}
