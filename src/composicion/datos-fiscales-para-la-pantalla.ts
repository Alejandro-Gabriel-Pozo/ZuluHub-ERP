/**
 * Lo que la pantalla de Datos fiscales recibe (D-43): el domicilio y los datos fiscales de un emisor, con Ingresos Brutos (D-115/D-116):
 * `iibbNumero` o `iibbCondicion: "NO_CONTRIBUYENTE"`. Viven acá porque `configuracion-fiscal-web.ts` está en el tope de tamaño (400 líneas).
 */

export type DomicilioParaLaPantalla = Readonly<{
  id: string;
  calle: string;
  numero: string;
  piso: string | null;
  departamento: string | null;
  localidad: string;
  /** El código de la provincia (`AR-B`). */
  provincia: string;
  codigoPostal: string | null;
}>;

/**
 * Los datos fiscales de un emisor: la versión que rige y el borrador en curso, con Ingresos Brutos (D-115/D-116): `iibbNumero` o
 * `iibbCondicion: "NO_CONTRIBUYENTE"`. Las condiciones anteriores (local, convenio multilateral, exento) no salen: llegan como `null`.
 */
export type DatosFiscalesParaLaPantalla = Readonly<{
  emisorId: string;
  /** El CUIT del emisor (D-65): 11 dígitos sin guiones, solo para leer; no se versiona con los datos. */
  cuit: string;
  vigente: Readonly<{
    id: string;
    numero: number;
    vigenteDesde: string;
    razonSocial: string;
    condicionIva: string;
    domicilio: DomicilioParaLaPantalla;
    inicioActividades: string;
    iibbNumero: string | null;
    iibbCondicion: "NO_CONTRIBUYENTE" | null;
  }> | null;
  borrador: Readonly<{
    /** La clave de idempotencia con la que se sigue guardando. */
    id: string;
    /** La versión que la pantalla manda en el próximo guardado. */
    version: number;
    razonSocial: string | null;
    condicionIva: string | null;
    domicilio: DomicilioParaLaPantalla | null;
    inicioActividades: string | null;
    iibbNumero: string | null;
    iibbCondicion: "NO_CONTRIBUYENTE" | null;
  }> | null;
}>;

/** De la condición guardada, solo la vigente sale a la pantalla; las anteriores (local, convenio multilateral, exento) salen `null`. */
export const condicionDeIibb = (condicion: string | null): "NO_CONTRIBUYENTE" | null =>
  condicion === "NO_CONTRIBUYENTE" ? condicion : null;
