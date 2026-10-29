import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeWeb } from "./accion-de-web";
import {
  entradaDeConfirmarDatosFiscales,
  entradaDeCrearPuntoDeVenta,
  entradaDeEditarPuntoDeVenta,
  entradaDeEmisor,
  entradaDeEmpezarCorreccion,
  entradaDeGuardarBorrador,
  entradaDePuntoDeVenta,
} from "./entradas-de-configuracion-fiscal";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";
import type { Web } from "./web";

/**
 * Lo que hace la web en la pantalla de Configuración fiscal (D-43: «lista de lo que falta + una pantalla por tema»; solo el
 * gerente; carga a mano, sin padrón de ARCA ni segundo factor): la lista de lo que falta, los datos fiscales (ver, guardar a mano,
 * empezar a corregir lo confirmado y confirmar) y los puntos de venta (ver, crear, editar, activar y desactivar). El estado del certificado está en
 * `certificado-de-arca-web.ts`. El cambio de
 * ambiente de un punto de venta (D-48) ya está en `facturacion-web.ts` (`cambiarAmbienteDePuntoDeVenta`). Vive acá, y no en
 * `apps/web`, por la misma razón que `facturacion-web.ts`: probarse con la base real sin levantar Next.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/fiscal-configuracion-web.test.ts`):
 *  - **El servidor decide quién y dónde.** El `contexto` es lo único que dice la empresa y la persona. Cada caso de uso y cada
 *    consulta exige SU acción al guard (solo el gerente, `administracion`) dentro de su transacción: acá no se decide permiso.
 *  - **Repetir no duplica.** Guardar el borrador con el mismo `borradorId` y el mismo contenido, crear un punto de venta con el
 *    mismo `id`, confirmar dos veces, activar o desactivar dos veces: «ya estaba» o «ya existía», sin escribir ni auditar.
 *  - **Dos a la vez no se pisan.** El borrador y el punto de venta llevan su versión: quien editó con una versión vieja recibe
 *    `FISCAL_VERSION_DESACTUALIZADA` y no pisa lo del otro.
 *  - **Ingresos Brutos no existe para la pantalla (D-45).** Ni se pide ni se muestra: el backend los guarda vacíos.
 *  - **Nada secreto.** De los certificados solo sale su situación y su vencimiento: nunca la clave, el pedido (CSR), el PEM
 *    ni la huella.
 *  - **Todo resultado sale por `aRespuestaFiscal`** (ADR-016). Los textos de los errores de esta pantalla que el dueño todavía
 *    no aprobó no se inventan: ver `CODIGOS_DE_CONFIGURACION_SIN_TEXTO` en `errores-fiscales.ts`.
 *
 * Los instantes salen como texto ISO 8601 en UTC (la pantalla los muestra en la zona de Argentina); las fechas civiles
 * (el inicio de actividades), como `AAAA-MM-DD`.
 */

export type DependenciasDeConfiguracionFiscalWeb = Readonly<{
  casosDeUso: () => ReturnType<Web["casosDeUsoDeConfiguracionFiscal"]>;
  consultas: () => ReturnType<Web["consultasDeFacturacion"]>;
  respuesta: DependenciasDeRespuesta;
}>;

