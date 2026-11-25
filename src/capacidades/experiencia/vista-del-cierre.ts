/** Los estados de la jornada y la severidad de un control, como los entrega el módulo del cierre (`EstadoConsultado`, `Severidad`): una capacidad no importa módulos; `lectura-del-cierre.ts` los asigna y `tsc` falla si dejan de coincidir. */
type EstadoConsultado = "ABIERTA" | "EN_AUDITORIA" | "CERRADA" | "SIN_ACTIVIDAD";
type Severidad = "BLOQUEA" | "RECONOCIBLE" | "INFORMA";

/**
 * LO QUE LA PANTALLA «CIERRE DEL DÍA» RECIBE: la forma de la vista que arma `src/composicion/lectura-del-cierre.ts` y que la pantalla de `apps/web` lee. Vive acá, y no en la composición,
 * porque la regla `composicion-solo-desde-servidor-de-apps` impide que un componente importe la composición (arma adaptadores y secretos); un tipo no los trae, pero la forma es la misma para los dos lados.
 * Solo tipos: sin lógica. Previene: la pantalla y la lectura con dos copias de la forma que se desfasan. Chequeo: `tsc` (los dos lados importan este archivo).
 */

export type ControlDelCierre = Readonly<{
  modulo: string;
  /** La clave del control del servidor (`caja.sesiones_sin_cerrar`): la pantalla la usa para elegir el texto aprobado. */
  clave: string;
  severidad: Severidad;
  cantidad: number;
  /** Solo en una jornada cerrada. */
  reconocido: boolean;
  /** El correo de quien lo reconoció (solo cerrada). */
  reconocidoPor: string | null;
  /** ISO UTC. */
  reconocidoEn: string | null;
  texto: string | null;
}>;

export type EstadoDeConteoDelCierre = "CONTADO" | "DECLARADO" | "CONFORME" | "SIN_DATO";

export type LineaDeConciliacionDelCierre = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  medioTipo: string;
  medioNombre: string | null;
  cuentaNombre: string | null;
  /** Importes en ARS como texto decimal (ADR-006). */
  registrado: string;
  correcciones: string;
  declarado: string | null;
  estadoDeConteo: EstadoDeConteoDelCierre;
  diferencia: string | null;
}>;

export type CobradoContraTicketDelCierre = Readonly<{
  /** El número del ticket; `null` si ventas no lo devuelve para esta jornada (el cobro es de un ticket de otro día). */
  ticketNumero: number | null;
  diferencia: string;
}>;

export type CobroDelCierre = Readonly<{
  cobroId: string;
  importe: string;
  /** Medio y cuenta VIGENTES (tras las correcciones). */
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  medioTipo: string;
  medioNombre: string | null;
  cuentaNombre: string | null;
  registradoPor: string | null;
  /** La jornada está en cierre y quien mira puede corregir: la misma regla del caso de uso (la pantalla no decide). */
  correccionPosible: boolean;
  ultimaCorreccion: Readonly<{ por: string | null; en: string; motivo: string }> | null;
}>;

/** Un medio activo y las cuentas de cobro activas de la sucursal que admite: las opciones del diálogo «Corregir medio». */
export type MedioParaCorregir = Readonly<{
  medioDePagoId: string;
  tipo: string;
  nombre: string | null;
  cuentas: readonly Readonly<{ cuentaDeCobroId: string; nombre: string }>[];
}>;

export type CierreParaLaPantalla = Readonly<{
  /** `AAAA-MM-DD`: la jornada que se opera. */
  fechaDeNegocio: string;
  estado: EstadoConsultado;
  cerradaPor: string | null;
  cerradaEn: string | null;
  /** Lo que `cerrarJornada` vuelve a comparar: nada se cierra con algo que nadie vio. */
  huella: string;
  controles: readonly ControlDelCierre[];
  /** Solo con la jornada en cierre o cerrada. */
  conciliacion: Readonly<{
    enVivo: boolean;
    lineas: readonly LineaDeConciliacionDelCierre[];
    cobradoContraTicket: readonly CobradoContraTicketDelCierre[];
  }> | null;
  /** Solo con la jornada en cierre o cerrada: la primera página (hasta 100). */
  cobros: Readonly<{ cobros: readonly CobroDelCierre[]; hayMas: boolean }> | null;
  /** Solo con la jornada en cierre y algún cobro corregible. */
  medios: readonly MedioParaCorregir[];
}>;
