import { vigenteEn } from "../../capacidades/planes/vigencia";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirArrepentimiento,
  decidirCondiciones,
  type OrigenDeAsignacion,
  type PoliticaDeCambioDePlan,
  type SentidoDelCambioDePlan,
} from "../../modulos/planes/publico";
import {
  tenantId as comoTenantId,
  versionDePlanId as comoVersionDePlanId,
  type VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../primitivas/tiempo/fecha-civil";
import { hoyEnArgentina } from "../../primitivas/tiempo/fecha-civil-hasta-hoy";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { sentidoDeCambiarDeVersion } from "./sentido-del-cambio";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";
import { LECTURA } from "./lectura-de-planes";

/** Los días del calendario de `desde` a `hasta` (fechas civiles `AAAA-MM-DD`: sin hora, zona ni horario de verano). */
function diasCivilesEntre(desde: FechaCivil, hasta: FechaCivil): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000,
  );
}

// --- condicionesDeCambioDePlan --------------------------------------------------------------------------

/** Hasta cuántas opciones (versiones de destino) se calculan en una lectura: las que muestra el formulario de cambio. */
export const MAXIMO_DE_OPCIONES_DE_CAMBIO = 100;

export type EntradaDeCondicionesDeCambioDePlan = Readonly<{
  tenantId: string;
  /** Las versiones de destino que ofrece el formulario de cambio (sentido y primera fecha válida de cada una). */
  versionesDePlanIds: readonly string[];
}>;

export type OpcionDeCambioDePlan = Readonly<{
  versionDePlanId: VersionDePlanId;
  sentido: SentidoDelCambioDePlan;
  /** La primera fecha en que ese cambio cumple la política vigente (hoy más la anticipación que corresponda). */
  primeraFechaValida: FechaCivil;
  /** Cuántos días hay de hoy a esa primera fecha (la anticipación que se le aplicó): la pantalla lo dice tal cual, sin calcularlo. */
  diasDeAnticipacion: number;
}>;

export type UltimoCambioDePlan = Readonly<{
  numero: number;
  origen: OrigenDeAsignacion;
  /** `null`: nació sin condiciones (anterior a la política, alta, migración de versión o un arrepentimiento). */
  sentido: SentidoDelCambioDePlan | null;
  /** Hasta qué día (inclusive) se puede deshacer; `null`: no se puede. */
  arrepentimientoHasta: FechaCivil | null;
  yaArrepentido: boolean;
  /** Lo decide `decidirArrepentimiento` con la fecha de hoy (Argentina): la pantalla solo lo muestra. */
  puedeDeshacerHoy: boolean;
  /** Por qué no se puede deshacer hoy (el código de H-14a); `null` si se puede. */
  motivoDeNoPoder:
    | "YA_ARREPENTIDO"
    | "NO_ES_EL_ULTIMO_CAMBIO"
    | "CAMBIO_SIN_ARREPENTIMIENTO"
    | "PLAZO_VENCIDO"
    | null;
  /** El plan al que vuelve la empresa si se deshace: lo que regiría sin ese cambio; `null` si no hay (no se puede deshacer). */
  vuelveA: Readonly<{ nombreComercial: string; versionNumero: number }> | null;
}>;

export type CondicionesDeCambioDePlan = Readonly<{
  /** El día de hoy en Argentina, con el que se decidió todo lo demás. */
  hoy: FechaCivil;
  politica: PoliticaDeCambioDePlan;
  /** `null`: el cliente no tiene ningún cambio. */
  ultimoCambio: UltimoCambioDePlan | null;
  /** Qué cambio nuevo nació de deshacer cuál (para nombrarlo en el historial). */
  arrepentimientos: readonly Readonly<{ numeroArrepentido: number; numeroNuevo: number }>[];
  /** Una por cada versión pedida, en el orden pedido. */
  opciones: readonly OpcionDeCambioDePlan[];
}>;

export type ErrorAlVerCondicionesDeCambioDePlan =
  | MotivoDeRechazo
  | "ID_INVALIDO"
  | "TENANT_NO_ENCONTRADO"
  | "VERSION_DE_PLAN_NO_ENCONTRADA"
  | "DEMASIADAS_OPCIONES"
  | ErrorDePersistencia;

/**
 * Lo que la consola necesita para mostrar el cambio de plan de un cliente SIN calcular nada: el sentido y la primera fecha válida de cada opción de cambio, y, del último cambio, hasta cuándo
 * se puede deshacer, si ya se deshizo y si se puede hoy. Usa las reglas de H-14a tal cual (`decidirCondiciones`, `decidirArrepentimiento`, `sentidoDeCambiarDeVersion`): no escribe ninguna regla nueva.
 * Todo sale del tenant pedido (el servidor lo lee por su id; no se acepta un número de cambio de afuera). `planes.ver`, solo lectura.
 */
