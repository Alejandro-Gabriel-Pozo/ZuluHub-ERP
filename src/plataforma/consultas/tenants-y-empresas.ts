import { esClaveDe } from "../../capacidades/modulos/activos";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import { derechosDeUso, valorDePerilla } from "../../capacidades/planes/derechos";
import type { DefinicionDePerilla } from "../../capacidades/planes/perillas";
import type { ValorDePerilla } from "../../capacidades/planes/valores";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { estadoEfectivo, type EstadoDeEmpresa } from "../../contexto/estados";
import { TRANSICIONES_DE_EMPRESA } from "../../modulos/empresas/publico";
import { interpretarAjustes } from "../../modulos/planes/publico";
import {
  marcaComercialId,
  planId as comoPlanId,
  tenantId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { vistaDeAlta, type VistaDeAlta } from "../dominio/soporte/altas";
import {
  combinacionesDeEstadoEfectivo,
  criterioDeBusqueda,
  esEstadoEfectivo,
  paginaValida,
  resultadoDePagina,
  uuidDesdeTexto,
  type CombinacionDeEstados,
  type EntradaDePagina,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type {
  AjusteDeUnTenant,
  DependenciasDeConsultasDePlataforma,
  EntradaDeListarEmpresas,
  EntradaDeListarTenants,
  FilaDeEmpresaAmpliada,
  FilaDeTenant,
  VistaDeEmpresa,
  VistaDeTenant,
} from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

export type ErrorAlListarTenants =
  MotivoDeRechazo | ErrorDePagina | "ID_INVALIDO" | "FILTRO_INVALIDO" | ErrorDePersistencia;

/** La perilla que topa cuántas empresas puede tener un tenant (la que verifica el alta de empresa). */
const PERILLA_DEL_TOPE_DE_EMPRESAS = "empresas_por_tenant";

/**
 * Los tenants con su estado, su marca, su plan vigente y cuántas empresas ocupan lugar frente al tope
 * (§B.5.9, nivel 1; ampliada para la consola). `tenants.ver`, solo lectura, página por id.
 *
 * Son DOS lecturas en lote, no una por fila: la página con sus joins (marca, plan vigente, empresas en uso) y
 * los ajustes de la perilla del tope de todos los tenants de la página. El límite efectivo lo resuelve
 * `derechosDeUso`, el mismo cálculo que ve la propia empresa y el alta: el ajuste vigente del tenant, si no
 * lo que fija la versión de plan, si no la base del catálogo.
 */
export function armarListarTenants({
  transacciones,
  reglas,
  catalogoDePerillas,
}: DependenciasDeConsultasDePlataforma) {
  // Solo la perilla del tope: no hace falta resolver las demás para mostrar este número.
  const definicionDelTope = Object.hasOwn(catalogoDePerillas, PERILLA_DEL_TOPE_DE_EMPRESAS)
    ? catalogoDePerillas[PERILLA_DEL_TOPE_DE_EMPRESAS]
    : undefined;
  const tope =
    definicionDelTope === undefined ? null : { [PERILLA_DEL_TOPE_DE_EMPRESAS]: definicionDelTope };
  return async function listarTenants(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeListarTenants,
  ): Promise<Resultado<ResultadoDePagina<VistaDeTenant>, ErrorAlListarTenants>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<VistaDeTenant>,
          Exclude<ErrorAlListarTenants, ErrorDePersistencia>
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarTenants.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const marca = idOpcional(entrada.marcaId, marcaComercialId);
        if (!marca.ok) return marca;
        const plan = idOpcional(entrada.planId, comoPlanId);
        if (!plan.ok) return plan;
        const buscar = criterioDeBusqueda(entrada.buscar);
        if (!buscar.ok) return buscar;
        const filas = await tx.soporte.listarTenants(
          { marcaId: marca.valor, planId: plan.valor, buscar: buscar.valor },
          pagina.valor,
          contexto.ahora,
        );
        const ajustes =
          tope === null || filas.length === 0
            ? []
            : await tx.soporte.ajustesDeTenants(
                filas.map((f) => f.id),
                PERILLA_DEL_TOPE_DE_EMPRESAS,
              );
        const vistas = filas.map((fila) =>
          conLimiteDeEmpresas(
            fila,
            tope,
            ajustes.filter((a) => a.tenantId === fila.id),
            contexto.ahora,
          ),
        );
        return ok(resultadoDePagina(vistas, pagina.valor, (f) => f.id));
      },
    );
  };
}

/** Un id opcional: ausente es «sin filtro»; presente tiene que ser un uuid (`ID_INVALIDO`). */
function idOpcional<T>(
  texto: string | undefined,
  comoId: (uuid: string) => T,
): Resultado<T | null, "ID_INVALIDO"> {
  if (texto === undefined) return ok(null);
  const id = uuidDesdeTexto(texto);
  return id.ok ? ok(comoId(id.valor)) : id;
}

