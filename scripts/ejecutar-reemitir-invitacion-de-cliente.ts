import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { PEDERNAL_CLAVE_CONTEXTO } from "../src/adaptadores/postgres/contexto-firmado";
import type { EstadoDelAlta } from "../src/adaptadores/postgres/estado-del-alta";
import { PEDERNAL_SECRETO_INVITACIONES } from "../src/adaptadores/tokens/tokens-hmac";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { codigoDelCliente } from "./ejecutar-alta-de-cliente";
import { VARIABLE_DE_LA_CADENA } from "./ejecutar-crear-primer-admin";
import type { EjecutorDeCaso, Salida } from "./ejecutar-preparar-empresa-de-pruebas";
import { VARIABLE_DEL_HOST_DE_LA_BASE, hostDeLaBaseCoincide } from "./host-de-la-base";

/**
 * Reemitir la invitación del primer gerente de un cliente con base propia (workflow `reemitir-invitacion-de-cliente.yml`; PRIMER-DESPLIEGUE.md, H.10). Caso real (27/11/2026): el cron mandó el mail con un
 * despliegue que todavía tenía el secreto de invitaciones anterior, así que el enlace no coincide con el hash guardado, y el trabajo de envío ya quedó HECHO (inmutable). Se emite OTRA invitación (otro id y
 * otro token, 24 h; la anterior se revoca) con el caso de plataforma `reenviarInvitacionDelAlta`, y el mail sale por la cola con la clave de idempotencia del envío de la invitación nueva.
 *
 * Cerraduras: solo si hay UNA empresa viva en PROVISIONING (nadie aceptó todavía), UNA sola invitación pendiente y es la del alta del gerente, y al menos un administrador ADMIN activo (actúa el más antiguo). Con otra
 * invitación pendiente (p. ej. de un empleado), rotar el secreto la dejaría inválida: se corta. La clave de idempotencia sale de la invitación que se reemplaza (`reemitir-invitacion-v1-<codigo>-<id>`):
 * repetir sin que cambie nada devuelve la misma invitación nueva sin otro mail; después de reemplazada, otra corrida reemite de nuevo a propósito. El email del administrador es un dato personal: se tapa
 * y no se imprime. Salida: 0 hecho, 1 falla o rechazo, 2 datos o uso incorrectos.
 */

export type DecisionDeReemision =
  | Readonly<{ ok: true; empresaId: string; invitacionId: string; adminEmail: string }>
  | Readonly<{ ok: false; motivo: string }>;

export function decidirReemision(estado: EstadoDelAlta): DecisionDeReemision {
  const no = (motivo: string): DecisionDeReemision => ({ ok: false, motivo });
  const [empresa, ...otras] = estado.empresas;
  if (empresa === undefined || otras.length > 0) {
    return no("tiene que haber exactamente una empresa viva en la base del cliente");
  }
  if (empresa.estado !== "PROVISIONING") {
    return no(
      "la empresa ya no está en alta pendiente (alguien ya aceptó la invitación): no hay nada que reemitir",
    );
  }
  const [invitacion, ...demas] = estado.invitacionesPendientes;
  if (invitacion === undefined || demas.length > 0) {
    return no(
      "tiene que haber exactamente una invitación pendiente (rotar el secreto dejaría inválidas otras)",
    );
  }
  if (invitacion.tipo !== "ALTA_GERENTE") {
    return no("la invitación pendiente no es la del alta del gerente");
  }
  // Actúa el administrador ADMIN activo más antiguo (el que sembró el alta); con más de uno, los demás no cambian nada.
  const [admin] = estado.administradores;
  if (admin === undefined)
    return no("tiene que haber al menos un administrador de plataforma ADMIN activo");
  return { ok: true, empresaId: empresa.id, invitacionId: invitacion.id, adminEmail: admin };
}

