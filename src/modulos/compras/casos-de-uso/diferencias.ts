import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { leerResolucion, leerTolerancias, type Tolerancias } from "../dominio/diferencias";
import { esUuid } from "../dominio/identificadores";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { exigirTresVias } from "./nivel-tres-vias";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeConfigurarTolerancias = Readonly<{
  /** La versión que la persona vio (0 si todavía no hay tolerancias guardadas). */
  versionEsperada: number;
  cantidad?: string | null;
  precio?: string | null;
  importe?: string | null;
  recepcion?: string | null;
}>;

export type SalidaDeConfigurarTolerancias = Readonly<{
  version: number;
  tolerancias: Tolerancias;
  /** `true`: ya eran esos valores: no se escribió ni se auditó nada. */
  sinCambios: boolean;
}>;

const mismas = (a: Tolerancias, b: Tolerancias): boolean =>
  a.cantidad === b.cantidad &&
  a.precio === b.precio &&
  a.importe === b.importe &&
  a.recepcion === b.recepcion;

/**
 * Fijar las tolerancias de la empresa (N4): las cuatro juntas, cada una un porcentaje (o el tope en pesos) o «no definida» (ausente o `null`: NO es cero). Guard `compras.configurar`
 * (solo el gerente) y la empresa en N4 con la perilla. Rigen hacia adelante: cada conciliación copia las que había al conciliar. Con los mismos valores no escribe (`sinCambios`); con
 * otra versión y otros valores, `VERSION_DESACTUALIZADA`. Dos cambios a la vez dejan uno solo (la fila se bloquea por la versión).
 */
export function armarConfigurarTolerancias(dependencias: DependenciasDeCompras) {
  return async function configurarTolerancias(
    contexto: ContextoOperativo,
    entrada: EntradaDeConfigurarTolerancias,
  ): Promise<R<SalidaDeConfigurarTolerancias>> {
    const { empresaId } = contexto;
    if (!Number.isInteger(entrada.versionEsperada) || entrada.versionEsperada < 0) {
      return err("VERSION_DESACTUALIZADA");
    }
    const leidas = leerTolerancias(entrada);
    if (!leidas.ok) return leidas;
    const nuevas = leidas.valor;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeConfigurarTolerancias>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "compras.configurar",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirTresVias(tx, contexto);
          if (!nivel.ok) return nivel;
          const actual = await tx.toleranciasDeCompra.leer(empresaId);
          if (actual !== null && mismas(actual.tolerancias, nuevas)) {
            return ok({
              version: actual.version,
              tolerancias: actual.tolerancias,
              sinCambios: true,
            });
          }
          const versionActual = actual?.version ?? 0;
          if (versionActual !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
          const escrito =
            actual === null
              ? await tx.toleranciasDeCompra.insertar(empresaId, nuevas)
              : await tx.toleranciasDeCompra.actualizar(empresaId, actual.version, nuevas);
          if (!escrito) return err("VERSION_DESACTUALIZADA");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "TOLERANCIAS_DE_COMPRAS_CAMBIADAS",
            entidad: "tolerancia_de_compras",
            entidadId: empresaId,
            antes: { ...(actual?.tolerancias ?? {}) },
            despues: { ...nuevas },
          });
          return ok({ version: versionActual + 1, tolerancias: nuevas, sinCambios: false });
        },
      ),
    );
  };
}

export type EntradaDeResolverDiferencia = Readonly<{
  diferenciaId: string;
  /** `ACEPTADA`, `NOTA_DE_CREDITO`, `NOTA_DE_DEBITO`, `DEVOLUCION`, `FACTURA_COMPLEMENTARIA` o `CORREGIDA_POR_EL_PROVEEDOR` (`dominio/diferencias.ts`). */
  resolucion: string;
  motivo: string;
}>;

/**
 * Resolver una diferencia abierta (N4): qué se hace con ella, con su motivo escrito; queda quién y cuándo. Guard `diferencias_de_compra.resolver` (gerente y administrador). Completa lo
 * iniciado: no pide la perilla. Repetir lo mismo (misma resolución y mismo motivo) devuelve `yaEstaba` sin escribir; resolverla distinto, `DIFERENCIA_YA_RESUELTA` (no se reabre: si hay
 * que corregir, se anula la conciliación y se concilia de nuevo); una anulada, `DIFERENCIA_ANULADA`. La fila se bloquea: dos resoluciones a la vez dejan una sola. «Dejarla abierta»
 * es no resolverla. `NOTA_DE_CREDITO` y `DEVOLUCION` son por ahora la etiqueta: el documento llega con su tramo.
 */
export function armarResolverDiferencia(dependencias: DependenciasDeCompras) {
  return async function resolverDiferencia(
    contexto: ContextoOperativo,
    entrada: EntradaDeResolverDiferencia,
  ): Promise<R<Readonly<{ yaEstaba: boolean }>>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.diferenciaId)) return err("DIFERENCIA_NO_ENCONTRADA");
    const pedida = leerResolucion(entrada.resolucion, entrada.motivo);
    if (!pedida.ok) return pedida;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<Readonly<{ yaEstaba: boolean }>>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "diferencias_de_compra.resolver",
          ]);
          if (!permiso.ok) return permiso;
          const diferencia = await tx.diferenciasDeCompra.bloquear(empresaId, entrada.diferenciaId);
          if (diferencia === null) return err("DIFERENCIA_NO_ENCONTRADA");
          if (diferencia.estado === "ANULADA") return err("DIFERENCIA_ANULADA");
          if (diferencia.estado === "RESUELTA") {
            return diferencia.resolucion === pedida.valor.resolucion &&
              diferencia.motivo === pedida.valor.motivo
              ? ok({ yaEstaba: true })
              : err("DIFERENCIA_YA_RESUELTA");
          }
          await tx.diferenciasDeCompra.resolver(empresaId, diferencia.id, {
            por: persona,
            resolucion: pedida.valor.resolucion,
            motivo: pedida.valor.motivo,
          });
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "DIFERENCIA_DE_COMPRA_RESUELTA",
            entidad: "diferencia_de_compra",
            entidadId: diferencia.id,
            antes: { estado: "ABIERTA" },
            despues: {
              estado: "RESUELTA",
              tipo: diferencia.tipo,
              resolucion: pedida.valor.resolucion,
              motivo: pedida.valor.motivo,
            },
          });
          return ok({ yaEstaba: false });
        },
      ),
    );
  };
}
