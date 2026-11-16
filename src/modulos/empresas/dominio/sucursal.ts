import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { horaDelDiaDesdeTexto, type HoraDelDia } from "../../../primitivas/tiempo/hora-del-dia";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import {
  contactoQueCambia,
  type CambiosDeContacto,
  type ContactoDeSucursal,
  type ErrorDeContactoDeSucursal,
} from "./contacto-de-sucursal";

/**
 * Sucursal: un local de la empresa (H6, especificación §B.1). Puro: sin reloj ni azar. Una sucursal
 * nunca se borra: se desactiva, y una desactivada conserva su nombre (no se puede crear otra igual:
 * se la reactiva). La sucursal no tiene zona horaria propia: rige la de la empresa. Sí tiene su hora de
 * corte de la jornada (`horaDeCorte`, `00:00` por defecto): con la zona de la empresa fija la fecha de
 * negocio de caja, ventas y stock (conciliación §3.2). Su `contacto` (teléfono, correo y web, los tres opcionales) lo
 * imprime la factura (D-98).
 */
export type Sucursal = Readonly<{
  id: SucursalId;
  empresaId: EmpresaId;
  nombre: string;
  activa: boolean;
  horaDeCorte: HoraDelDia;
  contacto: ContactoDeSucursal;
  version: number;
}>;

/** Lo que hace falta para fechar por jornada en una sucursal: la zona de su empresa y su hora de corte. */
export type DatosDeJornada = Readonly<{ zonaHoraria: string; horaDeCorte: HoraDelDia }>;

export type ErrorDeNombreDeSucursal = "NOMBRE_DE_SUCURSAL_INVALIDO";
export type ErrorDeHoraDeCorte = "HORA_DE_CORTE_INVALIDA";

export type ErrorDeSucursal =
  | ErrorDeNombreDeSucursal
  | ErrorDeHoraDeCorte
  | ErrorDeContactoDeSucursal
  | "SUCURSAL_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA"
  | "ULTIMA_SUCURSAL_ACTIVA"
  | "SUCURSAL_INACTIVA_CON_ESE_NOMBRE";

type ErrorAlDesactivar = Extract<
  ErrorDeSucursal,
  "SUCURSAL_NO_ENCONTRADA" | "ULTIMA_SUCURSAL_ACTIVA"
>;
type ErrorAlEditar = Extract<ErrorDeSucursal, "SUCURSAL_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA">;

/** Largo máximo del nombre, en caracteres (la base no lo limita; sin tope entra cualquier cosa). */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL = 100;

/**
 * El nombre limpio: texto de una línea de 1 a `LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL` caracteres de la lista de permitidos
 * (`texto-de-una-linea.ts`, una sola fuente: la misma que dibuja el PDF), en su forma canónica: NFC (así "é" escrita de una o de dos
 * piezas es el mismo nombre para la unicidad), sin espacios en los extremos y con los espacios repetidos en uno. Previene: un
 * invisible, `<>` o un emoji en un nombre que se imprime en el comprobante. SUPUESTO (DEC-0047) del ingeniero (Deuda 1, 2026-11-16,
 * sin fuente del dueño): la lista base; revertir es volver a «sin caracteres de control».
 */
export function nombreDeSucursalValido(texto: string): Resultado<string, ErrorDeNombreDeSucursal> {
  const limpio = textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL,
    exigirUnaLetra: false,
  });
  return limpio.ok ? ok(limpio.valor) : err("NOMBRE_DE_SUCURSAL_INVALIDO");
}

/**
 * La hora de corte `HH:MM` (reloj de 24 horas, de 00:00 a 23:59, sin segundos), tal cual la guarda la
 * base. Es el error `HORA_DE_CORTE_INVALIDA` de la jornada (`primitivas/tiempo`), no el de la hora del
 * día genérica: así lo ve quien edita la sucursal.
 */