export type EntradaDeReemision = Readonly<{
  ambiente: string | undefined;
  entorno: Readonly<Record<string, string | undefined>>;
  leerEstado: (cadena: string) => Promise<EstadoDelAlta>;
  /** Ejecuta un caso como ese administrador (`ejecutorDeCasos`). */
  ejecutarCaso: EjecutorDeCaso;
  info: (linea: string) => void;
  error: (linea: string) => void;
  comando: (linea: string) => void;
  /** Solo revisa (variables, candado de host y estado del alta) y no cambia nada. */
  soloValidar?: boolean;
}>;

export async function reemitirInvitacionDeCliente(entrada: EntradaDeReemision): Promise<number> {
  const { entorno } = entrada;
  const tapados: Array<string | undefined> = [
    entorno[VARIABLE_DE_LA_CADENA]?.trim(),
    entorno[PEDERNAL_DB_PLATAFORMA]?.trim(),
    entorno[PEDERNAL_CLAVE_CONTEXTO]?.trim().split(":")[1],
    entorno[PEDERNAL_SECRETO_INVITACIONES]?.trim(),
  ];
  const tapar = (linea: string) =>
    tapados.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));
  const salida: Salida = { info, error };

  const codigo = codigoDelCliente(entrada.ambiente);
  if (codigo === null) {
    error("ERROR: el ambiente no es un cliente de la lista cerrada. No se hizo nada.");
    return 2;
  }
  const exigidas =
    entrada.soloValidar === true
      ? [VARIABLE_DE_LA_CADENA, VARIABLE_DEL_HOST_DE_LA_BASE]
      : [
          VARIABLE_DE_LA_CADENA,
          VARIABLE_DEL_HOST_DE_LA_BASE,
          PEDERNAL_DB_PLATAFORMA,
          PEDERNAL_CLAVE_CONTEXTO,
          PEDERNAL_SECRETO_INVITACIONES,
        ];
  const faltan = exigidas.filter((n) => (entorno[n] ?? "").trim() === "");
  if (faltan.length > 0) {
    error(
      `ERROR: faltan estas variables (solo se nombran): ${faltan.join(", ")}. No se hizo nada.`,
    );
    return 2;
  }
  const cadena = (entorno[VARIABLE_DE_LA_CADENA] ?? "").trim();
  if (!hostDeLaBaseCoincide(cadena, entorno[VARIABLE_DEL_HOST_DE_LA_BASE])) {
    error(
      `ERROR: el host de ${VARIABLE_DE_LA_CADENA} no es el declarado en ${VARIABLE_DEL_HOST_DE_LA_BASE}. No se hizo nada.`,
    );
    return 2;
  }

  let decision: DecisionDeReemision;
  try {
    decision = decidirReemision(await entrada.leerEstado(cadena));
  } catch (falla) {
    error(`ERROR: no se pudo leer el estado del alta: ${describirFallaDeBase(falla, cadena)}`);
    return 1;
  }
  if (!decision.ok) {
    error(`ERROR: ${decision.motivo}. No se hizo nada.`);
    return 1;
  }
  tapados.push(decision.adminEmail);
  if (entorno["GITHUB_ACTIONS"] === "true") entrada.comando(`::add-mask::${decision.adminEmail}`);

  if (entrada.soloValidar === true) {
    info(
      "VALIDADO: hay una empresa en alta pendiente con su invitación del gerente. No se cambió nada.",
    );
    return 0;
  }

  info("Reemitiendo la invitación del gerente.");
  const { codigo: salidaDelCaso } = await entrada.ejecutarCaso(
    "reenviarInvitacionDelAlta",
    {
      claveDeIdempotencia: `reemitir-invitacion-v1-${codigo}-${decision.invitacionId}`,
      empresaId: decision.empresaId,
    },
    decision.adminEmail,
    salida,
  );
  if (salidaDelCaso !== 0) {
    error("Se detuvo al reemitir. Lo ya hecho queda; repetir el flujo es seguro.");
    return 1;
  }
  info(
    "LISTO: la invitación nueva quedó emitida y el mail sale por la cola con el despliegue actual.",
  );
  return 0;
}
