import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ComprobanteId } from "../dominio/identificadores";
import { exigirComprobanteEnAlcance } from "../consultas/comprobante-en-alcance";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import { encolarValidacion, type DependenciasDeFacturacion } from "./contrato-de-facturacion";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";

/**
 * Descartar y reintentar un comprobante (spec H7 facturación §B.4.4). Cada uno en una transacción SERIALIZABLE,
 * con el guard primero y la auditoría en la misma transacción.
 *
 * Los dos aplican el MISMO alcance de sucursal que el Detalle (D-39, `exigirComprobanteEnAlcance`): el comprobante de una sucursal que la
 * persona no tiene se responde `COMPROBANTE_NO_ENCONTRADO`, igual que uno que no existe.
 *
 * Descartar: solo un `PENDIENTE` o un `CONFLICTO` (nunca llegó a ARCA con ese número, o lo usó otro sistema), con
 * motivo; `EN_VALIDACION` o `INCIERTO` → `COMPROBANTE_YA_ENVIADO` (hay que esperar a ARCA); dos veces → «ya
 * estaba». Si el trabajo de validación corre a la vez, SERIALIZABLE deja ganar a uno: o queda descartado sin
 * número, o en validación (y el descarte da `VERSION_DESACTUALIZADA` o `COMPROBANTE_YA_ENVIADO`).
 *
 * Reintentar: un `CONFLICTO` vuelve a `PENDIENTE` (solo con la serie ya resincronizada) y se encola su validación;
 * un `PENDIENTE` sin trabajo vivo (el anterior agotó sus intentos) se reencola. Un `PENDIENTE` que ya tiene un
 * trabajo vivo no se toca (`encolado: false`).
 */

export type EntradaDeDescartarComprobante = Readonly<{
  comprobanteId: ComprobanteId;
  motivo: string;
  /** La versión que vio la pantalla: si cambió, `VERSION_DESACTUALIZADA`. */
  versionEsperada: number;
}>;

export type SalidaDeDescartarComprobante = Readonly<{ yaEstaba: boolean }>;

export type ErrorPropioAlDescartar =
  | "COMPROBANTE_NO_ENCONTRADO"
  | "COMPROBANTE_YA_ENVIADO"
  | "ESTADO_NO_DESCARTABLE"
  | "VERSION_DESACTUALIZADA"
  | "MOTIVO_DE_DESCARTE_INVALIDO";

export type ErrorAlDescartarComprobante =
  ErrorPropioAlDescartar | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

export function armarDescartarComprobante({ transacciones, reglas }: DependenciasDeFacturacion) {
  return async function descartarComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeDescartarComprobante,
  ): Promise<Resultado<SalidaDeDescartarComprobante, ErrorAlDescartarComprobante>> {
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeDescartarComprobante,
          ErrorPropioAlDescartar | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_FACTURACION.descartarComprobante.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, contexto.empresaId);
        if (!opera.ok) return opera;
        // D-39 extendido: la sucursal del comprobante contra el alcance de la persona ANTES de leer nada más; si no corresponde, lo
        // mismo que si no existiera (nunca «ya estaba», «versión desactualizada» ni «estado no descartable»).
        const enAlcance = await exigirComprobanteEnAlcance(tx, contexto, entrada.comprobanteId);
        if (!enAlcance.ok) return enAlcance;
        const c = await tx.comprobantes.obtener(contexto.empresaId, entrada.comprobanteId);
        if (c === null) return err("COMPROBANTE_NO_ENCONTRADO");
        if (c.estado === "DESCARTADO") return ok({ yaEstaba: true });
        if (c.estado === "EN_VALIDACION" || c.estado === "INCIERTO") {
          return err("COMPROBANTE_YA_ENVIADO");
        }
        if (c.estado !== "PENDIENTE" && c.estado !== "CONFLICTO") {
          return err("ESTADO_NO_DESCARTABLE");
        }
        if (c.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        const motivo = entrada.motivo.trim();
        if (motivo === "") return err("MOTIVO_DE_DESCARTE_INVALIDO");
        const movido = await tx.comprobantes.transicionar(contexto.empresaId, c.id, c.version, {
          a: "DESCARTADO",
          motivo,
        });
        if (movido === null) throw new Error("el comprobante cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId: contexto.empresaId,
          actorPersonaId: contexto.personaId,
          accion: "COMPROBANTE_DESCARTADO",
          entidad: "comprobante",
          entidadId: c.id,
          antes: { estado: c.estado },
          despues: { estado: movido.estado, motivo },
        });
        return ok({ yaEstaba: false });
      },
    );
    // El largo y la forma del motivo los decide la base (`comprobante_descarte_ck`, hasta 500).
    return traducirErroresDeFiscal(resultado, ["MOTIVO_DE_DESCARTE_INVALIDO"] as const);
  };
}

export type EntradaDeReintentarComprobante = Readonly<{ comprobanteId: ComprobanteId }>;

export type SalidaDeReintentarComprobante = Readonly<{
  /** `false`: ya tenía un trabajo de validación vivo; no se encoló otro. */
  encolado: boolean;
}>;

export type ErrorPropioAlReintentar =
  "COMPROBANTE_NO_ENCONTRADO" | "SERIE_BLOQUEADA" | "ESTADO_NO_REINTENTABLE";

export type ErrorAlReintentarComprobante =
  ErrorPropioAlReintentar | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

export function armarReintentarComprobante({ transacciones, reglas }: DependenciasDeFacturacion) {
  return async function reintentarComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeReintentarComprobante,
  ): Promise<Resultado<SalidaDeReintentarComprobante, ErrorAlReintentarComprobante>> {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeReintentarComprobante,
          ErrorPropioAlReintentar | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_FACTURACION.reintentarComprobante.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { empresaId } = contexto;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        // D-39 extendido (ver descartar): antes de leer el comprobante, y sin distinguir al ajeno del que no existe.
        const enAlcance = await exigirComprobanteEnAlcance(tx, contexto, entrada.comprobanteId);
        if (!enAlcance.ok) return enAlcance;
        const c = await tx.comprobantes.obtener(empresaId, entrada.comprobanteId);
        if (c === null) return err("COMPROBANTE_NO_ENCONTRADO");
        if (c.estado !== "PENDIENTE" && c.estado !== "CONFLICTO") {
          return err("ESTADO_NO_REINTENTABLE");
        }
        const serie = await tx.series.obtener(empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
        if (serie?.estado === "BLOQUEADA") return err("SERIE_BLOQUEADA");
        if (c.estado === "CONFLICTO") {
          const movido = await tx.comprobantes.transicionar(empresaId, c.id, c.version, {
            a: "PENDIENTE",
          });
          if (movido === null) throw new Error("el comprobante cambió dentro de la transacción");
        }
        const encolado = await encolarValidacion(tx, empresaId, c.id);
        if (c.estado === "PENDIENTE" && !encolado) return ok({ encolado: false });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "COMPROBANTE_REINTENTADO",
          entidad: "comprobante",
          entidadId: c.id,
          antes: { estado: c.estado },
          despues: { estado: "PENDIENTE", encolado },
        });
        return ok({ encolado });
      },
    );
  };
}