export function horaDeCorteValida(texto: string): Resultado<HoraDelDia, ErrorDeHoraDeCorte> {
  const hora = horaDelDiaDesdeTexto(texto);
  return hora.ok ? hora : err("HORA_DE_CORTE_INVALIDA");
}

export type DecisionDeDesactivacion = "YA_INACTIVA" | "DESACTIVAR";

/**
 * Desactivar: idempotente sobre una ya inactiva, y nunca deja a la empresa sin una sucursal activa.
 * `activasDeLaEmpresa` son las activas de la empresa leídas en la misma transacción; la sucursal
 * objetivo no cuenta como "otra activa".
 */
export function decidirDesactivacion(
  sucursal: Sucursal | null,
  activasDeLaEmpresa: readonly Sucursal[],
): Resultado<DecisionDeDesactivacion, ErrorAlDesactivar> {
  if (sucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (!sucursal.activa) return ok("YA_INACTIVA");
  const otrasActivas = activasDeLaEmpresa.filter((s) => s.activa && s.id !== sucursal.id);
  return otrasActivas.length === 0 ? err("ULTIMA_SUCURSAL_ACTIVA") : ok("DESACTIVAR");
}

export type DecisionDeReactivacion = "YA_ACTIVA" | "REACTIVAR";

/** Reactivar: idempotente sobre una ya activa. */
export function decidirReactivacion(
  sucursal: Sucursal | null,
): Resultado<DecisionDeReactivacion, Extract<ErrorDeSucursal, "SUCURSAL_NO_ENCONTRADA">> {
  if (sucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
  return ok(sucursal.activa ? "YA_ACTIVA" : "REACTIVAR");
}

export type DecisionDeAlta = "YA_EXISTIA";

/**
 * La sucursal que ya tenía ese nombre (sin distinguir mayúsculas) cuando el alta no pudo crear otra:
 * si está activa, el alta ya estaba hecha (doble clic o reintento); si está desactivada, hay que
 * reactivarla, no crear otra con su nombre.
 */
export function decidirAltaConNombreOcupado(
  existente: Sucursal,
): Resultado<DecisionDeAlta, Extract<ErrorDeSucursal, "SUCURSAL_INACTIVA_CON_ESE_NOMBRE">> {
  return existente.activa ? ok("YA_EXISTIA") : err("SUCURSAL_INACTIVA_CON_ESE_NOMBRE");
}

export type DecisionDeEdicion = "SIN_CAMBIOS" | "EDITAR";

/** Lo que pide una edición: el nombre y, solo si se piden, la hora de corte y los datos de contacto (ausente = no se toca). */
export type CambiosPedidosDeSucursal = Readonly<{
  nombre: string;
  horaDeCorte?: HoraDelDia | undefined;
  contacto?: CambiosDeContacto | undefined;
}>;

/**
 * Editar el nombre y, si se piden, la hora de corte y el contacto, con control de versión. Si lo pedido ya es lo que
 * hay (el nombre igual y cada dato pedido igual al vigente) no hay nada que hacer, aunque la versión sea otra: así
 * repetir una edición que ya se aplicó (un corte de conexión) da el mismo resultado y no un conflicto. Si no, la
 * versión esperada tiene que ser la vigente. Un dato omitido no se toca.
 */
export function decidirEdicion(
  sucursal: Sucursal | null,
  versionEsperada: number,
  cambios: CambiosPedidosDeSucursal,
): Resultado<DecisionDeEdicion, ErrorAlEditar> {
  if (sucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (
    sucursal.nombre === cambios.nombre &&
    (cambios.horaDeCorte === undefined || sucursal.horaDeCorte === cambios.horaDeCorte) &&
    Object.keys(contactoQueCambia(sucursal.contacto, cambios.contacto ?? {})).length === 0
  ) {
    return ok("SIN_CAMBIOS");
  }
  return sucursal.version === versionEsperada ? ok("EDITAR") : err("VERSION_DESACTUALIZADA");
}