/** El tenant con el límite de empresas que le rige, resuelto con el plan vigente y los ajustes de su tope. */
function conLimiteDeEmpresas(
  fila: FilaDeTenant,
  tope: Readonly<Record<string, DefinicionDePerilla>> | null,
  ajustes: readonly AjusteDeUnTenant[],
  ahora: Date,
): VistaDeTenant {
  const { perillasDelPlan, ...resto } = fila;
  if (tope === null) return { ...resto, limiteDeEmpresas: null };
  const derechos = derechosDeUso({
    catalogoDeModulos: {},
    catalogoDePerillas: tope,
    tenantId: fila.id,
    empresaId: null,
    versionDePlan:
      fila.planId === null || fila.versionDePlanId === null || fila.planVersionNumero === null
        ? null
        : {
            planId: fila.planId,
            versionDePlanId: fila.versionDePlanId,
            numero: fila.planVersionNumero,
            modulos: [],
            perillas: (perillasDelPlan ?? {}) as Readonly<Record<string, ValorDePerilla>>,
          },
    ajustes: interpretarAjustes(tope, ajustes),
    ahora,
  });
  const valor = valorDePerilla(derechos, PERILLA_DEL_TOPE_DE_EMPRESAS);
  return { ...resto, limiteDeEmpresas: valor.tipo === "LIMITE" ? valor.limite : null };
}

export type ErrorAlListarEmpresas =
  | MotivoDeRechazo
  | ErrorDePagina
  | "ID_INVALIDO"
  | "ESTADO_INVALIDO"
  | "ESTADO_EFECTIVO_INVALIDO"
  | "FILTRO_INVALIDO"
  | ErrorDePersistencia;

const conEstadoEfectivo = (fila: FilaDeEmpresaAmpliada): VistaDeEmpresa => ({
  ...fila,
  estadoEfectivo: estadoEfectivo(fila.estadoDelTenant, fila.estado),
});

/**
 * Las empresas con su estado y su estado efectivo, el nombre de su tenant, su marca y su plan vigente
 * (§B.5.9, nivel 1; ampliada para la consola). `empresas.ver`. UNA sentencia con joins para toda la página.
 * Los criterios se suman con Y; sin ninguno, la lista es la de siempre.
 */
export function armarListarEmpresas({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarEmpresas(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeListarEmpresas,
  ): Promise<Resultado<ResultadoDePagina<VistaDeEmpresa>, ErrorAlListarEmpresas>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<VistaDeEmpresa>,
          Exclude<ErrorAlListarEmpresas, ErrorDePersistencia>
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarEmpresas.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const tenant = idOpcional(entrada.tenantId, tenantId);
        if (!tenant.ok) return tenant;
        let estado: EstadoDeEmpresa | null = null;
        if (entrada.estado !== undefined) {
          if (!esClaveDe(TRANSICIONES_DE_EMPRESA, entrada.estado)) return err("ESTADO_INVALIDO");
          estado = entrada.estado;
        }
        const marca = idOpcional(entrada.marcaId, marcaComercialId);
        if (!marca.ok) return marca;
        const plan = idOpcional(entrada.planId, comoPlanId);
        if (!plan.ok) return plan;
        let estadosEfectivos: readonly CombinacionDeEstados[] | null = null;
        if (entrada.estadoEfectivo !== undefined) {
          if (!esEstadoEfectivo(entrada.estadoEfectivo)) return err("ESTADO_EFECTIVO_INVALIDO");
          estadosEfectivos = combinacionesDeEstadoEfectivo(entrada.estadoEfectivo);
        }
        const buscar = criterioDeBusqueda(entrada.buscar);
        if (!buscar.ok) return buscar;
        const filas = await tx.soporte.listarEmpresas(
          {
            tenantId: tenant.valor,
            estado,
            marcaId: marca.valor,
            planId: plan.valor,
            estadosEfectivos,
            buscar: buscar.valor,
          },
          pagina.valor,
          contexto.ahora,
        );
        return ok(resultadoDePagina(filas.map(conEstadoEfectivo), pagina.valor, (f) => f.id));
      },
    );
  };
}

export type ErrorAlListarAltasPendientes = MotivoDeRechazo | ErrorDePagina | ErrorDePersistencia;

/**
 * Las altas que siguen pendientes (empresas en `PROVISIONING`): cómo está la invitación del gerente
 * (vigente, vencida, sin invitación…) y cuántas horas faltan para que venza el alta (§B.5.9, nivel 1).
 * `empresas.ver`. La hora sale del contexto.
 */
export function armarListarAltasPendientes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarAltasPendientes(
    contexto: ContextoDePlataforma,
    entrada: EntradaDePagina,
  ): Promise<Resultado<ResultadoDePagina<VistaDeAlta>, ErrorAlListarAltasPendientes>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<ResultadoDePagina<VistaDeAlta>, MotivoDeRechazo | ErrorDePagina>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarAltasPendientes.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const altas = await tx.soporte.listarAltasPendientes(pagina.valor);
        const vistas = altas.map(({ empresa, invitacion }) =>
          vistaDeAlta(empresa, invitacion, contexto.ahora),
        );
        return ok(resultadoDePagina(vistas, pagina.valor, (v) => v.empresaId));
      },
    );
  };
}
