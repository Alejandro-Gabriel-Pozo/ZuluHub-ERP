import { appendFileSync } from "node:fs";
import { datosDelDespliegue, verificarDespliegue } from "./ejecutar-despliegue-de-cliente";

/**
 * `npm run desplegar-cliente -- datos <ambiente>` y `npm run desplegar-cliente -- verificar <dirección>`: lo corre `desplegar-cliente.yml`; ver `ejecutar-despliegue-de-cliente.ts`.
 */
const PLAZO_EN_MS = 15_000;
const TOPE_DEL_CUERPO_EN_BYTES = 65_536;

const pedir = async (url: string, encabezados: Readonly<Record<string, string>> = {}) => {
  const respuesta = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": "pedernal-despliegue", ...encabezados },
    signal: AbortSignal.timeout(PLAZO_EN_MS),
  });
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  return {
    estado: respuesta.status,
    cuerpo: new TextDecoder().decode(bytes.subarray(0, TOPE_DEL_CUERPO_EN_BYTES)),
  };
};
const info = (linea: string) => console.log(linea);
const error = (linea: string) => console.error(linea);

if (process.argv[2] === "datos") {
  const archivo = process.env["GITHUB_ENV"];
  if (archivo === undefined || archivo === "") {
    error("ERROR: solo corre dentro de GitHub Actions (falta GITHUB_ENV). No se hizo nada.");
    process.exitCode = 2;
  } else {
    process.exitCode = await datosDelDespliegue({
      ambiente: process.argv[3],
      entorno: process.env,
      pedir,
      entregar: (linea) => appendFileSync(archivo, `${linea}\n`),
      info,
      error,
    });
  }
} else if (process.argv[2] === "verificar") {
  process.exitCode = await verificarDespliegue({
    url: process.argv[3],
    pedir,
    esperar: (ms) => new Promise<void>((listo) => setTimeout(listo, ms)),
    info,
    error,
  });
} else {
  error("Uso: npm run desplegar-cliente -- datos <ambiente> | verificar <dirección>");
  process.exitCode = 2;
}
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
