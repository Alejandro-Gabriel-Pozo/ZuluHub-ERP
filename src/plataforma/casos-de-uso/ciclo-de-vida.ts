import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../contexto/estados";
import {
  cambiarEstado,
  type CambioDeEstadoDeEmpresa,
  type Empresa,
  type ErrorDeEmpresa,
  type RepositorioDeEmpresas,
} from "../../modulos/empresas/publico";
import {
  reactivar,
  suspender,
  type CambioDeEstadoDeTenant,
  type ErrorDeTenant,
  type RepositorioDeTenants,
  type Tenant,
} from "../../modulos/tenants/publico";
import {
  empresaId as aEmpresaId,
  tenantId as aTenantId,
  type EmpresaId,
  type TenantId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { decidirReactivacionDeEmpresa } from "../dominio/ciclo-de-vida";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type TxDeCasoDePlataforma,
} from "./caso-de-plataforma";

/**
 * Suspender y reactivar un tenant o una empresa desde plataforma (H5 §B.5.2). Solo ADMIN. La suspensión
 * lleva un motivo obligatorio y no borra nada: detiene a la empresa (o a todas las del tenant) en la
 * operación siguiente, porque cada caso de uso lee el estado dentro de su transacción. Reactivar vuelve a
 * ACTIVE y borra el motivo. Cada cambio deja su constancia con el estado y el motivo de antes y de después.
 * Repetir la misma clave devuelve lo mismo; pedir un cambio que ya está hecho con otra clave es un error
 * (`TENANT_YA_SUSPENDIDO`, `TENANT_NO_SUSPENDIDO`, `TRANSICION_NO_PERMITIDA`), no un éxito vacío.
 */

export type TxDeCicloDeVida = TxDeCasoDePlataforma &
  Readonly<{
    tenants: RepositorioDeTenants;
    empresas: RepositorioDeEmpresas;
  }>;

export type DependenciasDeCicloDeVida = DependenciasDeCasoDePlataforma<TxDeCicloDeVida>;

export const OPERACIONES_DE_CICLO_DE_VIDA = {
  suspenderTenant: "tenants.suspender",
  reactivarTenant: "tenants.reactivar",
  suspenderEmpresa: "empresas.suspender",
  reactivarEmpresa: "empresas.reactivar",
} as const;

