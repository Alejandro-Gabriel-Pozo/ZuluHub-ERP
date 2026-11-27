import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import { anularLaNotaDeDebito } from "./cargo-de-la-factura";
import { autorizar, exigirAlcanceDelComprobante, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import {
  armarRegistrarNota,
  DE_DEBITO,
  type EntradaDeRegistrarNotaDeDebito,
  type SalidaDeRegistrarNotaDeCredito,
} from "./notas-de-credito";

type R<S> = Resultado<S, ErrorDeCompras>;

export type { EntradaDeRegistrarNotaDeDebito };
export type SalidaDeRegistrarNotaDeDebito = SalidaDeRegistrarNotaDeCredito;

/**
 * Cargar la nota de débito que mandó el proveedor (NOTAS-1; Q-3 del dueño, 25/11/2026): suma a lo que se debe, con una factura vinculada del mismo proveedor (opcional, sin tope) o suelta. Es un comprobante propio: se paga aparte
 * (`comprobantes_de_proveedor.pagar`, por su total) y no cambia lo que se paga de la factura. Guard `notas_de_debito_de_proveedor.registrar` (gerente y administrador). La carga, la repetición (`CLAVE_DE_IDEMPOTENCIA`: misma
 * clave y mismo contenido devuelve lo hecho con `yaExistia`; otro contenido, `CLAVE_REUTILIZADA`; la misma nota con otra clave, `COMPROBANTE_YA_REGISTRADO`), el alcance de sucursales y el libro son los de la nota de crédito:
 * `armarRegistrarNota` con la variante de débito. Con factura exige alcance sobre todas sus sucursales; suelta, alcance sobre todas.
 */
export function armarRegistrarNotaDeDebito(dependencias: DependenciasDeCompras) {
  const registrar = armarRegistrarNota(dependencias, DE_DEBITO);
  return (
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarNotaDeDebito,
  ): Promise<R<SalidaDeRegistrarNotaDeDebito>> => registrar(contexto, entrada);
}

export type EntradaDeAnularNotaDeDebito = Readonly<{ comprobanteId: string; motivo: string }>;
export type SalidaDeAnularNotaDeDebito = Readonly<{
  /** `true`: la nota ya estaba anulada: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
}>;

/**
 * Anular una nota de débito, con motivo: queda con quién, cuándo y por qué, nada se borra y su asiento del libro se deshace con un espejo. Guard `notas_de_debito_de_proveedor.anular` (gerente y administrador). Una ya anulada no
 * escribe (`yaEstaba`); una nota con un pago vigente no se anula (`COMPROBANTE_YA_PAGADO`, con el id del pago: primero se anula el pago). Orden de bloqueo: la factura vinculada (si hay), la nota, el pago, la parte del libro.
 */
export function armarAnularNotaDeDebito(dependencias: DependenciasDeCompras) {
  return async function anularNotaDeDebito(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularNotaDeDebito,
  ): Promise<R<SalidaDeAnularNotaDeDebito>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.comprobanteId)) return err("NOTA_DE_DEBITO_NO_ENCONTRADA");
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeAnularNotaDeDebito>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "notas_de_debito_de_proveedor.anular",
          ]);
          if (!permiso.ok) return permiso;
          const sinBloquear = await tx.comprobantesDeProveedor.obtener(
            empresaId,
            entrada.comprobanteId,
          );
          if (sinBloquear?.clase !== "NOTA_DE_DEBITO") return err("NOTA_DE_DEBITO_NO_ENCONTRADA");
          if (sinBloquear.comprobanteAsociadoId !== null) {
            await tx.comprobantesDeProveedor.bloquear(empresaId, sinBloquear.comprobanteAsociadoId);
          }
          const nota = await tx.comprobantesDeProveedor.bloquear(empresaId, entrada.comprobanteId);
          if (nota === null || nota.clase !== "NOTA_DE_DEBITO") {
            return err("NOTA_DE_DEBITO_NO_ENCONTRADA");
          }
          const alcance =
            nota.comprobanteAsociadoId === null
              ? (await tx.autorizacion.sucursalesDelActor(contexto)) === "TODAS"
                ? ok(null)
                : err("SUCURSAL_FUERA_DE_ALCANCE" as const)
              : await exigirAlcanceDelComprobante(tx, contexto, nota.comprobanteAsociadoId);
          if (!alcance.ok) return alcance;
          if (nota.estado === "ANULADO") return ok({ yaEstaba: true });
          const pago = await tx.pagosDeProveedor.vigenteDe(empresaId, nota.id);
          if (pago !== null) return err({ error: "COMPROBANTE_YA_PAGADO", pagoId: pago.id });
          const hecho = await tx.comprobantesDeProveedor.anular(empresaId, nota.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!hecho) throw new Error("la nota ya no estaba registrada bajo bloqueo");
          const enElLibro = await anularLaNotaDeDebito(tx, contexto, dependencias, nota.id);
          if (!enElLibro.ok) return enElLibro;
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "NOTA_DE_DEBITO_ANULADA",
            entidad: "comprobante_de_proveedor",
            entidadId: nota.id,
            antes: { estado: "REGISTRADO" },
            despues: { estado: "ANULADO", motivo: motivo.valor },
          });
          return ok({ yaEstaba: false });
        },
      ),
    );
  };
}
