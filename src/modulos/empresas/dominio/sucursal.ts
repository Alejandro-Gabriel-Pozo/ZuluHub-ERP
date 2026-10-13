import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { horaDelDiaDesdeTexto, type HoraDelDia } from "../../../primitivas/tiempo/hora-del-dia";

/**
 * Sucursal: un local de la empresa (H6, especificación §B.1). Puro: sin reloj ni azar. Una sucursal
 * nunca se borra: se desactiva, y una desactivada conserva su nombre (no se puede crear otra igual:
 * se la reactiva). La sucursal no tiene zona horaria propia: rige la de la empresa. Sí tiene su hora de
 * corte de la jornada (`horaDeCorte`, `00:00` por defecto): con la zona de la empresa fija la fecha de
 * negocio de caja, ventas y stock (conciliación §3.2).
 */
export type Sucursal = Readonly<{
  id: SucursalId;
  empresaId: EmpresaId;
  nombre: string;
  activa: boolean;
  horaDeCorte: HoraDelDia;
  version: number;
}>;

/** Lo que hace falta para fechar por jornada en una sucursal: la zona de su empresa y su hora de corte. */
export type DatosDeJornada = Readonly<{ zonaHoraria: string; horaDeCorte: HoraDelDia }>;

export type ErrorDeNombreDeSucursal = "NOMBRE_DE_SUCURSAL_INVALIDO";
export type ErrorDeHoraDeCorte = "HORA_DE_CORTE_INVALIDA";

export type ErrorDeSucursal =
  | ErrorDeNombreDeSucursal
  | ErrorDeHoraDeCorte
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

/** Caracteres de control (saltos de línea, tabuladores…): un nombre es una sola línea de texto. */
const CARACTER_DE_CONTROL = /\p{Cc}/u;

/**
 * El nombre limpio: normalizado (NFC, así "é" escrita de una o de dos piezas es el mismo nombre
 * para la unicidad), sin espacios en los extremos, no vacío, de hasta 100 caracteres y sin
 * caracteres de control.
 */
export function nombreDeSucursalValido(texto: string): Resultado<string, ErrorDeNombreDeSucursal> {
  const limpio = texto.normalize("NFC").trim();
  if (limpio === "") return err("NOMBRE_DE_SUCURSAL_INVALIDO");
  if ([...limpio].length > LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL) {
    return err("NOMBRE_DE_SUCURSAL_INVALIDO");
  }
  if (CARACTER_DE_CONTROL.test(limpio)) return err("NOMBRE_DE_SUCURSAL_INVALIDO");
  return ok(limpio);
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

/**
 * Editar el nombre y, si se pide, la hora de corte, con control de versión. Si lo pedido ya es lo que
 * hay (el nombre igual y la hora de corte omitida o igual) no hay nada que hacer, aunque la versión
 * sea otra: así repetir una edición que ya se aplicó (un corte de conexión) da el mismo resultado y no
 * un conflicto. Si no, la versión esperada tiene que ser la vigente. `horaDeCorte` omitida no la toca.
 */
export function decidirEdicion(
  sucursal: Sucursal | null,
  versionEsperada: number,
  nombre: string,
  horaDeCorte?: HoraDelDia,
): Resultado<DecisionDeEdicion, ErrorAlEditar> {
  if (sucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (
    sucursal.nombre === nombre &&
    (horaDeCorte === undefined || sucursal.horaDeCorte === horaDeCorte)
  ) {
    return ok("SIN_CAMBIOS");
  }
  return sucursal.version === versionEsperada ? ok("EDITAR") : err("VERSION_DESACTUALIZADA");
}
