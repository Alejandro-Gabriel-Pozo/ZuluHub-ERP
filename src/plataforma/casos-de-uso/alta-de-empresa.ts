import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ERRORES_DE_EMPRESAS_POR_RESTRICCION } from "../../modulos/empresas/publico";
import { ERRORES_DE_TENANT_POR_RESTRICCION } from "../../modulos/tenants/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { Tokens } from "../../puertos/tokens";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  validarAlta,
  type AltaValidada,
  type EntradaDeAlta,
  type ErrorDeValidacionDeAlta,
} from "../dominio/alta";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  crearAltaEnTransaccion,
  type CatalogoDeModulosDelAlta,
  type ErrorDelNucleo,
  type SalidaDelNucleo,
  type TxDeAlta,
} from "./alta-nucleo";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
} from "./caso-de-plataforma";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_ALTA_DE_EMPRESA = "empresas.alta";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_ALTA_DE_EMPRESA = {
  accion: "empresas.alta",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeAltaDeEmpresa = EntradaDeAlta &
  Readonly<{
    /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN crear otra empresa ni otro mail. */
    claveDeIdempotencia: string;
  }>;

export type SalidaDeAltaDeEmpresa = SalidaDelNucleo &
  Readonly<{
    /** `true` cuando esta llamada repite una anterior con la misma clave: no creó nada nuevo. */
    yaExistia: boolean;
  }>;

/** Los motivos de la base que este caso admite: el CUIT, la zona horaria, el modo de instalación, el tenant. */
const MOTIVOS_QUE_ADMITE = [
  "CUIT_INVALIDO",
  "CUIT_DUPLICADO",
  "RAZON_SOCIAL_INVALIDA",
  "ZONA_HORARIA_INVALIDA",
  "TENANT_NO_ACTIVO",
  "NOMBRE_INVALIDO",
  "INSTALACION_SINGLE_YA_TIENE_TENANT",
] as const;

type MotivoDeLaBase = (typeof MOTIVOS_QUE_ADMITE)[number];

export type ErrorAlDarDeAlta =
  ErrorComunDeCasoDePlataforma | ErrorDeValidacionDeAlta | ErrorDelNucleo | MotivoDeLaBase;

/** La restricción de la base que saltó, vuelta su motivo de negocio si este caso lo admite. */
function motivoDeLaBase(error: ErrorDePersistencia): MotivoDeLaBase | null {
  if (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") {
    return null;
  }
  if (error.restriccion === null) return null;
  const mapas = [ERRORES_DE_EMPRESAS_POR_RESTRICCION, ERRORES_DE_TENANT_POR_RESTRICCION];
  for (const mapa of mapas) {
    // `hasOwn`: un nombre como "constructor" no puede salir del prototipo del objeto.
    if (!Object.hasOwn(mapa, error.restriccion)) continue;
    const motivo = MOTIVOS_QUE_ADMITE.find((m) => m === mapa[error.restriccion as string]);
    if (motivo !== undefined) return motivo;
  }
  return null;
}

function traducirRestricciones<T, E>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
): Resultado<T, E | MotivoDeLaBase | ErrorDePersistencia> {
  if (resultado.ok) return resultado;
  const error = resultado.error;
  if (typeof error !== "object" || error === null || !("tipo" in error)) return resultado;
  const motivo = motivoDeLaBase(error);
  return motivo === null ? resultado : err(motivo);
}

export type DependenciasDeAltaDeEmpresa = DependenciasDeCasoDePlataforma<TxDeAlta> &
  Readonly<{
    /** Emite la invitación del gerente (id, token y hash); usa azar, así que se llama FUERA de la transacción. */
    tokens: Pick<Tokens, "emitir">;
    /** El catálogo de módulos con el que se activan los iniciales: el real en producción. */
    catalogoDeModulos: CatalogoDeModulosDelAlta;
  }>;

/**
 * Dar de alta una empresa (H5 §B.5.1, marcas y planes §B.10; tramos P5 y M6). Contexto de PLATAFORMA, solo
 * ADMIN (`empresas.alta`). Crea, en UNA transacción SERIALIZABLE y todo o nada:
 *
 *  - el tenant (si se pidió uno nuevo) con su MARCA, y su primera asignación de plan (la versión elegida o la
 *    última publicada del plan por defecto de la marca);
 *  - la empresa en `PROVISIONING`, con su sucursal «Casa central»;
 *  - los módulos iniciales de la marca que el plan incluye;
 *  - la invitación al primer gerente (la que ACTIVA la empresa cuando la acepte) y el trabajo que envía el
 *    mail, que sale desde la marca del tenant por la cola de trabajos, nunca desde esta transacción;
 *  - la auditoría de plataforma (con el actor del contexto) y la de la empresa.
 *
 * Con un tenant existente respeta la perilla `empresas_por_tenant` de su plan (`LIMITE_DEL_PLAN`).
 * Repetir la misma clave con los mismos datos devuelve lo mismo con `yaExistia: true` y no crea ni audita
 * nada; con otros datos es `CLAVE_REUTILIZADA`. Dos altas simultáneas con la misma clave: una crea y la
 * otra devuelve lo de la primera.
 */
export function armarAltaDeEmpresa(dependencias: DependenciasDeAltaDeEmpresa) {
  const { tokens, catalogoDeModulos } = dependencias;
  return async function altaDeEmpresa(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeAltaDeEmpresa,
  ): Promise<Resultado<SalidaDeAltaDeEmpresa, ErrorAlDarDeAlta>> {
    // Azar FUERA de la transacción: un reintento serializable la repite entera y tiene que usar la misma
    // invitación. Si la clave ya se usó, esta invitación simplemente no se usa.
    const emitida = tokens.emitir();
    const resultado = await ejecutarCasoDePlataforma<
      TxDeAlta,
      SalidaDeAltaDeEmpresa,
      AltaValidada,
      ErrorDeValidacionDeAlta | ErrorDelNucleo
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_ALTA_DE_EMPRESA.accion,
      operacion: OPERACION_ALTA_DE_EMPRESA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const alta = validarAlta(entrada);
        if (!alta.ok) return alta;
        const a = alta.valor;
        return ok({
          // La huella lleva lo ya normalizado: el mismo CUIT o el mismo email escritos distinto son el
          // mismo pedido; cualquier dato distinto es otro (y con la misma clave, CLAVE_REUTILIZADA).
          entrada: {
            tenantId: a.tenant.tipo === "EXISTENTE" ? a.tenant.tenantId : null,
            nombreDeTenant: a.tenant.tipo === "NUEVO" ? a.tenant.nombre : null,
            marcaId: a.tenant.tipo === "NUEVO" ? a.tenant.marcaId : null,
            versionDePlanId: a.tenant.tipo === "NUEVO" ? a.tenant.versionDePlanId : null,
            cuit: a.cuit,
            razonSocial: a.razonSocial,
            zonaHoraria: a.zonaHoraria,
            moneda: a.moneda,
            emailGerente: a.emailGerente,
          },
          valor: a,
        });
      },
      trabajar: async (tx, alta) => {
        const creado = await crearAltaEnTransaccion(tx, {
          contexto,
          catalogoDeModulos,
          alta,
          invitacion: { invitacionId: emitida.invitacionId, tokenHash: emitida.tokenHash },
        });
        if (!creado.ok) return creado;
        // Las constancias las deja el núcleo (también las usa el alta por solicitud).
        return ok({ salida: { ...creado.valor, yaExistia: false }, constancias: [] });
      },
      comoRepeticion: (guardado) => ({ ...guardado, yaExistia: true }),
    });
    return traducirRestricciones(resultado);
  };
}
