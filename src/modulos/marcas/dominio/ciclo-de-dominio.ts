import type { EmpresaId, MarcaComercialId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { normalizarHost, type Host } from "./host";
import { TOLERANCIA_DE_RELOJ_EN_MS } from "./vigencia";

/**
 * Alta y ciclo de vida de un dominio (marcas y planes, §B.2 y migración 0007): decisiones puras que
 * repiten las que la base impone con CHECK y disparadores (`dominio_validar_alta`, `dominio_validar_cambio`).
 * El caso de uso decide ACÁ, con un nombre de error para el usuario; la base queda como segunda barrera
 * ante una carrera (su traducción vive en la persistencia del módulo).
 *
 * Estados: PENDIENTE_VERIFICACION (registrado; sirve la página neutra) -> VERIFICADO -> ACTIVO (sirve su
 * superficie). De VERIFICADO o ACTIVO se vuelve a PENDIENTE_VERIFICACION (la comprobación falló). RETIRADO es
 * terminal, se llega desde cualquier estado menos desde el dominio canónico, y exige motivo.
 */

export const ESTADOS_DE_DOMINIO = [
  "PENDIENTE_VERIFICACION",
  "VERIFICADO",
  "ACTIVO",
  "RETIRADO",
] as const;
export type EstadoDeDominio = (typeof ESTADOS_DE_DOMINIO)[number];

/** Qué se sirve en el host. La misma lista que `dominio_superficie_ck`. */
export const SUPERFICIES_DE_DOMINIO = ["APP", "CARTA", "LANDING", "CONSOLA"] as const;
export type SuperficieDeDominio = (typeof SUPERFICIES_DE_DOMINIO)[number];

/** Quién es el titular del dominio en el registrador. La misma lista que `dominio_titular_ck`. */
export const TITULARES_DE_DOMINIO = ["CLIENTE", "OPERADOR"] as const;
export type TitularDeDominio = (typeof TITULARES_DE_DOMINIO)[number];

/** Una superficie de empresa: su aplicación o su carta. La landing y la consola son de una marca. */
const SUPERFICIES_DE_EMPRESA: readonly SuperficieDeDominio[] = ["APP", "CARTA"];

/** El dueño del host: una marca (host compartido) o una empresa (host dedicado). Exactamente uno. */
export type DuenioDeDominio =
  | Readonly<{ tipo: "MARCA"; marcaId: MarcaComercialId }>
  | Readonly<{ tipo: "EMPRESA"; empresaId: EmpresaId }>;

/** El pedido de alta tal como llega: el host y los textos sin validar. */
export type PedidoDeAltaDeDominio = Readonly<{
  host: string;
  superficie: string;
  titular: string;
  esCanonico: boolean;
  duenio: DuenioDeDominio;
}>;

/** El alta ya validada: el host normalizado y cada texto de su lista. */
export type DominioPorAgregar = Readonly<{
  host: Host;
  superficie: SuperficieDeDominio;
  titular: TitularDeDominio;
  esCanonico: boolean;
  duenio: DuenioDeDominio;
}>;

export type ErrorDeAltaDeDominio =
  | "HOST_INVALIDO"
  | "SUPERFICIE_INVALIDA"
  | "TITULAR_INVALIDO"
  | "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA"
  | "CANONICO_SOLO_DE_MARCA";

function deLaLista<T extends string>(lista: readonly T[], valor: string): T | null {
  return lista.find((elemento) => elemento === valor) ?? null;
}

/**
 * Valida el alta, en este orden: el host (con `normalizarHost`), la superficie, el titular, que un host de
 * empresa sea de su aplicación o su carta, y que solo un host de marca pueda ser canónico (el que arma los
 * enlaces de la marca). Que la marca exista y esté activa, y que el host o el canónico no estén tomados, lo
 * decide la base en la misma transacción (no se pre-lee: una lectura previa no evita la carrera).
 */
export function decidirAltaDeDominio(
  pedido: PedidoDeAltaDeDominio,
): Resultado<DominioPorAgregar, ErrorDeAltaDeDominio> {
  const host = normalizarHost(pedido.host);
  if (!host.ok) return err("HOST_INVALIDO");
  const superficie = deLaLista(SUPERFICIES_DE_DOMINIO, pedido.superficie);
  if (superficie === null) return err("SUPERFICIE_INVALIDA");
  const titular = deLaLista(TITULARES_DE_DOMINIO, pedido.titular);
  if (titular === null) return err("TITULAR_INVALIDO");
  if (pedido.duenio.tipo === "EMPRESA") {
    if (!SUPERFICIES_DE_EMPRESA.includes(superficie)) {
      return err("SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA");
    }
    if (pedido.esCanonico) return err("CANONICO_SOLO_DE_MARCA");
  }
  return ok({
    host: host.valor,
    superficie,
    titular,
    esCanonico: pedido.esCanonico,
    duenio: pedido.duenio,
  });
}

/** Lo que la decisión necesita saber del dominio guardado. */
export type DominioActual = Readonly<{ estado: EstadoDeDominio; esCanonico: boolean }>;

export type PedidoDeCambioDeDominio =
  /** `verificadoEn` lo manda quien llama: cómo se comprueba el DNS es de otro tramo. */
  | Readonly<{ tipo: "VERIFICAR"; verificadoEn: Date }>
  | Readonly<{ tipo: "ACTIVAR" }>
  | Readonly<{ tipo: "DESACTIVAR" }>
  | Readonly<{ tipo: "RETIRAR"; motivo: string }>;

/** El cambio de estado a escribir; cada uno lleva solo lo que la base le deja tocar. */
export type CambioDeEstadoDeDominio =
  | Readonly<{ estado: "VERIFICADO"; verificadoEn: Date }>
  | Readonly<{ estado: "ACTIVO" }>
  /** Vuelve a pendiente: la fecha de verificación se borra (`dominio_verificacion_ck`). */
  | Readonly<{ estado: "PENDIENTE_VERIFICACION" }>
  | Readonly<{ estado: "RETIRADO"; motivo: string }>;

export type DecisionDeCambioDeDominio =
  /** Ya estaba como se pide: éxito sin escribir (activar lo activo, retirar lo retirado). */
  Readonly<{ tipo: "YA_ESTABA" }> | Readonly<{ tipo: "CAMBIA"; cambio: CambioDeEstadoDeDominio }>;

export type ErrorDeCambioDeDominio =
  | "FECHA_DE_VERIFICACION_INVALIDA"
  | "MOTIVO_OBLIGATORIO"
  | "MOTIVO_DEMASIADO_LARGO"
  | "DOMINIO_RETIRADO"
  | "DOMINIO_SIN_VERIFICAR"
  | "DOMINIO_CANONICO";

/** Tope del motivo de un retiro: es texto libre del operador y queda en la auditoría. */
export const LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO = 500;

/**
 * La forma del pedido: lo que se mira antes que el estado del dominio. Devuelve el pedido normalizado (el
 * motivo sin espacios en los extremos). El caso de uso la llama primero para armar la huella de la clave de
 * idempotencia con el pedido ya limpio, y `decidirCambioDeDominio` la repite: es idempotente.
 *
 *  - VERIFICAR: la fecha no puede ser inválida ni futura (con la tolerancia de reloj de la base).
 *  - RETIRAR: el motivo es obligatorio (sin espacios de los extremos) y no pasa de
 *    `LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO`.
 */
export function validarPedidoDeCambioDeDominio(
  pedido: PedidoDeCambioDeDominio,
  ahora: Date,
): Resultado<PedidoDeCambioDeDominio, ErrorDeCambioDeDominio> {
  switch (pedido.tipo) {
    case "VERIFICAR": {
      const instante = pedido.verificadoEn.getTime();
      return Number.isNaN(instante) || instante > ahora.getTime() + TOLERANCIA_DE_RELOJ_EN_MS
        ? err("FECHA_DE_VERIFICACION_INVALIDA")
        : ok(pedido);
    }
    case "RETIRAR": {
      const motivo = pedido.motivo.trim();
      if (motivo === "") return err("MOTIVO_OBLIGATORIO");
      return motivo.length > LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO
        ? err("MOTIVO_DEMASIADO_LARGO")
        : ok({ tipo: "RETIRAR", motivo });
    }
    case "ACTIVAR":
    case "DESACTIVAR":
      return ok(pedido);
  }
}

/**
 * Qué pasa si se pide `pedido` sobre un dominio en el estado `actual`. Primero la forma del pedido,
 * después el estado. Un dominio retirado no se toca: se registra otro. Los cambios que dejan el dominio
 * como ya estaba son éxito (`YA_ESTABA`), no error.
 *
 *  - VERIFICAR: PENDIENTE pasa a VERIFICADO; VERIFICADO o ACTIVO ya están verificados.
 *  - ACTIVAR: solo un dominio verificado se activa (`DOMINIO_SIN_VERIFICAR` si está pendiente).
 *  - DESACTIVAR: de VERIFICADO o ACTIVO vuelve a PENDIENTE_VERIFICACION (página neutra al instante).
 *  - RETIRAR: el canónico no se retira (`DOMINIO_CANONICO`); retirar lo retirado es éxito.
 */
export function decidirCambioDeDominio(
  actual: DominioActual,
  pedido: PedidoDeCambioDeDominio,
  ahora: Date,
): Resultado<DecisionDeCambioDeDominio, ErrorDeCambioDeDominio> {
  const valido = validarPedidoDeCambioDeDominio(pedido, ahora);
  if (!valido.ok) return valido;
  const { estado } = actual;
  const pedida = valido.valor;
  if (pedida.tipo === "RETIRAR" && estado === "RETIRADO") return ok({ tipo: "YA_ESTABA" });
  if (estado === "RETIRADO") return err("DOMINIO_RETIRADO");
  switch (pedida.tipo) {
    case "VERIFICAR":
      return estado === "PENDIENTE_VERIFICACION"
        ? ok({
            tipo: "CAMBIA",
            cambio: { estado: "VERIFICADO", verificadoEn: pedida.verificadoEn },
          })
        : ok({ tipo: "YA_ESTABA" });
    case "ACTIVAR":
      if (estado === "PENDIENTE_VERIFICACION") return err("DOMINIO_SIN_VERIFICAR");
      return estado === "ACTIVO"
        ? ok({ tipo: "YA_ESTABA" })
        : ok({ tipo: "CAMBIA", cambio: { estado: "ACTIVO" } });
    case "DESACTIVAR":
      return estado === "PENDIENTE_VERIFICACION"
        ? ok({ tipo: "YA_ESTABA" })
        : ok({ tipo: "CAMBIA", cambio: { estado: "PENDIENTE_VERIFICACION" } });
    case "RETIRAR":
      if (actual.esCanonico) return err("DOMINIO_CANONICO");
      return ok({ tipo: "CAMBIA", cambio: { estado: "RETIRADO", motivo: pedida.motivo } });
  }
}