export const DECLARACIONES_DE_CICLO_DE_VIDA = {
  suspenderTenant: { accion: "tenants.suspender" },
  reactivarTenant: { accion: "tenants.reactivar" },
  suspenderEmpresa: { accion: "empresas.suspender" },
  reactivarEmpresa: { accion: "empresas.reactivar" },
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

// ---- tenant -------------------------------------------------------------------------------------------

export type EntradaDeSuspenderTenant = Readonly<{
  claveDeIdempotencia: string;
  tenantId: string;
  /** Obligatorio: por qué se suspende. Se guarda como motivo del tenant y en la constancia. */
  motivo: string;
}>;
export type EntradaDeReactivarTenant = Readonly<{
  claveDeIdempotencia: string;
  tenantId: string;
}>;

export type SalidaDeCambioDeTenant = Readonly<{
  tenantId: TenantId;
  /** El estado en que quedó el tenant. */
  estado: EstadoDeTenant;
  /** `true` cuando esta llamada repite una anterior con la misma clave: no cambió nada. */
  repetida: boolean;
}>;

export type ErrorAlCambiarElTenant =
  | ErrorComunDeCasoDePlataforma
  | ErrorDeTenant
  | "ID_INVALIDO"
  | "TENANT_NO_ENCONTRADO"
  | "VERSION_DESACTUALIZADA";

const datosDelTenant = (t: Pick<Tenant, "estado" | "motivoEstado">) => ({
  estado: t.estado,
  motivo: t.motivoEstado,
});

function armarCambioDeTenant<Entrada extends { claveDeIdempotencia: string; tenantId: string }>(
  dependencias: DependenciasDeCicloDeVida,
  definicion: Readonly<{
    declaracion: DeclaracionDeAccionDePlataforma;
    operacion: string;
    constancia: AccionDePlataforma;
    /** Lo que la entrada aporta a la decisión y a la huella (el motivo, si lo lleva). */
    extras: (entrada: Entrada) => Readonly<{ motivo: string }> | null;
    decidir: (
      tenant: Tenant,
      extras: Readonly<{ motivo: string }> | null,
    ) => Resultado<CambioDeEstadoDeTenant, ErrorDeTenant>;
  }>,
) {
  return async function cambiarTenant(
    contexto: ContextoDePlataforma,
    entrada: Entrada,
  ): Promise<Resultado<SalidaDeCambioDeTenant, ErrorAlCambiarElTenant>> {
    return ejecutarCasoDePlataforma<
      TxDeCicloDeVida,
      SalidaDeCambioDeTenant,
      TenantId,
      Exclude<ErrorAlCambiarElTenant, ErrorComunDeCasoDePlataforma>
    >(dependencias, {
      contexto,
      accion: definicion.declaracion.accion,
      operacion: definicion.operacion,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const id = uuidDesdeTexto(entrada.tenantId);
        if (!id.ok) return id;
        const extras = definicion.extras(entrada);
        return ok({
          entrada: { tenantId: id.valor, motivo: extras === null ? null : extras.motivo },
          valor: aTenantId(id.valor),
        });
      },
      trabajar: async (tx, id) => {
        const tenant = await tx.tenants.obtener(id);
        if (tenant === null) return err("TENANT_NO_ENCONTRADO");
        const cambio = definicion.decidir(tenant, definicion.extras(entrada));
        if (!cambio.ok) return cambio;
        const hecho = await tx.tenants.cambiarEstado(id, tenant.version, cambio.valor);
        if (!hecho.ok) return err("VERSION_DESACTUALIZADA");
        return ok({
          salida: { tenantId: id, estado: hecho.tenant.estado, repetida: false },
          constancias: [
            {
              accion: definicion.constancia,
              entidad: "tenant",
              entidadId: id,
              antes: datosDelTenant(tenant),
              despues: datosDelTenant(hecho.tenant),
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
    });
  };
}

export const armarSuspenderTenant = (d: DependenciasDeCicloDeVida) =>
  armarCambioDeTenant<EntradaDeSuspenderTenant>(d, {
    declaracion: DECLARACIONES_DE_CICLO_DE_VIDA.suspenderTenant,
    operacion: OPERACIONES_DE_CICLO_DE_VIDA.suspenderTenant,
    constancia: "TENANT_SUSPENDIDO",
    extras: (entrada) => ({ motivo: entrada.motivo.trim() }),
    decidir: (tenant, extras) => suspender(tenant, extras?.motivo ?? ""),
  });

export const armarReactivarTenant = (d: DependenciasDeCicloDeVida) =>
  armarCambioDeTenant<EntradaDeReactivarTenant>(d, {
    declaracion: DECLARACIONES_DE_CICLO_DE_VIDA.reactivarTenant,
    operacion: OPERACIONES_DE_CICLO_DE_VIDA.reactivarTenant,
    constancia: "TENANT_REACTIVADO",
    extras: () => null,
    decidir: (tenant) => reactivar(tenant),
  });

// ---- empresa ------------------------------------------------------------------------------------------

export type EntradaDeSuspenderEmpresa = Readonly<{
  claveDeIdempotencia: string;
  empresaId: string;
  motivo: string;
}>;
export type EntradaDeReactivarEmpresa = Readonly<{
  claveDeIdempotencia: string;
  empresaId: string;
}>;

export type SalidaDeCambioDeEmpresa = Readonly<{
  empresaId: EmpresaId;
  estado: EstadoDeEmpresa;
  repetida: boolean;
}>;

export type ErrorAlCambiarLaEmpresa =
  | ErrorComunDeCasoDePlataforma
  | ErrorDeEmpresa
  | "ID_INVALIDO"
  | "EMPRESA_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA";

const datosDeLaEmpresa = (e: Pick<Empresa, "estado" | "motivoEstado" | "tenantId">) => ({
  estado: e.estado,
  motivo: e.motivoEstado,
  tenantId: e.tenantId,
});

function armarCambioDeEmpresa<Entrada extends { claveDeIdempotencia: string; empresaId: string }>(
  dependencias: DependenciasDeCicloDeVida,
  definicion: Readonly<{
    declaracion: DeclaracionDeAccionDePlataforma;
    operacion: string;
    constancia: AccionDePlataforma;
    extras: (entrada: Entrada) => Readonly<{ motivo: string }> | null;
    decidir: (
      empresa: Empresa,
      extras: Readonly<{ motivo: string }> | null,
    ) => Resultado<CambioDeEstadoDeEmpresa, ErrorDeEmpresa>;
  }>,
) {
  return async function cambiarEmpresa(
    contexto: ContextoDePlataforma,
    entrada: Entrada,
  ): Promise<Resultado<SalidaDeCambioDeEmpresa, ErrorAlCambiarLaEmpresa>> {
    return ejecutarCasoDePlataforma<
      TxDeCicloDeVida,
      SalidaDeCambioDeEmpresa,
      EmpresaId,
      Exclude<ErrorAlCambiarLaEmpresa, ErrorComunDeCasoDePlataforma>
    >(dependencias, {
      contexto,
      accion: definicion.declaracion.accion,
      operacion: definicion.operacion,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const id = uuidDesdeTexto(entrada.empresaId);
        if (!id.ok) return id;
        const extras = definicion.extras(entrada);
        return ok({
          entrada: { empresaId: id.valor, motivo: extras === null ? null : extras.motivo },
          valor: aEmpresaId(id.valor),
        });
      },
      trabajar: async (tx, id) => {
        const empresa = await tx.empresas.obtener(id);
        if (empresa === null) return err("EMPRESA_NO_ENCONTRADA");
        const cambio = definicion.decidir(empresa, definicion.extras(entrada));
        if (!cambio.ok) return cambio;
        const hecho = await tx.empresas.cambiarEstado(id, empresa.version, cambio.valor);
        if (!hecho.ok) return err("VERSION_DESACTUALIZADA");
        return ok({
          salida: { empresaId: id, estado: hecho.empresa.estado, repetida: false },
          constancias: [
            {
              accion: definicion.constancia,
              entidad: "empresa",
              entidadId: id,
              antes: datosDeLaEmpresa(empresa),
              despues: datosDeLaEmpresa(hecho.empresa),
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
    });
  };
}

export const armarSuspenderEmpresa = (d: DependenciasDeCicloDeVida) =>
  armarCambioDeEmpresa<EntradaDeSuspenderEmpresa>(d, {
    declaracion: DECLARACIONES_DE_CICLO_DE_VIDA.suspenderEmpresa,
    operacion: OPERACIONES_DE_CICLO_DE_VIDA.suspenderEmpresa,
    constancia: "EMPRESA_SUSPENDIDA",
    extras: (entrada) => ({ motivo: entrada.motivo.trim() }),
    decidir: (empresa, extras) => cambiarEstado(empresa, "SUSPENDED", extras?.motivo ?? ""),
  });

export const armarReactivarEmpresa = (d: DependenciasDeCicloDeVida) =>
  armarCambioDeEmpresa<EntradaDeReactivarEmpresa>(d, {
    declaracion: DECLARACIONES_DE_CICLO_DE_VIDA.reactivarEmpresa,
    operacion: OPERACIONES_DE_CICLO_DE_VIDA.reactivarEmpresa,
    constancia: "EMPRESA_REACTIVADA",
    extras: () => null,
    decidir: (empresa) => decidirReactivacionDeEmpresa(empresa),
  });