const accion = <E, S, D>(
  d: DependenciasDeConfiguracionFiscalWeb,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> => accionDeWeb(d.respuesta, crudo, leer, correr, presentar);

const iso = (instante: Date): string => instante.toISOString();

// ---------------------------------------------------------------------------------------------------------------
// La lista de lo que falta
// ---------------------------------------------------------------------------------------------------------------

/** La lista de Configuración fiscal: el estado de las tres filas. Dice hechos; qué texto lleva cada uno lo decide la pantalla. */
export type EstadoDeLaConfiguracionParaLaPantalla = Readonly<{
  /** El emisor principal (D-47): el que reciben las pantallas de cada tema. */
  emisorId: string;
  datosFiscales: Readonly<{
    /** `VIGENTES` rige una versión confirmada; `BORRADOR` hay uno sin confirmar; `SOLO_FUTUROS` rigen más adelante; `SIN_CARGAR` nada. */
    estado: "VIGENTES" | "BORRADOR" | "SOLO_FUTUROS" | "SIN_CARGAR";
  }>;
  puntosDeVenta: Readonly<{
    /** `CON_ACTIVOS` al menos uno activo; `SIN_ACTIVOS` hay pero todos inactivos; `SIN_PUNTOS` ninguno. */
    estado: "CON_ACTIVOS" | "SIN_ACTIVOS" | "SIN_PUNTOS";
    total: number;
    activos: number;
    /** Los ambientes de los puntos de venta activos, sin repetir: de cuáles se necesita certificado. */
    ambientesEnUso: readonly ("HOMOLOGACION" | "PRODUCCION")[];
  }>;
  /** Una situación por ambiente (homologación y producción). */
  certificados: readonly Readonly<{
    ambiente: "HOMOLOGACION" | "PRODUCCION";
    situacion: "FALTA_CARGAR" | "PEDIDO_GENERADO" | "VIGENTE";
    /** Solo con certificado vigente. */
    venceEn: string | null;
    vencido: boolean;
  }>[];
}>;

/** Quién puede verla: el gerente (`datos_fiscales.editar`). Sin entrada: el emisor es el principal de la empresa del contexto. */
export function estadoDeLaConfiguracionFiscal(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<EstadoDeLaConfiguracionParaLaPantalla>> {
  return accion(
    d,
    null,
    () => ok(null),
    () => d.consultas().estadoDeLaConfiguracionFiscal(contexto),
    // Lista blanca, campo por campo.
    (e) => ({
      emisorId: e.emisorId,
      datosFiscales: { estado: e.datosFiscales.estado },
      puntosDeVenta: {
        estado: e.puntosDeVenta.estado,
        total: e.puntosDeVenta.total,
        activos: e.puntosDeVenta.activos,
        ambientesEnUso: e.puntosDeVenta.ambientesEnUso,
      },
      certificados: e.certificados.map((c) => ({
        ambiente: c.ambiente,
        situacion: c.situacion,
        venceEn: c.venceEn === null ? null : iso(c.venceEn),
        vencido: c.vencido,
      })),
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Datos fiscales
// ---------------------------------------------------------------------------------------------------------------

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

/** Los datos fiscales de un emisor: la versión que rige y el borrador en curso. Sin Ingresos Brutos (D-45). */
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
  }> | null;
}>;

const aDomicilio = (d: DomicilioParaLaPantalla): DomicilioParaLaPantalla => ({
  id: d.id,
  calle: d.calle,
  numero: d.numero,
  piso: d.piso,
  departamento: d.departamento,
  localidad: d.localidad,
  provincia: d.provincia,
  codigoPostal: d.codigoPostal,
});

/** `crudo`: `{ emisorId }`. */
export function datosFiscalesDelEmisor(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<DatosFiscalesParaLaPantalla>> {
  return accion(
    d,
    crudo,
    entradaDeEmisor,
    (entrada) => d.consultas().datosFiscalesDelEmisor(contexto, entrada),
    (datos) => ({
      emisorId: datos.emisorId,
      cuit: datos.cuit,
      vigente:
        datos.vigente === null
          ? null
          : {
              id: datos.vigente.id,
              numero: datos.vigente.numero,
              vigenteDesde: iso(datos.vigente.vigenteDesde),
              razonSocial: datos.vigente.razonSocial,
              condicionIva: datos.vigente.condicionIva,
              domicilio: aDomicilio(datos.vigente.domicilio),
              inicioActividades: datos.vigente.inicioActividades,
            },
      borrador:
        datos.borrador === null
          ? null
          : {
              id: datos.borrador.id,
              version: datos.borrador.version,
              razonSocial: datos.borrador.razonSocial,
              condicionIva: datos.borrador.condicionIva,
              domicilio:
                datos.borrador.domicilio === null ? null : aDomicilio(datos.borrador.domicilio),
              inicioActividades: datos.borrador.inicioActividades,
            },
    }),
  );
}

/**
 * Guardar a mano el borrador de los datos fiscales (`datos_fiscales.editar`). `crudo`: `{ emisorId, borradorId, versionEsperada?,
 * razonSocial?, condicionIva?, inicioActividades?, domicilio? }`, con el domicilio `{ tipo: "NUEVO", id, calle, numero, piso?,
 * departamento?, localidad, provincia, codigoPostal? }` o `{ tipo: "EXISTENTE", id }`. Un campo ausente no se toca. Al crearlo no
 * hace falta `versionEsperada`; al cambiar uno que ya existe, es la que vio la pantalla.
 */
export function guardarBorradorDeDatosFiscales(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ borradorId: string; version: number; yaEstaba: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeGuardarBorrador,
    (entrada) => d.casosDeUso().guardarBorradorDeDatosFiscales(contexto, entrada),
    (s) => ({ borradorId: s.borradorId, version: s.version, yaEstaba: s.yaEstaba }),
  );
}

/**
 * Empezar a corregir los datos ya confirmados (`datos_fiscales.editar`; D-62: la pantalla precarga lo vigente y se confirma de
 * nuevo, lo que deja una versión nueva): crea el borrador del emisor a partir de la versión que rige. El borrador es del emisor,
 * no de la pestaña: si ya hay uno (de esta u otra pantalla), devuelve ese con `yaEstaba: true` y la pantalla sigue con él. Sin versión
 * que rija, `FISCAL_SIN_DATOS_FISCALES`: se empieza de cero con `guardarBorradorDeDatosFiscales`. `crudo`: `{ emisorId, borradorId }`;
 * `borradorId` lo genera la pantalla y es la clave de idempotencia.
 */
export function empezarCorreccionDeDatosFiscales(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ borradorId: string; version: number; yaEstaba: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeEmpezarCorreccion,
    (entrada) => d.casosDeUso().empezarCorreccionDeDatosFiscales(contexto, entrada),
    (s) => ({ borradorId: s.borradorId, version: s.version, yaEstaba: s.yaEstaba }),
  );
}

/**
 * Confirmar los datos fiscales (`datos_fiscales.confirmar`): el borrador pasa a una versión inmutable que rige desde ya, con el
 * instante del servidor (D-61: un solo botón «Confirmar», sin fecha de vigencia elegible; un `vigenteDesde` en el pedido se descarta).
 * `crudo`: `{ emisorId, borradorId, versionEsperada, motivo }`. Con datos obligatorios sin cargar responde `FISCAL_DATOS_INVALIDOS`
 * con el primer campo que falta.
 */
export function confirmarDatosFiscales(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<
  Respuesta<
    Readonly<{ borradorId: string; numero: number; vigenteDesde: string; yaEstaba: boolean }>
  >
> {
  return accion(
    d,
    crudo,
    (c) => entradaDeConfirmarDatosFiscales(c, contexto.ahora),
    (entrada) => d.casosDeUso().confirmarDatosFiscales(contexto, entrada),
    (s) => ({
      borradorId: s.borradorId,
      numero: s.numero,
      vigenteDesde: iso(s.vigenteDesde),
      yaEstaba: s.yaEstaba,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Puntos de venta
// ---------------------------------------------------------------------------------------------------------------

/** Los puntos de venta de un emisor, activos o no, de menor a mayor número. */
export type PuntosDeVentaParaConfigurar = Readonly<{
  emisorId: string;
  items: readonly Readonly<{
    id: string;
    numero: number;
    activo: boolean;
    /** `HOMOLOGACION` (pruebas) o `PRODUCCION`: se cambia con `cambiarAmbienteDePuntoDeVenta` (D-48). */
    ambiente: "HOMOLOGACION" | "PRODUCCION";
    sucursal: Readonly<{ id: string; nombre: string; activa: boolean }>;
    tieneDomicilio: boolean;
    /** El domicilio del punto de venta (D-63), con la misma forma que el de Datos fiscales; `null` si no tiene. */
    domicilio: DomicilioParaLaPantalla | null;
    /** `true`: ya usó números, así que su número no se puede cambiar. */
    hayNumerosUsados: boolean;
    version: number;
  }>[];
}>;

/** `crudo`: `{ emisorId }`. */
export function puntosDeVentaDelEmisor(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<PuntosDeVentaParaConfigurar>> {
  return accion(
    d,
    crudo,
    entradaDeEmisor,
    (entrada) => d.consultas().puntosDeVentaDelEmisor(contexto, entrada),
    (p) => ({
      emisorId: p.emisorId,
      items: p.items.map((i) => ({
        id: i.id,
        numero: i.numero,
        activo: i.activo,
        ambiente: i.ambiente,
        sucursal: { id: i.sucursal.id, nombre: i.sucursal.nombre, activa: i.sucursal.activa },
        tieneDomicilio: i.tieneDomicilio,
        domicilio: i.domicilio === null ? null : aDomicilio(i.domicilio),
        hayNumerosUsados: i.hayNumerosUsados,
        version: i.version,
      })),
    }),
  );
}

/**
 * Dar de alta un punto de venta (`puntos_de_venta.crear`): nace inactivo y en pruebas. `crudo`: `{ id, emisorId, sucursalId,
 * numero, domicilio? }`; `id` lo genera la pantalla y es la clave de idempotencia.
 */
export function crearPuntoDeVenta(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ puntoDeVentaId: string; version: number; yaExistia: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeCrearPuntoDeVenta,
    (entrada) => d.casosDeUso().crearPuntoDeVenta(contexto, entrada),
    (s) => ({ puntoDeVentaId: s.puntoDeVentaId, version: s.version, yaExistia: s.yaExistia }),
  );
}

/** Cambiar el número, la sucursal o el domicilio (`puntos_de_venta.editar`). `crudo`: `{ puntoDeVentaId, versionEsperada, numero?, sucursalId?, domicilio? }`. */
export function editarPuntoDeVenta(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number; sinCambios: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeEditarPuntoDeVenta,
    (entrada) => d.casosDeUso().editarPuntoDeVenta(contexto, entrada),
    (s) => ({ version: s.version, sinCambios: s.sinCambios }),
  );
}

/** Activar un punto de venta (`puntos_de_venta.activar`). `crudo`: `{ puntoDeVentaId }`. */
export function activarPuntoDeVenta(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDePuntoDeVenta,
    (entrada) => d.casosDeUso().activarPuntoDeVenta(contexto, entrada),
    (s) => ({ yaEstaba: s.yaEstaba }),
  );
}

/** Dar de baja (desactivar) un punto de venta (`puntos_de_venta.desactivar`): nada se borra. `crudo`: `{ puntoDeVentaId }`. */
export function desactivarPuntoDeVenta(
  d: DependenciasDeConfiguracionFiscalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDePuntoDeVenta,
    (entrada) => d.casosDeUso().desactivarPuntoDeVenta(contexto, entrada),
    (s) => ({ yaEstaba: s.yaEstaba }),
  );
}
