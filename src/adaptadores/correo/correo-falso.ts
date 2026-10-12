import type { Correo, MensajeDeCorreo, ResultadoDeEnvio } from "../../puertos/correo";

/**
 * Correo falso para pruebas y desarrollo: no sale nada de la máquina. Se comporta como un proveedor
 * que respeta la clave de idempotencia:
 *  - la misma clave con el mismo mensaje devuelve el envío ya hecho SIN enviar otro;
 *  - la misma clave con otro mensaje se rechaza (como hacen los proveedores que comparan el cuerpo);
 *  - una clave vacía es un defecto del llamador y lanza.
 * `enviados` es lo observable (un mensaje por clave); `llamadas` es cada invocación, repetidas incluidas.
 */
export type EnvioRegistrado = Readonly<{
  id: string;
  claveDeIdempotencia: string;
  mensaje: MensajeDeCorreo;
}>;

export type FalloProgramado = Readonly<{ definitivo: boolean; motivo: string }>;

export type CorreoFalso = Correo &
  Readonly<{
    /** Los mensajes realmente enviados, uno por clave de idempotencia. */
    enviados(): readonly EnvioRegistrado[];
    /** Cada llamada a `enviar`, con la clave que llegó. */
    llamadas(): readonly Readonly<{ claveDeIdempotencia: string; mensaje: MensajeDeCorreo }>[];
    /** Hace que las próximas `cantidad` llamadas fallen con ese fallo (no envían nada). */
    fallarLasProximas(cantidad: number, fallo?: FalloProgramado): void;
  }>;

export function crearCorreoFalso(): CorreoFalso {
  const enviados = new Map<string, EnvioRegistrado>();
  const llamadas: { claveDeIdempotencia: string; mensaje: MensajeDeCorreo }[] = [];
  let fallosPendientes = 0;
  let fallo: FalloProgramado = { definitivo: false, motivo: "fallo programado" };

  return {
    async enviar(mensaje, claveDeIdempotencia): Promise<ResultadoDeEnvio> {
      if (claveDeIdempotencia.trim() === "") {
        throw new RangeError("enviar: la clave de idempotencia no puede estar vacía");
      }
      llamadas.push({ claveDeIdempotencia, mensaje });
      await Promise.resolve();
      if (fallosPendientes > 0) {
        fallosPendientes -= 1;
        return { tipo: "FALLO", ...fallo };
      }
      const previo = enviados.get(claveDeIdempotencia);
      if (previo !== undefined) {
        const igual =
          previo.mensaje.para === mensaje.para &&
          previo.mensaje.asunto === mensaje.asunto &&
          previo.mensaje.texto === mensaje.texto;
        return igual
          ? { tipo: "ENVIADO", idDelProveedor: previo.id }
          : { tipo: "FALLO", definitivo: true, motivo: "clave reutilizada con otro mensaje" };
      }
      const registro = { id: `falso-${enviados.size + 1}`, claveDeIdempotencia, mensaje };
      enviados.set(claveDeIdempotencia, registro);
      return { tipo: "ENVIADO", idDelProveedor: registro.id };
    },

    enviados: () => [...enviados.values()],
    llamadas: () => [...llamadas],
    fallarLasProximas(cantidad, nuevoFallo) {
      fallosPendientes = cantidad;
      if (nuevoFallo !== undefined) fallo = nuevoFallo;
    },
  };
}