export function armarCondicionesDeCambioDePlan({
  transacciones,
  reglas,
  catalogoDeModulos,
  catalogoDePerillas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function condicionesDeCambioDePlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCondicionesDeCambioDePlan,
  ): Promise<Resultado<CondicionesDeCambioDePlan, ErrorAlVerCondicionesDeCambioDePlan>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<CondicionesDeCambioDePlan, ErrorAlVerCondicionesDeCambioDePlan>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.condicionesDeCambioDePlan.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const id = uuidDesdeTexto(entrada.tenantId);
        if (!id.ok) return id;
        if (entrada.versionesDePlanIds.length > MAXIMO_DE_OPCIONES_DE_CAMBIO)
          return err("DEMASIADAS_OPCIONES");
        const destinos: VersionDePlanId[] = [];
        for (const texto of entrada.versionesDePlanIds) {
          const v = uuidDesdeTexto(texto);
          if (!v.ok) return v;
          destinos.push(comoVersionDePlanId(v.valor));
        }
        const tenant = comoTenantId(id.valor);
        if (!(await tx.planes.existeElTenant(tenant))) return err("TENANT_NO_ENCONTRADO");
        const hoy = hoyEnArgentina(contexto.ahora);
        // El instante del contexto es válido (lo firma la puerta): si no lo es, no se decide nada.
        if (!hoy.ok) throw new RangeError("el instante del contexto no tiene día de Argentina");
        const politica = (await tx.planes.politicasDeCambio()).at(-1);
        // La migración 0089 carga la versión 1: sin política la base está rota, no es un caso de negocio.
        if (politica === undefined)
          throw new RangeError("no hay política de cambio de plan cargada");

        const guardadas = await tx.planes.asignacionesDelTenant(tenant);
        const rige = vigenteEn(guardadas, contexto.ahora);
        const actual = rige === null ? null : await tx.planes.versionPorId(rige.versionDePlanId);

        const opciones: OpcionDeCambioDePlan[] = [];
        for (const versionDePlanId of destinos) {
          const destino = await tx.planes.versionPorId(versionDePlanId);
          if (destino === null) return err("VERSION_DE_PLAN_NO_ENCONTRADA");
          const sentido = sentidoDeCambiarDeVersion({
            actual,
            destino,
            catalogoDeModulos,
            catalogoDePerillas,
            ahora: contexto.ahora,
          });
          // Pedir «hoy»: si la política lo permite, es la primera fecha; si no, el rechazo trae la primera que sí.
          const decidida = decidirCondiciones({
            hoy: hoy.valor,
            vigenteDesde: hoy.valor,
            sentido,
            politica,
          });
          const primeraFechaValida = decidida.ok ? hoy.valor : decidida.error.primeraFechaValida;
          opciones.push({
            versionDePlanId,
            sentido,
            primeraFechaValida,
            diasDeAnticipacion: diasCivilesEntre(hoy.valor, primeraFechaValida),
          });
        }

        const arrepentimientos: { numeroArrepentido: number; numeroNuevo: number }[] = [];
        for (const a of guardadas) {
          const hecho = await tx.planes.arrepentimientoDe(tenant, a.numero);
          if (hecho !== null)
            arrepentimientos.push({
              numeroArrepentido: hecho.numeroArrepentido,
              numeroNuevo: hecho.numeroNuevo,
            });
        }

        const ultimo = guardadas.reduce<(typeof guardadas)[number] | null>(
          (m, a) => (m === null || a.numero > m.numero ? a : m),
          null,
        );
        let ultimoCambio: UltimoCambioDePlan | null = null;
        if (ultimo !== null) {
          const condiciones = await tx.planes.condicionesDeCambio(tenant, ultimo.numero);
          const yaArrepentido = arrepentimientos.some((a) => a.numeroArrepentido === ultimo.numero);
          const decision = decidirArrepentimiento({
            hoy: hoy.valor,
            esElUltimo: true,
            origen: ultimo.origen,
            condiciones,
            yaArrepentido,
          });
          // Vuelve a lo que regía antes del cambio: lo que rige hoy sin contar el que se deshace (igual que `arrepentirCambioDePlan`).
          const anterior = vigenteEn(
            guardadas.filter((a) => a.numero !== ultimo.numero),
            contexto.ahora,
          );
          ultimoCambio = {
            numero: ultimo.numero,
            origen: ultimo.origen,
            sentido: condiciones?.sentido ?? null,
            arrepentimientoHasta: condiciones?.arrepentimientoHasta ?? null,
            yaArrepentido,
            puedeDeshacerHoy: decision.ok && anterior !== null,
            motivoDeNoPoder: decision.ok ? null : decision.error.codigo,
            vuelveA:
              anterior === null
                ? null
                : {
                    nombreComercial: anterior.nombreComercial,
                    versionNumero: anterior.versionNumero,
                  },
          };
        }
        return ok({ hoy: hoy.valor, politica, ultimoCambio, arrepentimientos, opciones });
      },
    );
  };
}
