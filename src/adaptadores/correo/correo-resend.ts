import type { Correo, ResultadoDeEnvio } from "../../puertos/correo";
import { ErrorDeConfiguracion } from "../postgres/errores";
import type { ConfiguracionDeCorreo } from "./configuracion";

/**
 * Correo sobre la API HTTP de Resend, con el `fetch` global (sin librerías). El `fetch` se inyecta
 * para probar sin red; nada acá hace llamadas reales en las pruebas.
 *
 * Contrato usado (de la documentación pública de Resend; NO verificado contra la cuenta real):
 *  - `POST https://api.resend.com/emails`, `Authorization: Bearer <clave>`, cuerpo JSON
 *    `{ from, to: [dirección], subject, text }`; la respuesta correcta trae `{ id }`.
 *  - `Idempotency-Key: <clave>`: según su documentación, Resend recuerda la clave 24 horas y una
 *    repetición con el mismo cuerpo devuelve la misma respuesta sin enviar otro mail; con otro cuerpo
 *    se rechaza. Por eso el mensaje de un mismo envío tiene que ser idéntico en cada repetición.
 *
 * Clasificación de fallos: son definitivos solo 400, 404 y 422 (la solicitud está mal y repetirla no
 * lo arregla). Todo lo demás (red, tiempo agotado, 401/403 por una credencial a corregir, 409, 429,
 * 5xx) se reintenta, y el tope de intentos de la cola lo acota. El motivo nunca incluye la
 * credencial, el cuerpo del mensaje ni el enlace.
 */
export type OpcionesDeCorreoResend = Readonly<{
  configuracion: Pick<ConfiguracionDeCorreo, "claveDeApi" | "remitente">;
  /** Por defecto, el `fetch` global. */
  fetch?: typeof fetch;
  urlDeLaApi?: string;
  tiempoMaximoEnMs?: number;
}>;

const URL_DE_LA_API = "https://api.resend.com/emails";
const TIEMPO_MAXIMO_EN_MS = 10_000;
const ESTADOS_DEFINITIVOS: ReadonlySet<number> = new Set([400, 404, 422]);

export function crearCorreoResend(opciones: OpcionesDeCorreoResend): Correo {
  const { claveDeApi, remitente } = opciones.configuracion;
  if (claveDeApi.trim() === "" || remitente.trim() === "") {
    throw new ErrorDeConfiguracion("falta la configuración del correo (clave de API y remitente)");
  }
  const llamar = opciones.fetch ?? globalThis.fetch;
  const urlDeLaApi = opciones.urlDeLaApi ?? URL_DE_LA_API;
  const tiempoMaximo = opciones.tiempoMaximoEnMs ?? TIEMPO_MAXIMO_EN_MS;

  return {
    async enviar(mensaje, claveDeIdempotencia): Promise<ResultadoDeEnvio> {
      if (claveDeIdempotencia.trim() === "") {
        throw new RangeError("enviar: la clave de idempotencia no puede estar vacía");
      }
      let respuesta: Response;
      try {
        respuesta = await llamar(urlDeLaApi, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${claveDeApi}`,
            "Content-Type": "application/json",
            "Idempotency-Key": claveDeIdempotencia,
            "User-Agent": "zuluhub-erp",
          },
          body: JSON.stringify({
            from: remitente,
            to: [mensaje.para],
            subject: mensaje.asunto,
            text: mensaje.texto,
          }),
          signal: AbortSignal.timeout(tiempoMaximo),
        });
      } catch (error) {
        // Solo el nombre del error (`TimeoutError`, `TypeError`...): su mensaje podría repetir la URL.
        const nombre = error instanceof Error ? error.name : "desconocido";
        return {
          tipo: "FALLO",
          definitivo: false,
          motivo: `no se pudo llamar al proveedor (${nombre})`,
        };
      }

      let cuerpo: unknown = null;
      try {
        cuerpo = await respuesta.json();
      } catch {
        // Sin cuerpo JSON: alcanza con el código de estado.
      }
      const campo = (nombre: string): string | null => {
        if (typeof cuerpo !== "object" || cuerpo === null) return null;
        const valor = (cuerpo as Record<string, unknown>)[nombre];
        return typeof valor === "string" ? valor : null;
      };

      if (respuesta.ok) return { tipo: "ENVIADO", idDelProveedor: campo("id") };
      const nombreDelError = campo("name");
      return {
        tipo: "FALLO",
        definitivo: ESTADOS_DEFINITIVOS.has(respuesta.status),
        motivo:
          nombreDelError === null
            ? `el proveedor respondió ${respuesta.status}`
            : `el proveedor respondió ${respuesta.status} (${nombreDelError.slice(0, 60)})`,
      };
    },
  };
}
