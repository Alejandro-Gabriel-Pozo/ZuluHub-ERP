import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { hostConPooler } from "../src/adaptadores/postgres/migraciones";
import { PEDERNAL_SECRETO_INVITACIONES } from "../src/adaptadores/tokens/tokens-hmac";
import type { ClienteDeVariables } from "../src/adaptadores/vercel/cliente-vercel";
import {
  VARIABLE_DEL_TOKEN,
  VARIABLE_SECRETO_INVITACIONES,
  generarValor,
  leerPedidoDeVercel,
  leerTokenDeVercel,
} from "../src/adaptadores/vercel/plan-de-variables";
import { VARIABLE_DE_LA_CADENA } from "./ejecutar-crear-primer-admin";
import { VARIABLE_DEL_PAQUETE_DE_CLIENTE, leerPaqueteDeCliente } from "./ejecutar-alta-de-cliente";

/**
 * El secreto de invitaciones de la web de un CLIENTE (workflow `alta-de-cliente.yml`). El token de una invitación se guarda como HMAC con `PEDERNAL_SECRETO_INVITACIONES`, y ese valor tiene que
 * ser EL MISMO en quien emite la invitación (este alta, con la base del cliente) y en la web del cliente que la valida. GitHub no conoce el de Vercel (se carga al azar como variable sensible y no
 * se lee de vuelta), así que el alta genera uno en el runner y lo escribe en el proyecto de Vercel del cliente, un solo origen y sin copias a mano.
 *
 * Solo si la empresa NO existe todavía (por CUIT): sin empresa no hay invitaciones firmadas con el valor anterior, así que cambiarlo no invalida nada, y repetir el flujo tras una falla a medias
 * deja el valor nuevo en los dos lados. Con la empresa ya creada NO se toca nada (cambiarlo dejaría inválida la invitación del gerente): se entrega un valor de relleno con forma válida que
 * NO se escribe en ninguna parte, solo para que el alta, que repite sus pasos sin cambios, pueda armar su plataforma. Se escribe en Vercel ANTES de crear la empresa: si falla, no se crea nada.
 *
 * El valor se entrega al paso siguiente SOLO por el archivo de entorno del runner (`GITHUB_ENV`), tapado con `::add-mask::`; no se imprime nunca. Salida: 0 hecho, 1 falla, 2 datos o uso incorrectos.
 */

export type EntradaDelSecretoDeInvitaciones = Readonly<{
  ambiente: string | undefined;
  entorno: Readonly<Record<string, string | undefined>>;
  empresaExiste: (cadena: string, cuit: string) => Promise<boolean>;
  /** Cliente de la API de Vercel ya armado para el proyecto del cliente. */
  clienteDeVercel: (token: string, proyecto: string) => ClienteDeVariables;
  /** Escribe `NOMBRE=valor` en el archivo de entorno del runner. */
  entregar: (linea: string) => void;
  info: (linea: string) => void;
  error: (linea: string) => void;
  comando: (linea: string) => void;
  generar?: () => string;
}>;

export async function prepararSecretoDeInvitaciones(
  entrada: EntradaDelSecretoDeInvitaciones,
): Promise<number> {
  const { entorno } = entrada;
  const tapados: Array<string | undefined> = [
    entorno[VARIABLE_DE_LA_CADENA]?.trim(),
    entorno[VARIABLE_DEL_TOKEN]?.trim(),
    entorno[VARIABLE_DEL_PAQUETE_DE_CLIENTE]?.trim(),
  ];
  const tapar = (linea: string) =>
    tapados.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  const pedido = leerPedidoDeVercel(entrada.ambiente);
  if (pedido === null || !entrada.ambiente?.startsWith("cliente-")) {
    error("ERROR: el ambiente no es un cliente de la lista cerrada. No se hizo nada.");
    return 2;
  }
  const cadena = entorno[VARIABLE_DE_LA_CADENA]?.trim() ?? "";
  if (cadena === "" || hostConPooler(cadena)) {
    error(`ERROR: ${VARIABLE_DE_LA_CADENA} falta o apunta al pooler: se usa la cadena DIRECTA.`);
    return 2;
  }
  const token = leerTokenDeVercel(entorno);
  if ("problema" in token) {
    error(`ERROR: ${VARIABLE_DEL_TOKEN} falta o no tiene la forma pedida. No se hizo nada.`);
    return 2;
  }
  tapados.push(token.token);
  const leido = leerPaqueteDeCliente(entorno[VARIABLE_DEL_PAQUETE_DE_CLIENTE]);
  if (!leido.ok) {
    error(
      "ERROR: los datos del alta no sirven (los revisa el paso de validación). No se hizo nada.",
    );
    return 2;
  }
  const generar = entrada.generar ?? (() => generarValor(VARIABLE_SECRETO_INVITACIONES));

  let existe: boolean;
  try {
    existe = await entrada.empresaExiste(cadena, leido.paquete.empresa.cuit);
  } catch (falla) {
    error(
      `ERROR: no se pudo consultar la base del cliente: ${describirFallaDeBase(falla, cadena)}`,
    );
    return 1;
  }

  const valor = generar();
  tapados.push(valor);
  entrada.comando(`::add-mask::${valor}`);
  if (existe) {
    info(
      "La empresa ya existe: el secreto de invitaciones de la web NO se toca (la invitación ya emitida sigue válida).",
    );
  } else {
    const cliente = entrada.clienteDeVercel(token.token, pedido.proyecto);
    const escrito = await cliente.escribir(PEDERNAL_SECRETO_INVITACIONES, valor, pedido.destino, {
      pisar: true,
    });
    if (!escrito.ok) {
      error(
        `ERROR: no se pudo escribir el secreto en Vercel (${escrito.error.motivo}). No se creó nada.`,
      );
      return 1;
    }
    info("El secreto de invitaciones quedó cargado en el proyecto de Vercel del cliente.");
  }
  entrada.entregar(`${PEDERNAL_SECRETO_INVITACIONES}=${valor}`);
  return 0;
}
